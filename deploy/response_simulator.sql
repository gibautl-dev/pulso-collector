-- Simulador de respuesta: registro privado de simulaciones y cupos.
-- Aplicada en pulso-demo el 2026-11-25 (aprobada por Leandro).
-- Idempotente. No contiene secretos. No cambia env ni el cron.
--
-- Qué hace:
--   * response_simulations: cada simulación (borrador, salida, costo). Solo el
--     autor ve las suyas. Nadie escribe directo en la tabla.
--   * response_simulator_settings: una fila con los topes (solo staff la cambia).
--   * start_response_simulation(): chequea acceso (candidate_members o
--     pulso_staff), cupo por usuario (ventana corta y por día) y presupuesto
--     diario global, y reserva el costo máximo antes de llamar al modelo.
--   * finish_response_simulation(): guarda el resultado de una simulación propia
--     que sigue "running". El presupuesto cuenta siempre max(reservado, costo):
--     no se puede abaratar una simulación después de reservarla.
-- La web llama a estas funciones con la sesión del usuario (sin service role).
-- La clave del modelo vive solo en el servidor web. Nada se publica.
--
-- Supabase otorga ALL a authenticated en tablas nuevas: este archivo los revoca.
-- Costo de aplicar el SQL: USD 0.

begin;

create table if not exists public.response_simulator_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  max_request_usd numeric(10, 6) not null default 0.01 check (max_request_usd > 0),
  daily_budget_usd numeric(10, 4) not null default 1.00 check (daily_budget_usd >= 0),
  per_user_window integer not null default 5 check (per_user_window > 0),
  window_minutes integer not null default 10 check (window_minutes > 0),
  per_user_daily integer not null default 30 check (per_user_daily > 0),
  timezone text not null default 'America/Argentina/Buenos_Aires',
  updated_at timestamptz not null default now()
);
insert into public.response_simulator_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.response_simulations (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  user_id uuid not null,
  draft text not null check (char_length(draft) between 20 and 1500),
  status text not null default 'running' check (status in ('running', 'ok', 'error')),
  output jsonb not null default '{}'::jsonb check (jsonb_typeof(output) = 'object'),
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  model text,
  prompt_version text,
  reserved_usd numeric(12, 6) not null check (reserved_usd >= 0),
  cost_usd numeric(12, 6) check (cost_usd is null or cost_usd >= 0),
  usage jsonb not null default '{}'::jsonb check (jsonb_typeof(usage) = 'object'),
  error text,
  origin text not null default 'ai' check (origin in ('ai', 'fixture_example')),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

comment on table public.response_simulations is
  'Simulador de respuesta: borradores privados y la estimación de IA por público. Solo el autor las ve. No se publica nada.';
comment on column public.response_simulations.context is
  'Datos que vio el modelo: temas, públicos y menciones con referencia corta (M1…). Cada contraargumento cita refs de acá.';
comment on column public.response_simulations.reserved_usd is
  'Costo máximo estimado antes de llamar al modelo. El presupuesto diario cuenta greatest(reserved_usd, cost_usd).';

create index if not exists response_simulations_user_created_idx
  on public.response_simulations (user_id, created_at desc);
create index if not exists response_simulations_created_idx
  on public.response_simulations (created_at desc);
create index if not exists response_simulations_candidate_user_idx
  on public.response_simulations (candidate_id, user_id, created_at desc);

alter table public.response_simulations enable row level security;
alter table public.response_simulations force row level security;
alter table public.response_simulator_settings enable row level security;
alter table public.response_simulator_settings force row level security;

revoke all on table public.response_simulations from public, anon, authenticated, pulso_collector, pulso_classifier;
revoke all on table public.response_simulator_settings from public, anon, authenticated, pulso_collector, pulso_classifier;
grant all on table public.response_simulations to service_role;
grant all on table public.response_simulator_settings to service_role;

-- El autor lee las suyas, mientras siga teniendo acceso al candidato.
grant select on table public.response_simulations to authenticated;
drop policy if exists response_simulations_author_select on public.response_simulations;
create policy response_simulations_author_select
  on public.response_simulations for select to authenticated
  using (
    user_id = (select auth.uid())
    and (
      exists (select 1 from public.candidate_members m
              where m.candidate_id = response_simulations.candidate_id
                and m.user_id = (select auth.uid()))
      or exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid()))
    )
  );

-- Topes: cualquier usuario con sesión los lee (para avisar en la UI); solo staff los cambia.
grant select, update on table public.response_simulator_settings to authenticated;
drop policy if exists response_simulator_settings_read on public.response_simulator_settings;
create policy response_simulator_settings_read
  on public.response_simulator_settings for select to authenticated using (true);
