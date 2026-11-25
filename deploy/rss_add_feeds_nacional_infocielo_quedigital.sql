-- Aplicado en pulso-demo el 2026-11-25 (hora de Argentina). Suma 3 feeds RSS oficiales a Kicillof y Milei, sin
-- borrar ni reactivar los que se sacaron (Diputados Bonaerenses, InfoPlatense).
-- Sánchez no se toca.
--
-- Backup ANTES de aplicar (en el SQL Editor, exportar el resultado a JSON):
--
--   select c.slug, cs.settings, cs.updated_at
--     from public.candidate_sources cs
--     join public.candidates c on c.id = cs.candidate_id
--    where cs.source = 'rss_media'
--      and c.slug in ('axel-kicillof', 'milei');
--
-- Guardar esa salida (por ejemplo
-- backup_candidate_sources_pre_rss_add_YYYY-MM-DD.json). Si hay que
-- volver atrás, restaurar settings desde ese backup:
--
--   update public.candidate_sources cs
--      set settings = :settings_del_backup,
--          updated_at = now()
--    where cs.source = 'rss_media'
--      and cs.candidate_id = (select id from public.candidates where slug = :slug);
--
-- Feeds verificados el 2026-11-25 (hora de Argentina), con identificación
-- honesta: responden RSS vivo.
--   https://www.radionacional.com.ar/feed/
--   https://www.infocielo.com/rss
--   https://quedigital.com.ar/feed
--
-- El UPDATE es aditivo: solo agrega las URLs que todavía no están en
-- settings.feeds. No cambia enabled ni el resto de settings.

begin;

with new_feeds as (
  select jsonb_build_array(
    'https://www.radionacional.com.ar/feed/',
    'https://www.infocielo.com/rss',
    'https://quedigital.com.ar/feed'
  ) as urls
)
update public.candidate_sources cs
   set settings = jsonb_set(
         coalesce(cs.settings, '{}'::jsonb),
         '{feeds}',
         coalesce(cs.settings->'feeds', '[]'::jsonb) || coalesce((
           select jsonb_agg(to_jsonb(t.u))
           from jsonb_array_elements_text((select urls from new_feeds)) as t(u)
           where not exists (
             select 1
               from jsonb_array_elements_text(coalesce(cs.settings->'feeds', '[]'::jsonb)) as e(v)
              where e.v = t.u
           )
         ), '[]'::jsonb)
       ),
       updated_at = now()
 where cs.source = 'rss_media'
   and cs.candidate_id in (
     select id from public.candidates where slug in ('axel-kicillof', 'milei')
   );

commit;
