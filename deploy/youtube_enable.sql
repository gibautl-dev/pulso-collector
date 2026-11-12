-- Pendiente de aplicar a mano cuando exista YOUTUBE_API_KEY en el cron
-- y el código de feature/youtube-source esté desplegado.
-- NO cambia schema, roles ni políticas.
--
-- Revisión de permisos de pulso_collector:
--   * source_catalog ya tiene la fila 'youtube' (intervalo mínimo 3600).
--   * El trigger initialize_candidate_sources crea la fila en candidate_sources
--     apagada al insertar el candidato. Si ya existe, solo hace falta este UPDATE.
--   * mentions.source referencia source_catalog, así que se pueden insertar
--     menciones con source='youtube' sin cambio de schema.
--   * pulso_collector ya tiene SELECT/UPDATE en candidate_sources (cursor,
--     last_attempt_at, next_run_at, etc.) e INSERT/UPDATE en mentions y
--     INSERT en source_runs. No hace falta un GRANT nuevo.
--   * No usamos daily_usage (el adaptador lleva la cuota en cursor.quota)
--     para no pedir permisos extra.
--
-- Reemplazar el slug si no es axel-kicillof.

begin;

insert into public.candidate_sources (candidate_id, source, enabled, interval_seconds, settings)
select c.id, 'youtube', false, 3600, '{}'::jsonb
  from public.candidates c
 where c.slug = 'axel-kicillof'
on conflict (candidate_id, source) do nothing;

update public.candidate_sources
   set enabled = true,
       interval_seconds = greatest(interval_seconds, 3600),
       settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
         'collect_comments', true,
         'max_comment_videos', 5,
         'max_comments_per_video', 20,
         'max_searches_per_day', 20,
         'max_units_per_day', 3000
       ),
       updated_at = now()
 where candidate_id = (select id from public.candidates where slug = 'axel-kicillof')
   and source = 'youtube';

commit;