drop policy if exists response_simulator_settings_staff_update on public.response_simulator_settings;
create policy response_simulator_settings_staff_update
  on public.response_simulator_settings for update to authenticated
  using (exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid())));

create or replace function public.start_response_simulation(
  p_candidate_id uuid,
  p_draft text,
  p_reserve_usd numeric
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_cfg public.response_simulator_settings%rowtype;
  v_day_start timestamptz;
  v_recent integer;
  v_today integer;
  v_spent numeric;
  v_reserve numeric;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'pulso:auth_required' using errcode = '42501';
  end if;
  if not (
    exists (select 1 from public.candidate_members m where m.candidate_id = p_candidate_id and m.user_id = v_uid)
    or exists (select 1 from public.pulso_staff s where s.user_id = v_uid)
  ) then
    raise exception 'pulso:forbidden' using errcode = '42501';
  end if;
  if p_draft is null or char_length(p_draft) < 20 or char_length(p_draft) > 1500 then
    raise exception 'pulso:invalid_draft' using errcode = '22023';
  end if;

  select * into v_cfg from public.response_simulator_settings where id;
  if not found or not v_cfg.enabled then
    raise exception 'pulso:disabled' using errcode = 'P0001';
  end if;

  v_reserve := coalesce(p_reserve_usd, v_cfg.max_request_usd);
  if v_reserve > v_cfg.max_request_usd then
    raise exception 'pulso:request_too_expensive' using errcode = 'P0001';
  end if;
  -- Piso: nunca se reserva menos que un décimo del tope por simulación.
  v_reserve := greatest(v_reserve, v_cfg.max_request_usd / 10);

  -- Serializa los chequeos de cupo para que dos pedidos simultáneos no pasen juntos.
  perform pg_advisory_xact_lock(hashtext('pulso.response_simulations.budget'));

  v_day_start := (date_trunc('day', now() at time zone v_cfg.timezone)) at time zone v_cfg.timezone;

  select count(*) into v_recent from public.response_simulations
   where user_id = v_uid and created_at > now() - make_interval(mins => v_cfg.window_minutes);
  if v_recent >= v_cfg.per_user_window then
    raise exception 'pulso:rate_limited' using errcode = 'P0001';
  end if;

  select count(*) into v_today from public.response_simulations
   where user_id = v_uid and created_at >= v_day_start;
  if v_today >= v_cfg.per_user_daily then
    raise exception 'pulso:user_daily_limit' using errcode = 'P0001';
  end if;

  select coalesce(sum(greatest(reserved_usd, coalesce(cost_usd, 0))), 0) into v_spent
    from public.response_simulations where created_at >= v_day_start;
  if v_spent + v_reserve > v_cfg.daily_budget_usd then
    raise exception 'pulso:daily_budget' using errcode = 'P0001';
  end if;

  insert into public.response_simulations (candidate_id, user_id, draft, reserved_usd)
  values (p_candidate_id, v_uid, p_draft, v_reserve)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.finish_response_simulation(
  p_id uuid,
  p_status text,
  p_output jsonb,
  p_context jsonb,
  p_model text,
  p_prompt_version text,
  p_cost_usd numeric,
  p_usage jsonb,
  p_error text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'pulso:auth_required' using errcode = '42501';
  end if;
  if p_status not in ('ok', 'error') then
    raise exception 'pulso:invalid_status' using errcode = '22023';
  end if;
  update public.response_simulations
     set status = p_status,
         output = case when p_status = 'ok' and jsonb_typeof(p_output) = 'object' then p_output else '{}'::jsonb end,
         context = case when jsonb_typeof(p_context) = 'object' then p_context else '{}'::jsonb end,
         model = left(p_model, 120),
         prompt_version = left(p_prompt_version, 120),
         cost_usd = case when p_cost_usd is null or p_cost_usd < 0 then null else p_cost_usd end,
         usage = case when jsonb_typeof(p_usage) = 'object' then p_usage else '{}'::jsonb end,
         error = left(p_error, 300),
         finished_at = now()
   where id = p_id and user_id = v_uid and status = 'running';
  if not found then
    raise exception 'pulso:not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.start_response_simulation(uuid, text, numeric) from public, anon;
revoke all on function public.finish_response_simulation(uuid, text, jsonb, jsonb, text, text, numeric, jsonb, text) from public, anon;
grant execute on function public.start_response_simulation(uuid, text, numeric) to authenticated;
grant execute on function public.finish_response_simulation(uuid, text, jsonb, jsonb, text, text, numeric, jsonb, text) to authenticated;

commit;
