-- Aplicado en pulso-demo el 2026-11-25 (hora de Argentina).
-- GDELT se consulta como máximo una vez por hora (intervalo 3300 s = 55 min).
-- El cron de Render sigue en */20; RSS, Google News y Google Alerts no cambian.
-- El recolector reparte los candidatos en ticks :00 / :20 / :40 UTC.

update public.source_catalog
   set interval_seconds = 3300
 where source = 'gdelt';

update public.candidate_sources
   set interval_seconds = 3300,
       updated_at = now()
 where source = 'gdelt';
