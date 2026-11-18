-- Rollback de deploy/suspicious_accounts_guard_collector.sql.
-- Restaura el cuerpo anterior del trigger (el que llama auth.uid() primero).
-- No toca grants, policies, roles ni el esquema de la tabla.

begin;

create or replace function public.suspicious_accounts_guard_web_update()
returns trigger
language plpgsql
set search_path = public
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

alter function public.suspicious_accounts_guard_web_update() set search_path = public;

commit;
