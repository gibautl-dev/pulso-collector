-- Ejecutar como administrador en Supabase, DESPUÉS del schema.sql existente.
-- No contiene contraseña. Asignarla fuera del repo con \password pulso_collector.
begin;
do $$
begin
  if not exists(select 1 from pg_roles where rolname='pulso_collector') then
    create role pulso_collector login nosuperuser nocreatedb nocreaterole
      noinherit noreplication nobypassrls;
  end if;
end;
$$;
grant connect on database postgres to pulso_collector;
grant usage on schema public to pulso_collector;
grant select on public.candidates,public.candidate_sources,public.mentions to pulso_collector;
grant insert on public.mentions,public.source_runs to pulso_collector;
grant update on public.mentions,public.candidate_sources to pulso_collector;

-- Rol de backend confiable: acceso a todos los candidatos, sin BYPASSRLS.
-- No se modifican las políticas de los usuarios del front.
drop policy if exists collector_select on public.candidates;
create policy collector_select on public.candidates for select to pulso_collector using (true);
drop policy if exists collector_select on public.candidate_sources;
create policy collector_select on public.candidate_sources for select to pulso_collector using (true);
drop policy if exists collector_update on public.candidate_sources;
create policy collector_update on public.candidate_sources for update to pulso_collector
 using (true) with check (true);
drop policy if exists collector_select on public.mentions;
create policy collector_select on public.mentions for select to pulso_collector using (true);
drop policy if exists collector_insert on public.mentions;
create policy collector_insert on public.mentions for insert to pulso_collector with check (true);
drop policy if exists collector_update on public.mentions;
create policy collector_update on public.mentions for update to pulso_collector
 using (true) with check (true);
drop policy if exists collector_insert on public.source_runs;
create policy collector_insert on public.source_runs for insert to pulso_collector with check (true);
commit;
