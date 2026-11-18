-- YA APLICADA en pulso-demo el 2026-11-18 (migración
-- suspicious_accounts_tighten_grants). NO volver a correrla en ese proyecto.
--
-- En un proyecto nuevo no hace falta este archivo por separado: el mismo
-- ajuste quedó al final de deploy/suspicious_accounts.sql.
--
-- Corrige los privilegios por defecto de Supabase (ALL a authenticated) y
-- fija search_path del trigger (advisor function_search_path_mutable).

revoke all on public.suspicious_accounts from authenticated;
grant select on public.suspicious_accounts to authenticated;
grant update (status, status_note, status_updated_at, status_updated_by) on public.suspicious_accounts to authenticated;

revoke all on public.suspicious_accounts_web from authenticated;
grant select on public.suspicious_accounts_web to authenticated;

revoke all on public.suspicious_accounts from anon;
revoke all on public.suspicious_accounts_web from anon;

alter function public.suspicious_accounts_guard_web_update() set search_path = public;
