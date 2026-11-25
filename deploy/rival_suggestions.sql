-- Sugerencias de rivales con IA y altas pendientes (panel Active).
-- ESTE ARCHIVO NO SE EJECUTÓ. No aplicarlo hasta que Leandro lo apruebe.
-- No contiene secretos. No cambia roles de collector/classifier. No invita usuarios.
-- No enciende recolección: un pendiente no entra en public.candidates, así que
-- el cron actual no lo va a medir.
--
-- Qué crearía:
--   * public.rival_suggestion_runs: caché de cada corrida on demand (staff).
--   * public.pending_candidates: un rival/candidato pedido a mano o desde una
--     sugerencia, con estado fijo 'pendiente_de_alta'. No se recolecta hasta
--     una aprobación posterior (fuera de esta migración).
--   * Políticas: solo pulso_staff lee y escribe estas tablas. El cliente no
--     las ve. El staff puede leer costo y fecha de ai_answers (ya existentes)
--     para estimar el costo mensual de En la IA; no se abre daily_usage.
--
-- Costo de aplicar el SQL: USD 0. Cada clic en "Sugerir rivales con IA"
-- gasta tokens del modelo (por defecto gpt-6-luna, sin búsqueda web), con
-- tope por llamada. Ver deploy/RIVAL_SUGGESTIONS.md.

begin;

create table if not exists public.rival_suggestion_runs (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  prompt_version text not null,
  model text,
  suggestions jsonb not null default '[]'::jsonb,
  cost_usd numeric(12, 6) check (cost_usd is null or cost_usd >= 0),
  usage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

comment on table public.rival_suggestion_runs is
  'Caché de sugerencias de rivales pedidas a mano por el equipo de Active. No se agregan solos.';

create index if not exists rival_suggestion_runs_candidate_created
  on public.rival_suggestion_runs (candidate_id, created_at desc);

create table if not exists public.pending_candidates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  slug text check (slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  arena text,
  status text not null default 'pendiente_de_alta'
    check (status in ('pendiente_de_alta')),
  requested_for_candidate_id uuid not null references public.candidates(id) on delete cascade,
  requested_level text not null check (requested_level in ('radar', 'comparativo', 'completo')),
  source text not null check (source in ('manual', 'ai_suggestion')),
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

comment on table public.pending_candidates is
  'Candidato o rival pedido que Pulso todavía no mide. No se recolecta hasta una aprobación de Active.';

create index if not exists pending_candidates_for
  on public.pending_candidates (requested_for_candidate_id, created_at desc);

alter table public.rival_suggestion_runs enable row level security;
alter table public.pending_candidates enable row level security;

revoke all on table public.rival_suggestion_runs from public, anon, authenticated, pulso_collector, pulso_classifier;
revoke all on table public.pending_candidates from public, anon, authenticated, pulso_collector, pulso_classifier;
grant all on table public.rival_suggestion_runs to service_role;
grant all on table public.pending_candidates to service_role;
grant select, insert on table public.rival_suggestion_runs to authenticated;
grant select, insert on table public.pending_candidates to authenticated;

drop policy if exists rival_suggestion_runs_staff_select on public.rival_suggestion_runs;
create policy rival_suggestion_runs_staff_select on public.rival_suggestion_runs
  for select to authenticated
  using (exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid())));

drop policy if exists rival_suggestion_runs_staff_insert on public.rival_suggestion_runs;
create policy rival_suggestion_runs_staff_insert on public.rival_suggestion_runs
  for insert to authenticated
  with check (exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid())));

drop policy if exists pending_candidates_staff_select on public.pending_candidates;
create policy pending_candidates_staff_select on public.pending_candidates
  for select to authenticated
  using (exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid())));

drop policy if exists pending_candidates_staff_insert on public.pending_candidates;
create policy pending_candidates_staff_insert on public.pending_candidates
  for insert to authenticated
  with check (exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid())));

-- El staff puede leer costos de En la IA para armar la estimación (no el texto
-- no es necesario, pero las políticas actuales son por fila: se otorga SELECT
-- de la tabla si ya lo tenía el miembro; esta política cubre a un staff).
do $policies$
begin
  if to_regclass('public.ai_answers') is not null then
    execute 'drop policy if exists ai_answers_staff_select on public.ai_answers';
    execute $p$
      create policy ai_answers_staff_select on public.ai_answers
        for select to authenticated
        using (
          exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid()))
        )
    $p$;
  end if;
end
$policies$;

commit;
