-- Pendiente de aplicar a mano cuando exista X_BEARER_TOKEN en el cron
-- y el código de feature/x-source esté desplegado.
-- NO cambia schema, roles ni políticas.
--
-- Revisión de permisos de pulso_collector:
--   * source_catalog ya tiene la fila 'x' (intervalo por defecto 1200).
--   * El trigger initialize_candidate_sources crea la fila en candidate_sources
--     apagada al insertar el candidato. Si ya existe, solo hace falta este UPDATE.
--   * mentions.source referencia source_catalog, así que se pueden insertar
--     menciones con source='x' sin cambio de schema.
--   * pulso_collector ya tiene SELECT/UPDATE en candidate_sources (cursor,
--     last_attempt_at, next_run_at, etc.) e INSERT/UPDATE en mentions y
--     INSERT en source_runs. No hace falta un GRANT nuevo.
--   * candidates.x_daily_cap ya existe (por defecto 300) y el adaptador lo
--     usa si settings no define max_posts_per_day.
--   * No usamos daily_usage (el adaptador lleva la cuota en cursor.quota)
--     para no pedir permisos extra.
--
-- Este script sube el intervalo a 3600 s (1 hora) para no gastar el tope
-- diario en las primeras corridas de un cron de 20 minutos. No hay un CHECK
-- de intervalo mínimo para 'x'; si se quiere uno como el de YouTube, hay
-- que proponer un cambio de schema aparte. No aplicar este archivo solo.
--
-- Reemplazar el slug si no es axel-kicillof.

begin;

insert into public.candidate_sources (candidate_id, source, enabled, interval_seconds, settings)
select c.id, 'x', false, 3600, '{}'::jsonb
  from public.candidates c
 where c.slug = 'axel-kicillof'
on conflict (candidate_id, source) do nothing;

update public.candidate_sources
   set enabled = true,
       interval_seconds = greatest(interval_seconds, 3600),
       settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
         'exclude_retweets', true,
         'exclude_replies', true,
         'lang_es', true,
         'max_posts_per_day', 300,
         'max_requests_per_day', 10,
         'max_posts_per_run', 25
       ),
       updated_at = now()
 where candidate_id = (select id from public.candidates where slug = 'axel-kicillof')
   and source = 'x';

commit;
