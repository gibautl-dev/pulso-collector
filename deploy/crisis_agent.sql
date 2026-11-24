-- Agente de crisis / sección Acción.
-- Aplicada en pulso-demo (bkjugpesqbplnaeotadh) el 2026-11-24. No volver a aplicar tal cual si ya está.
-- No contiene secretos. El job queda en PULSO_CRISIS_AGENT_ENABLED (apagado por defecto).
--
-- Un Coordinador reparte el trabajo entre agentes con roles (Vigilante, Analista,
-- Estratega, Redactor, Evidencia). El resultado se guarda para que una persona lo
-- revise, apruebe o descarte. Nada se publica solo. No hay denuncias automáticas
-- ni respuestas en masa.
--
-- El job (python -m pulso.crisis) usa el rol pulso_classifier, la clave del LLM
-- y CLASSIFIER_DATABASE_URL. Lee menciones, topics, suspicious_accounts, meta_ads,
-- meta_ad_classifications y ai_answers (SELECT). Escribe solo en las tablas de
-- esta migración. La web (authenticated, vía candidate_members) lee y solo puede
-- actualizar el estado humano de la alerta. anon no recibe permisos.
-- No hay triggers ni funciones con auth.uid() en un camino del recolector;
-- las policies de lectura/update web sí usan (select auth.uid()).
--
-- Supabase otorga ALL a authenticated en tablas nuevas: este archivo revoca
-- esos privilegios y deja SELECT (y el update de estado, acotado por política).

begin;

create table if not exists public.crisis_agent_settings (
  candidate_id uuid primary key references public.candidates(id) on delete cascade,
  enabled boolean not null default false,
  max_cost_usd numeric(10, 4) not null default 0.50 check (max_cost_usd >= 0 and max_cost_usd <= 5),
  max_briefs_per_run integer not null default 3 check (max_briefs_per_run between 1 and 10),
  notify_email boolean not null default false,
  updated_at timestamptz not null default now()
);

comment on table public.crisis_agent_settings is
  'Prendido o apagado del equipo de agentes de crisis, por candidato. Apagado por defecto.';

create table if not exists public.crisis_alerts (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  trigger_type text not null
    check (trigger_type in (
      'negative_spike', 'rising_topic', 'suspicious_campaign', 'attack_ads', 'ai_shift'
    )),
  trigger_key text not null check (length(trim(trigger_key)) > 0),
  cluster_label text,
  topic_id uuid,
  window_start timestamptz not null,
  window_end timestamptz not null,
  severity text not null
    check (severity in ('bajo', 'medio', 'medio_alto', 'alto')),
  metrics jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metrics) = 'object'),
  status text not null default 'new'
    check (status in ('new', 'in_review', 'approved', 'discarded')),
  status_note text,
  status_updated_at timestamptz,
  status_updated_by uuid,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, trigger_type, trigger_key),
  foreign key (candidate_id, topic_id) references public.topics(candidate_id, id),
  check (window_start <= window_end)
);

comment on table public.crisis_alerts is
  'Alertas detectadas por el Vigilante. Si el mismo relato sigue activo, se actualiza esta fila en lugar de crear otra. El estado lo cambia una persona.';
comment on column public.crisis_alerts.trigger_key is
  'Clave estable de deduplicación, por ejemplo rising_topic:control_laboral_sociedad_rural.';
comment on column public.crisis_alerts.status is
  'new | in_review | approved | discarded. Lo actualiza una persona, no el job.';

create index if not exists crisis_alerts_candidate_status_idx
  on public.crisis_alerts (candidate_id, status, last_detected_at desc);

