-- Tope diario de "En la IA" POR CANDIDATO (USD por día, día de Buenos Aires).
-- Aprobado por Leandro el 2026-11-25: reemplaza al tope total de ai_visibility_cap.sql.
-- Aditiva e idempotente: no borra datos. La tabla vieja (ai_visibility_budget) queda
-- como está, sin uso, y su valor se usa como default inicial de cada candidato.
-- Costo de aplicar: USD 0.
--
-- - public.ai_visibility_candidate_budget: una fila por candidato (default USD 1,00).
--   Solo pulso_staff la ve y edita (/admin/gasto). El job (pulso_classifier) la lee y
--   solo escribe last_reached_on. Un candidato nuevo recibe su fila por trigger.
-- - public.ai_visibility_cap_reached_today(p_candidate_id): booleano para la web del
--   cliente, solo si el usuario ve ese candidato (miembro, rival asignado o staff).

begin;

create table if not exists public.ai_visibility_candidate_budget (
  candidate_id uuid primary key references public.candidates(id) on delete cascade,
  daily_budget_usd numeric(10, 4) not null default 1.00 check (daily_budget_usd >= 0 and daily_budget_usd <= 50),
  timezone text not null default 'America/Argentina/Buenos_Aires',
  last_reached_on date,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

comment on table public.ai_visibility_candidate_budget is
  'Tope diario de En la IA por candidato (USD, día de Buenos Aires). Editable por pulso_staff.';

-- Defaults: el valor del tope total anterior (USD 1,00), para todos los candidatos actuales.
insert into public.ai_visibility_candidate_budget (candidate_id, daily_budget_usd)
select c.id, coalesce((select b.daily_budget_usd from public.ai_visibility_budget b where b.id), 1.00)
  from public.candidates c
on conflict (candidate_id) do nothing;

comment on table public.ai_visibility_budget is
  'OBSOLETA desde 2026-11-25: el tope de En la IA es por candidato (ai_visibility_candidate_budget). Se conserva sin uso.';

-- Candidatos futuros: fila con el default al crearse.
create or replace function public.ai_visibility_candidate_budget_default()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.ai_visibility_candidate_budget (candidate_id) values (new.id)
    on conflict (candidate_id) do nothing;
  return new;
end;
$$;
revoke all on function public.ai_visibility_candidate_budget_default() from public, anon, authenticated;

drop trigger if exists candidates_ai_visibility_budget_default on public.candidates;
create trigger candidates_ai_visibility_budget_default
  after insert on public.candidates
  for each row execute function public.ai_visibility_candidate_budget_default();

alter table public.ai_visibility_candidate_budget enable row level security;

revoke all on table public.ai_visibility_candidate_budget from public, anon, authenticated;
grant select on table public.ai_visibility_candidate_budget to authenticated;
grant update (daily_budget_usd, updated_at, updated_by) on table public.ai_visibility_candidate_budget to authenticated;
grant select on table public.ai_visibility_candidate_budget to pulso_classifier;
grant update (last_reached_on) on table public.ai_visibility_candidate_budget to pulso_classifier;
grant all on table public.ai_visibility_candidate_budget to service_role;

drop policy if exists ai_visibility_candidate_budget_staff_select on public.ai_visibility_candidate_budget;
create policy ai_visibility_candidate_budget_staff_select on public.ai_visibility_candidate_budget
  for select to authenticated
  using (exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid())));

drop policy if exists ai_visibility_candidate_budget_staff_update on public.ai_visibility_candidate_budget;
create policy ai_visibility_candidate_budget_staff_update on public.ai_visibility_candidate_budget
  for update to authenticated
  using (exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid())));

drop policy if exists ai_visibility_candidate_budget_classifier_select on public.ai_visibility_candidate_budget;
create policy ai_visibility_candidate_budget_classifier_select on public.ai_visibility_candidate_budget
  for select to pulso_classifier using (true);

drop policy if exists ai_visibility_candidate_budget_classifier_update on public.ai_visibility_candidate_budget;
create policy ai_visibility_candidate_budget_classifier_update on public.ai_visibility_candidate_budget
  for update to pulso_classifier using (true) with check (true);

create or replace function public.ai_visibility_cap_reached_today(p_candidate_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select b.last_reached_on = (now() at time zone b.timezone)::date
       from public.ai_visibility_candidate_budget b
      where b.candidate_id = p_candidate_id),
    false)
  where auth.uid() is not null
    and (
      exists (select 1 from public.pulso_staff s where s.user_id = auth.uid())
      or exists (select 1 from public.candidate_members m
                  where m.candidate_id = p_candidate_id and m.user_id = auth.uid())
      or exists (select 1 from public.candidate_rivals r
                   join public.candidate_members m on m.candidate_id = r.candidate_id and m.user_id = auth.uid()
                  where r.rival_id = p_candidate_id)
    );
$$;

revoke all on function public.ai_visibility_cap_reached_today(uuid) from public, anon;
grant execute on function public.ai_visibility_cap_reached_today(uuid) to authenticated;

commit;
