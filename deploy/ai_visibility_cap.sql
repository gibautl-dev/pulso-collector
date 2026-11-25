-- Tope diario de "En la IA" (USD por día, total de todos los candidatos, día de Buenos Aires).
-- Aprobado por Leandro el 2026-11-25 junto con el panel Gasto. Idempotente. Costo USD 0.
--
-- - public.ai_visibility_budget: una sola fila (id = true) con el tope. El equipo de
--   Active (pulso_staff) lo lee y lo edita desde /admin/gasto. Nadie más lo ve.
-- - El job (rol pulso_classifier) suma ai_answers.cost del día de Buenos Aires y
--   no hace la próxima pregunta si no entra en el tope. Cuando corta, marca
--   last_reached_on (única columna que puede escribir).
-- - public.ai_visibility_cap_reached_today(): booleano para la web del cliente
--   (mensaje "volvé mañana"). No expone montos.

begin;

create table if not exists public.ai_visibility_budget (
  id boolean primary key default true check (id),
  daily_budget_usd numeric(10, 4) not null default 1.00 check (daily_budget_usd >= 0 and daily_budget_usd <= 50),
  timezone text not null default 'America/Argentina/Buenos_Aires',
  last_reached_on date,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

comment on table public.ai_visibility_budget is
  'Tope diario total de En la IA (USD, día de Buenos Aires). Editable por pulso_staff.';

insert into public.ai_visibility_budget (id, daily_budget_usd) values (true, 1.00)
  on conflict (id) do nothing;

alter table public.ai_visibility_budget enable row level security;

revoke all on table public.ai_visibility_budget from public, anon, authenticated;
grant select on table public.ai_visibility_budget to authenticated;
grant update (daily_budget_usd, updated_at, updated_by) on table public.ai_visibility_budget to authenticated;
grant select on table public.ai_visibility_budget to pulso_classifier;
grant update (last_reached_on) on table public.ai_visibility_budget to pulso_classifier;
grant all on table public.ai_visibility_budget to service_role;

drop policy if exists ai_visibility_budget_staff_select on public.ai_visibility_budget;
create policy ai_visibility_budget_staff_select on public.ai_visibility_budget
  for select to authenticated
  using (exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid())));

drop policy if exists ai_visibility_budget_staff_update on public.ai_visibility_budget;
create policy ai_visibility_budget_staff_update on public.ai_visibility_budget
  for update to authenticated
  using (exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid())));

drop policy if exists ai_visibility_budget_classifier_select on public.ai_visibility_budget;
create policy ai_visibility_budget_classifier_select on public.ai_visibility_budget
  for select to pulso_classifier using (true);

drop policy if exists ai_visibility_budget_classifier_update on public.ai_visibility_budget;
create policy ai_visibility_budget_classifier_update on public.ai_visibility_budget
  for update to pulso_classifier using (true) with check (true);

create or replace function public.ai_visibility_cap_reached_today()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select b.last_reached_on = (now() at time zone b.timezone)::date
       from public.ai_visibility_budget b where b.id),
    false)
  where auth.uid() is not null;
$$;

revoke all on function public.ai_visibility_cap_reached_today() from public, anon;
grant execute on function public.ai_visibility_cap_reached_today() to authenticated;

commit;