create table if not exists public.crisis_briefs (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.crisis_alerts(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  prompt_version text not null,
  model text not null,
  risk_level text
    check (risk_level is null or risk_level in ('bajo', 'medio', 'medio_alto', 'alto')),
  title text,
  input_ref jsonb not null default '{}'::jsonb
    check (jsonb_typeof(input_ref) = 'object'),
  output jsonb not null
    check (jsonb_typeof(output) = 'object'),
  cost_usd numeric(12, 6)
    check (cost_usd is null or cost_usd >= 0),
  usage jsonb not null default '{}'::jsonb
    check (jsonb_typeof(usage) = 'object'),
  created_at timestamptz not null default now()
);

comment on table public.crisis_briefs is
  'Briefs armados por el Coordinador. No se pisa un brief anterior: si hay evidencia nueva material, se inserta una versión nueva.';
comment on column public.crisis_briefs.output is
  'JSON del brief, con atribución de agente por sección (Vigilante, Analista, Estratega, Redactor, Evidencia, Coordinador).';
comment on column public.crisis_briefs.input_ref is
  'IDs de menciones, anuncios y cuentas usadas. No inventar citas fuera de esta lista.';

create index if not exists crisis_briefs_alert_time_idx
  on public.crisis_briefs (alert_id, created_at desc);
create index if not exists crisis_briefs_candidate_time_idx
  on public.crisis_briefs (candidate_id, created_at desc);

create table if not exists public.crisis_agent_runs (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.crisis_alerts(id) on delete cascade,
  brief_id uuid references public.crisis_briefs(id) on delete set null,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  agent_role text not null
    check (agent_role in (
      'coordinator', 'watcher', 'analyst', 'strategist', 'writer', 'evidence'
    )),
  model text,
  prompt_version text,
  status text not null
    check (status in ('ok', 'skipped', 'error')),
  cost_usd numeric(12, 6)
    check (cost_usd is null or cost_usd >= 0),
  usage jsonb not null default '{}'::jsonb
    check (jsonb_typeof(usage) = 'object'),
  notes text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  check (finished_at is null or finished_at >= started_at)
);

comment on table public.crisis_agent_runs is
  'Pase de trabajo entre agentes, para auditar qué produjo cada rol y cuánto costó. Evidencia no denuncia sola.';

create index if not exists crisis_agent_runs_alert_idx
  on public.crisis_agent_runs (alert_id, started_at);

create table if not exists public.crisis_notifications (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.crisis_alerts(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  channel text not null check (channel in ('email', 'slack', 'whatsapp')),
  sent_to text,
  status text not null check (status in ('queued', 'sent', 'error', 'skipped')),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.crisis_notifications is
  'Avisos de una alerta nueva. V1: email. Slack y WhatsApp quedan para después. No se envía el brief completo con datos sensibles si el canal no está cerrado.';

create index if not exists crisis_notifications_alert_idx
  on public.crisis_notifications (alert_id, created_at desc);

-- RLS y grants --------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'crisis_agent_settings', 'crisis_alerts', 'crisis_briefs',
    'crisis_agent_runs', 'crisis_notifications'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, pulso_collector, pulso_classifier', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end;
$$;

-- Clasificador / job de agentes: lee y escribe alertas, briefs y corridas.
-- No pisa status humano: el upsert de la aplicación conserva status si no es new.
grant select, insert, update on table public.crisis_agent_settings to pulso_classifier;
grant select, insert, update on table public.crisis_alerts to pulso_classifier;
grant select, insert on table public.crisis_briefs to pulso_classifier;
grant select, insert on table public.crisis_agent_runs to pulso_classifier;
grant select, insert, update on table public.crisis_notifications to pulso_classifier;

-- Lecturas extra que el Analista y Evidencia necesitan (sin ampliar escrituras).
grant select on table public.suspicious_accounts to pulso_classifier;
grant select on table public.meta_ads to pulso_classifier;
grant select on table public.meta_ad_classifications to pulso_classifier;
grant select on table public.ai_answers to pulso_classifier;

drop policy if exists crisis_agent_settings_classifier_all on public.crisis_agent_settings;
create policy crisis_agent_settings_classifier_all
  on public.crisis_agent_settings for all to pulso_classifier
  using (true) with check (true);

drop policy if exists crisis_alerts_classifier_select on public.crisis_alerts;
create policy crisis_alerts_classifier_select
  on public.crisis_alerts for select to pulso_classifier using (true);
drop policy if exists crisis_alerts_classifier_insert on public.crisis_alerts;
create policy crisis_alerts_classifier_insert
  on public.crisis_alerts for insert to pulso_classifier with check (true);
drop policy if exists crisis_alerts_classifier_update on public.crisis_alerts;
create policy crisis_alerts_classifier_update
  on public.crisis_alerts for update to pulso_classifier using (true) with check (true);

drop policy if exists crisis_briefs_classifier_select on public.crisis_briefs;
create policy crisis_briefs_classifier_select
  on public.crisis_briefs for select to pulso_classifier using (true);
drop policy if exists crisis_briefs_classifier_insert on public.crisis_briefs;
create policy crisis_briefs_classifier_insert
  on public.crisis_briefs for insert to pulso_classifier with check (true);

drop policy if exists crisis_agent_runs_classifier_select on public.crisis_agent_runs;
create policy crisis_agent_runs_classifier_select
  on public.crisis_agent_runs for select to pulso_classifier using (true);
drop policy if exists crisis_agent_runs_classifier_insert on public.crisis_agent_runs;
create policy crisis_agent_runs_classifier_insert
  on public.crisis_agent_runs for insert to pulso_classifier with check (true);

drop policy if exists crisis_notifications_classifier_all on public.crisis_notifications;
create policy crisis_notifications_classifier_all
  on public.crisis_notifications for all to pulso_classifier
  using (true) with check (true);

-- Web: miembros leen; en alertas pueden actualizar solo el estado humano.
-- Las policies limitan filas, no columnas: el código de la app no toca metrics ni trigger_key.
grant select on table public.crisis_alerts to authenticated;
grant select on table public.crisis_briefs to authenticated;
grant select on table public.crisis_agent_runs to authenticated;
grant select on table public.crisis_agent_settings to authenticated;
grant update (status, status_note, status_updated_at, status_updated_by)
  on table public.crisis_alerts to authenticated;

drop policy if exists crisis_alerts_member_select on public.crisis_alerts;
create policy crisis_alerts_member_select
  on public.crisis_alerts for select to authenticated
  using (exists (
    select 1 from public.candidate_members m
    where m.candidate_id = crisis_alerts.candidate_id
      and m.user_id = (select auth.uid())
  ));

drop policy if exists crisis_alerts_member_update on public.crisis_alerts;
create policy crisis_alerts_member_update
  on public.crisis_alerts for update to authenticated
  using (exists (
    select 1 from public.candidate_members m
    where m.candidate_id = crisis_alerts.candidate_id
      and m.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.candidate_members m
    where m.candidate_id = crisis_alerts.candidate_id
      and m.user_id = (select auth.uid())
  ));

drop policy if exists crisis_briefs_member_select on public.crisis_briefs;
create policy crisis_briefs_member_select
  on public.crisis_briefs for select to authenticated
  using (exists (
    select 1 from public.candidate_members m
    where m.candidate_id = crisis_briefs.candidate_id
      and m.user_id = (select auth.uid())
  ));

drop policy if exists crisis_agent_runs_member_select on public.crisis_agent_runs;
create policy crisis_agent_runs_member_select
  on public.crisis_agent_runs for select to authenticated
  using (exists (
    select 1 from public.candidate_members m
    where m.candidate_id = crisis_agent_runs.candidate_id
      and m.user_id = (select auth.uid())
  ));

drop policy if exists crisis_agent_settings_member_select on public.crisis_agent_settings;
create policy crisis_agent_settings_member_select
  on public.crisis_agent_settings for select to authenticated
  using (exists (
    select 1 from public.candidate_members m
    where m.candidate_id = crisis_agent_settings.candidate_id
      and m.user_id = (select auth.uid())
  ));

commit;
