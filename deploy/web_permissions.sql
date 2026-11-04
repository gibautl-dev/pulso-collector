-- Pulso web app: lectura para usuarios autenticados, acotada por membresía.
-- ESTE ARCHIVO NO SE EJECUTÓ. Revisarlo y correrlo una vez en el SQL editor
-- de Supabase (proyecto pulso-demo) cuando se apruebe.
--
-- Modelo:
--   * Login con Supabase Auth (email, solo por invitación).
--   * public.candidate_members dice qué usuario ve qué candidato.
--   * Rol `authenticated`: SOLO SELECT, y solo filas de candidatos donde es
--     miembro. Sin INSERT/UPDATE/DELETE en ninguna tabla.
--   * Rol `anon`: nada.
--   * Columnas sensibles (keywords/cuentas/feeds de candidates, settings y
--     cursor de candidate_sources, cursor de source_runs) no se exponen.
--   * daily_usage y source_catalog: sin acceso para la app.
--   * Reemplaza las políticas "owner_read"/"candidates_owner_read" de
--     schema.sql (dueño único vía candidates.owner_user_id, hoy NULL en todos
--     los candidatos) por políticas de membresía. Hay que sacarlas porque
--     consultan candidates.owner_user_id, columna que deja de ser legible.
--     serp_snapshots y ai_outputs (aún sin uso) pasan al mismo modelo.
--   * No toca los roles pulso_collector ni pulso_classifier.

begin;

-- 1) Membresías ---------------------------------------------------------------
create table if not exists public.candidate_members (
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('viewer')),
  created_at timestamptz not null default now(),
  primary key (candidate_id, user_id)
);
create index if not exists candidate_members_user on public.candidate_members(user_id);

alter table public.candidate_members enable row level security;
revoke all on table public.candidate_members from public, anon, authenticated;
grant all on table public.candidate_members to service_role;
grant select on table public.candidate_members to authenticated;

drop policy if exists members_read_own on public.candidate_members;
create policy members_read_own on public.candidate_members
  for select to authenticated
  using (user_id = (select auth.uid()));

-- 2) Grants de lectura (por columnas donde hay datos sensibles) --------------
-- Por las dudas, anon sin nada en las tablas de producto.
revoke all on table public.candidates, public.topics, public.mentions,
  public.source_runs, public.candidate_sources, public.daily_usage,
  public.source_catalog, public.serp_snapshots, public.ai_outputs from anon;

-- candidates: solo identificación, no keywords/cuentas/feeds de alertas.
revoke select on table public.candidates from authenticated;
grant select (id, slug, name, created_at) on table public.candidates to authenticated;

grant select on table public.topics to authenticated;
grant select on table public.mentions to authenticated;

grant select (id, candidate_id, source, run_kind, started_at, finished_at,
  status, items_found, items_new, error)
  on table public.source_runs to authenticated;

grant select (candidate_id, source, enabled, interval_seconds, last_attempt_at,
  last_success_at, next_run_at, collection_started_at, baseline_started_at,
  requested_since, earliest_observed_at, latest_observed_at, coverage_status,
  coverage_from, coverage_to, updated_at)
  on table public.candidate_sources to authenticated;

-- Nada de escritura para authenticated (defensa en profundidad).
revoke insert, update, delete, truncate, references, trigger
  on table public.candidates, public.topics, public.mentions,
  public.source_runs, public.candidate_sources
  from authenticated;
revoke all on table public.daily_usage, public.source_catalog from authenticated;

-- 3) Políticas de lectura por membresía ---------------------------------------
drop policy if exists candidates_owner_read on public.candidates;
drop policy if exists owner_read on public.topics;
drop policy if exists owner_read on public.mentions;
drop policy if exists owner_read on public.serp_snapshots;
drop policy if exists owner_read on public.ai_outputs;

-- La subconsulta corre con los permisos del usuario: por la política de
-- candidate_members solo ve sus propias filas. (select auth.uid()) se evalúa
-- una vez por consulta.
drop policy if exists members_read on public.candidates;
create policy members_read on public.candidates
  for select to authenticated
  using (exists (select 1 from public.candidate_members m
    where m.candidate_id = candidates.id and m.user_id = (select auth.uid())));

do $$
declare t text;
begin
  foreach t in array array['topics','mentions','source_runs','candidate_sources','serp_snapshots','ai_outputs'] loop
    execute format('drop policy if exists members_read on public.%I', t);
    execute format($p$create policy members_read on public.%I
      for select to authenticated
      using (exists (select 1 from public.candidate_members m
        where m.candidate_id = %I.candidate_id and m.user_id = (select auth.uid())))$p$, t, t);
  end loop;
end;
$$;

commit;

-- 4) Dar acceso (después de invitar al usuario desde Authentication > Users) --
-- insert into public.candidate_members (candidate_id, user_id)
-- select c.id, u.id from public.candidates c, auth.users u
-- where c.slug = 'axel-kicillof' and u.email = 'leandrog@activemkt.com'
-- on conflict do nothing;

-- 5) Verificación sugerida -----------------------------------------------------
-- select tablename, policyname, roles, cmd from pg_policies
--  where schemaname = 'public' and 'authenticated' = any(roles) order by 1, 2;
-- select table_name, column_name from information_schema.column_privileges
--  where grantee = 'authenticated' and table_schema = 'public' order by 1, 2;
