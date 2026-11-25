-- Asistente de datos ("Preguntale a Pulso"): registro de preguntas, cupos y costo.
-- PROPUESTA: NO APLICADA. Requiere aprobación de Leandro antes de correrla en pulso-demo.
-- Idempotente. No contiene secretos. No cambia env, cron ni otras tablas.
--
-- Qué hace:
--  - public.assistant_questions: una fila por pregunta (pregunta, respuesta con
--    citas y cifras calculadas en código, herramientas usadas, modelo, costo).
--  - La web escribe con la sesión del usuario (authenticated); nunca service role.
--    Cada usuario ve SOLO sus preguntas y solo de candidatos de los que es
--    miembro (candidate_members). anon no recibe nada.
--  - Trigger de cupo: user_id = auth.uid() siempre, y rechaza la reserva si el
--    usuario pasó 20 preguntas/hora o 60/día, o si el total del día pasó 400
--    preguntas o USD 1 (filas sin costo cuentan como el tope por pregunta).
--  - assistant_quota(): cupo del usuario actual + uso total del día (sin datos
--    de otros usuarios), para que la web avise antes de llamar al modelo.
--  - La respuesta se completa una sola vez (status pending → final) y no se
--    puede editar ni borrar desde la web.
--
-- Supabase otorga ALL a authenticated en tablas nuevas: este archivo los revoca.
-- Costo de aplicar el SQL: USD 0. El costo del modelo es por pregunta (ver deploy/DATA_ASSISTANT.md).

begin;

create table if not exists public.assistant_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  question text not null check (char_length(question) between 3 and 400),
  page text check (page is null or char_length(page) <= 60),
  status text not null default 'pending' check (status in ('pending', 'ok', 'no_data', 'error', 'limited')),
  answer jsonb check (answer is null or jsonb_typeof(answer) = 'object'),
  tools jsonb not null default '[]'::jsonb check (jsonb_typeof(tools) = 'array'),
  model text,
  prompt_version text not null,
  cost_usd numeric(12, 6) check (cost_usd is null or (cost_usd >= 0 and cost_usd <= 0.05)),
  usage jsonb not null default '{}'::jsonb check (jsonb_typeof(usage) = 'object'),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

comment on table public.assistant_questions is
  'Preguntas al asistente de datos. Las cifras y citas de answer salen de herramientas en código sobre datos leídos con RLS; el modelo solo redacta.';
comment on column public.assistant_questions.tools is
  'Herramientas que eligió el modelo y sus parámetros acotados (nunca SQL).';

create index if not exists assistant_questions_user_created_idx
  on public.assistant_questions (user_id, created_at desc);
create index if not exists assistant_questions_created_idx
  on public.assistant_questions (created_at desc);
create index if not exists assistant_questions_candidate_user_idx
  on public.assistant_questions (candidate_id, user_id, created_at desc);

-- Cupos. Constantes iguales a web/src/lib/assistant/prompt.ts (LIMITS).
create or replace function public.assistant_questions_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_hour int;
  v_day int;
  v_total int;
  v_cost numeric;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires';
