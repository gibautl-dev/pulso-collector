-- Rol de mínimo privilegio para el clasificador automático (pulso.ai.classify).
-- NO EJECUTADO. Requiere aprobación explícita. Ejecutar como administrador en
-- Supabase SQL Editor, DESPUÉS de schema.sql, collector_permissions.sql y de la
-- columna mentions.relevance.
-- No contiene contraseña: asignarla fuera del repo, por ejemplo con
--   \password pulso_classifier
-- y usarla solo en CLASSIFIER_PGPASSWORD (Render), nunca en commits ni logs.
-- Conexión por pooler de sesión: usuario pulso_classifier.<project_ref>.
begin;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'pulso_classifier') then
    create role pulso_classifier login nosuperuser nocreatedb nocreaterole
      noinherit noreplication nobypassrls;
  end if;
end;
$$;
-- Atributos fijados en CREATE ROLE. En Supabase el admin no es superusuario y no
-- puede ejecutar ALTER ROLE ... NOSUPERUSER/NOREPLICATION; verificar con pg_roles.
alter role pulso_classifier set statement_timeout = '30s';
alter role pulso_classifier set lock_timeout = '5s';

grant connect on database postgres to pulso_classifier;
grant usage on schema public to pulso_classifier;

-- Partir de cero en las tablas que toca (idempotente). Sin DELETE, INSERT ni TRUNCATE.
revoke all on public.candidates, public.topics, public.mentions from pulso_classifier;

-- Lectura por columnas: no ve alert_feeds (URLs privadas), cuentas ni métricas.
grant select (id, slug, name) on public.candidates to pulso_classifier;
grant select (id, candidate_id, label) on public.topics to pulso_classifier;
grant select (id, candidate_id, source, outlet, title, content, collected_at,
              tone, target, tone_confidence, tone_reason, topic_id, relevance,
              classified_at, classification_model, classification_prompt_version)
  on public.mentions to pulso_classifier;

-- Escritura SOLO en columnas de clasificación. No puede cambiar URL, texto, fuente,
-- métricas ni candidato. La FK (candidate_id, topic_id) -> topics se valida igual.
grant update (tone, target, tone_confidence, tone_reason, topic_id, relevance,
              classified_at, classification_model, classification_prompt_version)
  on public.mentions to pulso_classifier;

-- RLS: mismo patrón que collector_*; backend confiable sin BYPASSRLS.
drop policy if exists classifier_select on public.candidates;
create policy classifier_select on public.candidates for select to pulso_classifier using (true);
drop policy if exists classifier_select on public.topics;
create policy classifier_select on public.topics for select to pulso_classifier using (true);
drop policy if exists classifier_select on public.mentions;
create policy classifier_select on public.mentions for select to pulso_classifier using (true);
drop policy if exists classifier_update on public.mentions;
create policy classifier_update on public.mentions for update to pulso_classifier
  using (true) with check (true);
commit;

-- Verificación sugerida (solo lectura), después de ejecutar:
-- select rolname, rolsuper, rolinherit, rolbypassrls, rolcanlogin from pg_roles where rolname = 'pulso_classifier';
-- select table_name, column_name, privilege_type from information_schema.column_privileges
--   where grantee = 'pulso_classifier' order by 1, 3, 2;
-- select tablename, policyname, cmd from pg_policies where 'pulso_classifier' = any(roles);
