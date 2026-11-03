-- Ejecutar DESPUÉS de schema.sql. Reemplazar nombre, variantes y slug.
-- Candidato temporal de ejemplo, no un candidato político real.
begin;
insert into public.candidates (slug,name,keywords,exclude_keywords)
values ('candidato-demo','NOMBRE APELLIDO',array['NOMBRE APELLIDO'],array[]::text[]);

-- Google News ya está habilitado y construye la consulta con keywords.
-- RSS de medios está habilitado pero requiere URLs verificadas de feeds.
update public.candidate_sources set settings = jsonb_build_object(
  'feeds', jsonb_build_array('https://REEMPLAZAR-POR-FEED-REAL/rss'),
  'own_domains', jsonb_build_array(),
  'reference_domains', jsonb_build_array()
) where candidate_id=(select id from public.candidates where slug='candidato-demo')
    and source='rss_media';

-- Opcional: crear la alerta manualmente, elegir entrega RSS y pegar su URL.
-- Luego habilitar google_alerts explícitamente:
-- update public.candidates set alert_feeds=array['https://www.google.com/alerts/feeds/ID/TOKEN']
-- where slug='candidato-demo';
-- update public.candidate_sources set enabled=true
-- where candidate_id=(select id from public.candidates where slug='candidato-demo')
--   and source='google_alerts';
commit;