begin
  if tg_op = 'INSERT' then
    if v_uid is null then
      raise exception 'assistant_auth: falta sesión';
    end if;
    new.user_id := v_uid;
    new.status := 'pending';
    new.answer := null;
    new.cost_usd := null;
    new.created_at := now();
    new.finished_at := null;
    -- Serializa reservas del mismo usuario para que el cupo no se pase con ráfagas.
    perform pg_advisory_xact_lock(hashtextextended('assistant:' || v_uid::text, 0));
    select count(*) filter (where created_at > now() - interval '1 hour'),
           count(*) filter (where created_at > now() - interval '24 hours')
      into v_hour, v_day
      from public.assistant_questions where user_id = v_uid;
    if v_hour >= 20 or v_day >= 60 then
      raise exception 'assistant_limit: cupo del usuario';
    end if;
    select count(*), coalesce(sum(coalesce(cost_usd, case when status in ('pending', 'error') then 0.01 else 0 end)), 0)
      into v_total, v_cost
      from public.assistant_questions where created_at >= v_day_start;
    if v_total >= 400 or v_cost + 0.01 > 1 then
      raise exception 'assistant_limit: cupo diario';
    end if;
    return new;
  end if;
  -- UPDATE: solo se completa una vez la propia reserva.
  if old.status <> 'pending' then
    raise exception 'assistant_final: la respuesta ya está guardada';
  end if;
  if new.user_id <> old.user_id or new.candidate_id <> old.candidate_id or new.question <> old.question
     or new.created_at <> old.created_at or new.prompt_version <> old.prompt_version then
    raise exception 'assistant_immutable';
  end if;
  if new.status = 'pending' then
    raise exception 'assistant_final: estado inválido';
  end if;
  new.finished_at := now();
  return new;
end;
$$;

revoke all on function public.assistant_questions_guard() from public, anon, authenticated;

drop trigger if exists assistant_questions_guard on public.assistant_questions;
create trigger assistant_questions_guard
  before insert or update on public.assistant_questions
  for each row execute function public.assistant_questions_guard();

alter table public.assistant_questions enable row level security;
-- Sin FORCE: el trigger y assistant_quota() (security definer, dueño de la tabla)
-- tienen que contar filas de todos los usuarios para aplicar el cupo diario.
alter table public.assistant_questions no force row level security;
revoke all on table public.assistant_questions from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'pulso_collector') then
    execute 'revoke all on table public.assistant_questions from pulso_collector';
  end if;
  if exists (select 1 from pg_roles where rolname = 'pulso_classifier') then
    execute 'revoke all on table public.assistant_questions from pulso_classifier';
  end if;
end $$;
grant all on table public.assistant_questions to service_role;

grant select (id, candidate_id, question, page, status, answer, created_at, finished_at) on table public.assistant_questions to authenticated;
grant insert (candidate_id, question, page, prompt_version, status) on table public.assistant_questions to authenticated;
grant update (status, answer, tools, model, cost_usd, usage) on table public.assistant_questions to authenticated;

drop policy if exists assistant_questions_own_select on public.assistant_questions;
create policy assistant_questions_own_select
  on public.assistant_questions for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.candidate_members m
      where m.candidate_id = assistant_questions.candidate_id and m.user_id = (select auth.uid())
    )
  );

drop policy if exists assistant_questions_member_insert on public.assistant_questions;
create policy assistant_questions_member_insert
  on public.assistant_questions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.candidate_members m
      where m.candidate_id = assistant_questions.candidate_id and m.user_id = (select auth.uid())
    )
  );

drop policy if exists assistant_questions_own_finish on public.assistant_questions;
create policy assistant_questions_own_finish
  on public.assistant_questions for update to authenticated
  using (user_id = (select auth.uid()) and status = 'pending')
  with check (user_id = (select auth.uid()));

-- Cupo del usuario actual. Del resto solo devuelve totales del día (sin filas ni usuarios).
create or replace function public.assistant_quota()
returns table (user_last_hour int, user_today int, total_today int, cost_today_usd numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with day_start as (
    select date_trunc('day', now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires' as ts
  )
  select
    (select count(*)::int from public.assistant_questions where user_id = auth.uid() and created_at > now() - interval '1 hour'),
    (select count(*)::int from public.assistant_questions where user_id = auth.uid() and created_at > now() - interval '24 hours'),
    (select count(*)::int from public.assistant_questions, day_start where created_at >= day_start.ts),
    (select coalesce(sum(coalesce(cost_usd, case when status in ('pending', 'error') then 0.01 else 0 end)), 0)
       from public.assistant_questions, day_start where created_at >= day_start.ts)
  where auth.uid() is not null;
$$;

revoke all on function public.assistant_quota() from public, anon;
grant execute on function public.assistant_quota() to authenticated;

commit;
