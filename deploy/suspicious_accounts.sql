-- Cuentas sospechosas (propuesta). NO aplicar hasta que se apruebe el esquema.
-- Detección local a partir de menciones ya guardadas. Nunca denuncia en lote
-- ni llama a las APIs de X o YouTube para actuar sobre una cuenta.
--
-- El recolector (pulso_collector) escribe puntaje, señales y evidencia, y no
-- pisa el estado de revisión humano. La web (authenticated, vía
-- candidate_members) lee las filas del candidato y solo puede actualizar
-- status, status_note, status_updated_at y status_updated_by.
-- anon no recibe permisos.

begin;

create table if not exists public.suspicious_accounts (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  platform text not null check (platform in ('x', 'youtube')),
  account_key text not null,
  handle text,
  display_name text,
  profile_url text,
  score integer not null check (score >= 0 and score <= 100),
  signals jsonb not null default '[]'::jsonb,
  mention_count integer not null default 0,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  account_created_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'reviewed_suspicious', 'discarded', 'reported_manual')),
  status_note text,
  status_updated_at timestamptz,
  status_updated_by uuid,
  detected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, platform, account_key)
);

comment on table public.suspicious_accounts is
  'Cuentas marcadas por señales locales para revisión humana. La denuncia, si corresponde, es manual.';
comment on column public.suspicious_accounts.account_key is
  'Handle normalizado en X o channel id en YouTube.';
comment on column public.suspicious_accounts.signals is
  'Lista de {type, weight, summary, evidence[]}. evidence incluye mention_id, url, published_at, excerpt.';
comment on column public.suspicious_accounts.status is
  'pending | reviewed_suspicious | discarded | reported_manual. Lo actualiza una persona, no el detector.';

create index if not exists suspicious_accounts_candidate_score_idx
  on public.suspicious_accounts (candidate_id, score desc, detected_at desc);
create index if not exists suspicious_accounts_candidate_status_idx
  on public.suspicious_accounts (candidate_id, status);

create or replace view public.suspicious_accounts_web
  with (security_invoker = true) as
select
  s.id,
  s.candidate_id,
  c.slug as candidate_slug,
  s.platform,
  s.account_key,
  s.handle,
  s.display_name,
  s.profile_url,
  s.score,
  s.signals,
  s.mention_count,
  s.first_seen_at,
  s.last_seen_at,
  s.account_created_at,
  s.status,
  s.status_note,
  s.status_updated_at,
  s.status_updated_by,
  s.detected_at
from public.suspicious_accounts s
join public.candidates c on c.id = s.candidate_id;

comment on view public.suspicious_accounts_web is
  'Vista de lectura para la pantalla /c/[slug]/sospechosas. El update de estado va a la tabla.';

alter table public.suspicious_accounts enable row level security;
alter table public.suspicious_accounts force row level security;

grant select, insert, update on public.suspicious_accounts to pulso_collector;

-- Recolector: lee y escribe puntaje/evidencia. El estado humano se conserva
-- en el upsert de la aplicación (ON CONFLICT ... status = suspicious_accounts.status).
-- Las policies limitan filas, no columnas; el código no pisa status.
drop policy if exists suspicious_accounts_collector_select on public.suspicious_accounts;
create policy suspicious_accounts_collector_select
  on public.suspicious_accounts
  for select
  to pulso_collector
  using (true);

drop policy if exists suspicious_accounts_collector_insert on public.suspicious_accounts;
create policy suspicious_accounts_collector_insert
  on public.suspicious_accounts
  for insert
  to pulso_collector
  with check (true);

drop policy if exists suspicious_accounts_collector_update on public.suspicious_accounts;
create policy suspicious_accounts_collector_update
  on public.suspicious_accounts
  for update
  to pulso_collector
  using (true)
  with check (true);

-- Web: miembros del candidato ven las cuentas de ese candidato.
drop policy if exists suspicious_accounts_member_select on public.suspicious_accounts;
create policy suspicious_accounts_member_select
  on public.suspicious_accounts
  for select
  to authenticated
  using (
    exists (
      select 1 from public.candidate_members m
      where m.candidate_id = suspicious_accounts.candidate_id
        and m.user_id = auth.uid()
    )
  );

-- Excepción documentada al modelo de solo lectura de la web: una persona
-- puede marcar el estado de revisión. El trigger rechaza cualquier otro campo.
drop policy if exists suspicious_accounts_member_update_status on public.suspicious_accounts;
create policy suspicious_accounts_member_update_status
  on public.suspicious_accounts
  for update
  to authenticated
  using (
    exists (
      select 1 from public.candidate_members m
      where m.candidate_id = suspicious_accounts.candidate_id
        and m.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.candidate_members m
      where m.candidate_id = suspicious_accounts.candidate_id
        and m.user_id = auth.uid()
    )
  );

create or replace function public.suspicious_accounts_guard_web_update()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  -- El recolector (rol de servicio, sin JWT) puede actualizar puntaje y evidencia.
  if auth.uid() is null then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.candidate_id is distinct from old.candidate_id
     or new.platform is distinct from old.platform
     or new.account_key is distinct from old.account_key
     or new.handle is distinct from old.handle
     or new.display_name is distinct from old.display_name
     or new.profile_url is distinct from old.profile_url
     or new.score is distinct from old.score
     or new.signals is distinct from old.signals
     or new.mention_count is distinct from old.mention_count
     or new.first_seen_at is distinct from old.first_seen_at
     or new.last_seen_at is distinct from old.last_seen_at
     or new.account_created_at is distinct from old.account_created_at
     or new.detected_at is distinct from old.detected_at then
    raise exception 'solo se puede actualizar el estado de revisión';
  end if;
  new.status_updated_at := now();
  new.status_updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists suspicious_accounts_guard_web_update on public.suspicious_accounts;
create trigger suspicious_accounts_guard_web_update
  before update on public.suspicious_accounts
  for each row execute function public.suspicious_accounts_guard_web_update();

grant select on public.suspicious_accounts to authenticated;
grant update (status, status_note, status_updated_at, status_updated_by) on public.suspicious_accounts to authenticated;
grant select on public.suspicious_accounts_web to authenticated;

revoke all on public.suspicious_accounts from anon;
revoke all on public.suspicious_accounts_web from anon;

commit;
