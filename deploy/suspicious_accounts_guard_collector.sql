-- Arreglo mínimo del trigger de cuentas sospechosas.
--
-- Causa (pulso-demo, 2026-11-18): pulso_collector ejecutó
-- INSERT ... ON CONFLICT DO UPDATE ... RETURNING (xmax = 0) as inserted
-- sobre public.suspicious_accounts. El INSERT inicial de una cuenta nueva
-- no dispara el trigger (es BEFORE UPDATE) y persiste. El upsert posterior
-- toma el camino UPDATE, corre suspicious_accounts_guard_web_update() como
-- SECURITY INVOKER y en la línea `if auth.uid() is null` falla con
-- 42501 permission denied for schema auth: el rol tiene EXECUTE sobre
-- auth.uid() pero no USAGE sobre el schema auth.
--
-- tighten_grants no revocó grants del recolector ni de la tabla; solo
-- ajustó authenticated/anon y fijó search_path=public en la función.
-- auth.uid() ya iba calificado, así que el search_path no es la causa.
--
-- Este archivo no otorga USAGE sobre auth, no toca grants, policies,
-- roles ni el esquema de la tabla. Solo evita llamar auth.uid() cuando
-- current_user es pulso_collector. El camino web (authenticated + JWT)
-- sigue igual. NO aplicar en producción hasta que se apruebe.

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
  -- El recolector no tiene USAGE sobre schema auth; no llamar auth.uid().
  -- Sesión de servicio, sin JWT: puede actualizar puntaje y evidencia.
  if current_user = 'pulso_collector' then
    return new;
  end if;
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
