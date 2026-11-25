-- Alertas de contradicciones por candidato (feat/inconsistency-alerts).
-- NO APLICADA. Necesita el OK de Leandro antes de correrla en pulso-demo.
-- Idempotente. No contiene secretos. No cambia env ni el cron. Costo de aplicar el SQL: USD 0.
--
-- El job (python -m pulso.inconsistency) usa el rol pulso_classifier, la clave del
-- LLM y CLASSIFIER_DATABASE_URL, como el clasificador, el agente de crisis y el
-- resumen diario. Lee candidates, topics y mentions con los SELECT que ese rol ya
-- tiene (classifier_permissions.sql, crisis_mentions_select.sql). Escribe solo en
-- estas dos tablas.
-- La web (authenticated, vía candidate_members) lee y solo puede cambiar el estado
-- de revisión (status, status_note, status_updated_*), igual que crisis_alerts.
-- anon no recibe nada. Nada se publica ni se responde solo.
--
-- Supabase otorga ALL a authenticated en tablas nuevas: este archivo los revoca.

begin;

create table if not exists public.inconsistency_alerts (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  alert_key text not null check (length(trim(alert_key)) > 0),
  origin text not null check (origin in ('par', 'senalamiento')),
  kind text not null
    check (kind in ('contradiccion', 'cambio_de_postura', 'promesa_incumplida', 'tension')),
  severity text not null check (severity in ('alto', 'medio', 'bajo')),
  topic_label text,
  topic_id uuid,
  earlier jsonb check (earlier is null or jsonb_typeof(earlier) = 'object'),
  later jsonb not null check (jsonb_typeof(later) = 'object'),
  days_between integer check (days_between is null or days_between >= 0),
  explanation text not null default '',
  next_step text not null default '',
  mention_ids uuid[] not null default '{}',
  detected_at timestamptz not null default now(),
  model text,
  prompt_version text not null,
  status text not null default 'new'
    check (status in ('new', 'in_review', 'approved', 'discarded')),
  status_note text,
  status_updated_at timestamptz,
  status_updated_by uuid,
  created_at timestamptz not null default now(),
  unique (candidate_id, alert_key)
);

comment on table public.inconsistency_alerts is
  'Contradicciones detectadas: una declaración nueva del candidato (o una nota que señala un cambio) contra algo dicho antes. Las citas (earlier/later) salen de las menciones, nunca del modelo; el modelo solo juzga el par y redacta explanation/next_step. El estado lo cambia una persona.';
comment on column public.inconsistency_alerts.origin is
  'par = dos declaraciones del candidato; senalamiento = nota de terceros que dice que se contradijo o incumplió (earlier puede ser null si la declaración original no está en lo recolectado).';
comment on column public.inconsistency_alerts.alert_key is
  'Clave estable (origen + menciones) para no repetir la misma alerta.';

create index if not exists inconsistency_alerts_candidate_idx
  on public.inconsistency_alerts (candidate_id, status, detected_at desc);

-- Estado de la última revisión por candidato: datos suficientes o no, pares ya juzgados (para no pagar dos veces).
create table if not exists public.inconsistency_scans (
  candidate_id uuid primary key references public.candidates(id) on delete cascade,
  status text not null check (status in ('ok', 'insufficient')),
  last_scan_at timestamptz not null,
  reason text,
  stats jsonb not null default '{}'::jsonb check (jsonb_typeof(stats) = 'object'),
  judged_keys text[] not null default '{}',
  model text,
  prompt_version text not null,
  cost_usd numeric(12, 6) check (cost_usd is null or cost_usd >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.inconsistency_scans is
  'Una fila por candidato: cuándo se revisó, cuántas declaraciones hay y si alcanzan para comparar (reason). judged_keys evita volver a mandar al modelo pares ya revisados.';

do $$
declare t text;
begin
  foreach t in array array['inconsistency_alerts', 'inconsistency_scans'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, pulso_collector, pulso_classifier', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end;
$$;

-- Job: inserta alertas (sin pisar las existentes) y mantiene su fila de estado.
grant select, insert on table public.inconsistency_alerts to pulso_classifier;
grant select, insert, update on table public.inconsistency_scans to pulso_classifier;

drop policy if exists inconsistency_alerts_classifier_select on public.inconsistency_alerts;
create policy inconsistency_alerts_classifier_select
  on public.inconsistency_alerts for select to pulso_classifier using (true);
drop policy if exists inconsistency_alerts_classifier_insert on public.inconsistency_alerts;
create policy inconsistency_alerts_classifier_insert
  on public.inconsistency_alerts for insert to pulso_classifier with check (true);

drop policy if exists inconsistency_scans_classifier_select on public.inconsistency_scans;
create policy inconsistency_scans_classifier_select
  on public.inconsistency_scans for select to pulso_classifier using (true);
drop policy if exists inconsistency_scans_classifier_insert on public.inconsistency_scans;
create policy inconsistency_scans_classifier_insert
  on public.inconsistency_scans for insert to pulso_classifier with check (true);
drop policy if exists inconsistency_scans_classifier_update on public.inconsistency_scans;
create policy inconsistency_scans_classifier_update
  on public.inconsistency_scans for update to pulso_classifier using (true) with check (true);

-- Web: los miembros del candidato leen; solo cambian el estado de revisión de una alerta.
grant select on table public.inconsistency_alerts to authenticated;
grant update (status, status_note, status_updated_at, status_updated_by)
  on table public.inconsistency_alerts to authenticated;
grant select (candidate_id, status, last_scan_at, reason, stats, updated_at)
  on table public.inconsistency_scans to authenticated;

drop policy if exists inconsistency_alerts_member_select on public.inconsistency_alerts;
create policy inconsistency_alerts_member_select
  on public.inconsistency_alerts for select to authenticated
  using (exists (
    select 1 from public.candidate_members m
    where m.candidate_id = inconsistency_alerts.candidate_id
      and m.user_id = (select auth.uid())
  ));

drop policy if exists inconsistency_alerts_member_update on public.inconsistency_alerts;
create policy inconsistency_alerts_member_update
  on public.inconsistency_alerts for update to authenticated
  using (exists (
    select 1 from public.candidate_members m
    where m.candidate_id = inconsistency_alerts.candidate_id
      and m.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.candidate_members m
    where m.candidate_id = inconsistency_alerts.candidate_id
      and m.user_id = (select auth.uid())
  ));

drop policy if exists inconsistency_scans_member_select on public.inconsistency_scans;
create policy inconsistency_scans_member_select
  on public.inconsistency_scans for select to authenticated
  using (exists (
    select 1 from public.candidate_members m
    where m.candidate_id = inconsistency_scans.candidate_id
      and m.user_id = (select auth.uid())
  ));

commit;
