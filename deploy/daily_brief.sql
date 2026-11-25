-- Resumen diario por candidato (qué cambió, por qué importa, qué hacer).
-- Aplicada en pulso-demo el 2026-11-25 (aprobada por Leandro).
-- Idempotente. No contiene secretos. No cambia env ni el cron.
--
-- El job (python -m pulso.daily_brief) usa el rol pulso_classifier, la clave del
-- LLM y CLASSIFIER_DATABASE_URL, como el clasificador y el agente de crisis. Lee
-- candidates, topics, mentions, meta_ads, meta_ad_classifications y crisis_alerts
-- con los SELECT que ese rol ya tiene (classifier_permissions.sql,
-- crisis_agent.sql, crisis_mentions_select.sql). Escribe solo en esta tabla.
-- La web (authenticated, vía candidate_members) solo lee. anon no recibe nada.
-- Nada se publica ni se envía solo: "Qué hacer" son sugerencias para revisión humana.
--
-- Supabase otorga ALL a authenticated en tablas nuevas: este archivo los revoca.
--
-- Costo de aplicar el SQL: USD 0.

begin;

create table if not exists public.daily_briefs (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  brief_date date not null,
  timezone text not null,
  status text not null check (status in ('ok', 'insufficient')),
  headline text,
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  output jsonb not null default '{}'::jsonb check (jsonb_typeof(output) = 'object'),
  input_ref jsonb not null default '{}'::jsonb check (jsonb_typeof(input_ref) = 'object'),
  model text,
  prompt_version text not null,
  cost_usd numeric(12, 6) check (cost_usd is null or cost_usd >= 0),
  usage jsonb not null default '{}'::jsonb check (jsonb_typeof(usage) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, brief_date)
);

comment on table public.daily_briefs is
  'Resumen diario por candidato. Las cifras (metrics) salen de SQL/Python; el modelo solo redacta y cada punto cita menciones (output.*.mention_ids). Un resumen por candidato y día.';
comment on column public.daily_briefs.status is
  'ok | insufficient. insufficient = pocas menciones ese día: se guarda el motivo y no se llama al modelo.';
comment on column public.daily_briefs.input_ref is
  'IDs de menciones enviadas al modelo. Ningún punto puede citar menciones fuera de esta lista.';

create index if not exists daily_briefs_candidate_date_idx
  on public.daily_briefs (candidate_id, brief_date desc);

alter table public.daily_briefs enable row level security;
alter table public.daily_briefs force row level security;
revoke all on table public.daily_briefs from public, anon, authenticated, pulso_collector, pulso_classifier;
grant all on table public.daily_briefs to service_role;

-- Job: lee, inserta y (solo con --force) rehace el resumen de una fecha.
grant select, insert, update on table public.daily_briefs to pulso_classifier;

drop policy if exists daily_briefs_classifier_select on public.daily_briefs;
create policy daily_briefs_classifier_select
  on public.daily_briefs for select to pulso_classifier using (true);
drop policy if exists daily_briefs_classifier_insert on public.daily_briefs;
create policy daily_briefs_classifier_insert
  on public.daily_briefs for insert to pulso_classifier with check (true);
drop policy if exists daily_briefs_classifier_update on public.daily_briefs;
create policy daily_briefs_classifier_update
  on public.daily_briefs for update to pulso_classifier using (true) with check (true);

-- Web: los miembros del candidato leen. Sin insert/update/delete desde la app.
grant select on table public.daily_briefs to authenticated;

drop policy if exists daily_briefs_member_select on public.daily_briefs;
create policy daily_briefs_member_select
  on public.daily_briefs for select to authenticated
  using (exists (
    select 1 from public.candidate_members m
    where m.candidate_id = daily_briefs.candidate_id
      and m.user_id = (select auth.uid())
  ));

commit;
