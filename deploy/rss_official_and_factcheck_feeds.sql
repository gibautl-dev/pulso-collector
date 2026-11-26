-- Pendiente de aplicar en pulso-demo (requiere aprobación). No cambia el esquema:
-- solo actualiza candidate_sources.settings de rss_media.
--
-- Qué hace (idempotente):
--   * axel-kicillof: saca https://chequeado.com/feed/ (robots.txt lo prohíbe
--     para el UA genérico y además solo trae notas institucionales, no chequeos)
--     y suma https://www.gba.gob.ar/rss.xml. own_domains ya incluye gba.gob.ar.
--   * milei: saca el mismo feed de Chequeado y suma el RSS oficial de Discursos
--     de Casa Rosada. Marca como propios SOLO los ítems bajo
--     /informacion/discursos (settings.own_url_prefixes). No se agrega
--     casarosada.gob.ar a own_domains, para no atribuir al presidente las
--     conferencias del vocero.
--   * pedro-sanchez: suma https://maldita.es/feed y
--     https://www.newtral.es/zona-verificacion/feed/. Se deja el feed general
--     de Newtral que ya estaba. No toca own_domains.
--
-- Chequeado /nota/feed/ queda afuera a propósito: hace falta autorización
-- escrita de reuso antes de volver a cablearlo.
--
-- Backup de solo lectura (ya guardado, fuera del repo):
--   /workspace/pulso/backup_candidate_sources_pre_official_feeds_2026-11-26.json
--
-- Consulta de control (SQL Editor, no escribe):
--
--   select c.slug, cs.settings, cs.updated_at
--     from public.candidate_sources cs
--     join public.candidates c on c.id = cs.candidate_id
--    where cs.source = 'rss_media'
--      and c.slug in ('axel-kicillof', 'milei', 'pedro-sanchez')
--    order by c.slug;
--
-- Rollback: restaurar settings desde el backup, por slug:
--
--   update public.candidate_sources cs
--      set settings = :settings_del_backup,
--          updated_at = now()
--    where cs.source = 'rss_media'
--      and cs.candidate_id = (select id from public.candidates where slug = :slug);
--
-- No borra menciones, no cambia enabled ni interval_seconds.

begin;

-- Kicillof: quitar Chequeado /feed/ y sumar el RSS oficial de la Provincia.
with kicillof as (
  select jsonb_build_array(
           'https://chequeado.com/feed/',
           'https://chequeado.com/feed'
         ) as drop_urls,
         jsonb_build_array(
           'https://www.gba.gob.ar/rss.xml'
         ) as add_urls
)
update public.candidate_sources cs
   set settings = jsonb_set(
         coalesce(cs.settings, '{}'::jsonb),
         '{feeds}',
         (
           coalesce(cs.settings->'feeds', '[]'::jsonb) - (
             select array_agg(d.u)
               from jsonb_array_elements_text((select drop_urls from kicillof)) as d(u)
           )
         ) || coalesce((
           select jsonb_agg(to_jsonb(t.u))
             from jsonb_array_elements_text((select add_urls from kicillof)) as t(u)
            where not exists (
              select 1
                from jsonb_array_elements_text(
                       coalesce(cs.settings->'feeds', '[]'::jsonb)
                     ) as e(v)
               where e.v = t.u
            )
         ), '[]'::jsonb)
       ),
       updated_at = now()
 where cs.source = 'rss_media'
   and cs.candidate_id = (select id from public.candidates where slug = 'axel-kicillof');

-- Milei: quitar Chequeado /feed/, sumar Discursos de Casa Rosada y el prefijo own.
with milei as (
  select jsonb_build_array(
           'https://chequeado.com/feed/',
           'https://chequeado.com/feed'
         ) as drop_urls,
         jsonb_build_array(
           'https://www.casarosada.gob.ar/informacion/discursos?format=feed'
         ) as add_urls,
         jsonb_build_array(
           'https://www.casarosada.gob.ar/informacion/discursos'
         ) as prefixes
)
update public.candidate_sources cs
   set settings = jsonb_set(
         jsonb_set(
           coalesce(cs.settings, '{}'::jsonb),
           '{feeds}',
           (
             coalesce(cs.settings->'feeds', '[]'::jsonb) - (
               select array_agg(d.u)
                 from jsonb_array_elements_text((select drop_urls from milei)) as d(u)
             )
           ) || coalesce((
             select jsonb_agg(to_jsonb(t.u))
               from jsonb_array_elements_text((select add_urls from milei)) as t(u)
              where not exists (
                select 1
                  from jsonb_array_elements_text(
                         coalesce(cs.settings->'feeds', '[]'::jsonb)
                       ) as e(v)
                 where e.v = t.u
              )
           ), '[]'::jsonb)
         ),
         '{own_url_prefixes}',
         coalesce(cs.settings->'own_url_prefixes', '[]'::jsonb) || coalesce((
           select jsonb_agg(to_jsonb(t.u))
             from jsonb_array_elements_text((select prefixes from milei)) as t(u)
            where not exists (
              select 1
                from jsonb_array_elements_text(
                       coalesce(cs.settings->'own_url_prefixes', '[]'::jsonb)
                     ) as e(v)
               where e.v = t.u
            )
         ), '[]'::jsonb)
       ),
       updated_at = now()
 where cs.source = 'rss_media'
   and cs.candidate_id = (select id from public.candidates where slug = 'milei');

-- Sánchez: sumar Maldita y el feed de verificación de Newtral.
with sanchez as (
  select jsonb_build_array(
           'https://maldita.es/feed',
           'https://www.newtral.es/zona-verificacion/feed/'
         ) as add_urls
)
update public.candidate_sources cs
   set settings = jsonb_set(
         coalesce(cs.settings, '{}'::jsonb),
         '{feeds}',
         coalesce(cs.settings->'feeds', '[]'::jsonb) || coalesce((
           select jsonb_agg(to_jsonb(t.u))
             from jsonb_array_elements_text((select add_urls from sanchez)) as t(u)
            where not exists (
              select 1
                from jsonb_array_elements_text(
                       coalesce(cs.settings->'feeds', '[]'::jsonb)
                     ) as e(v)
               where e.v = t.u
            )
         ), '[]'::jsonb)
       ),
       updated_at = now()
 where cs.source = 'rss_media'
   and cs.candidate_id = (select id from public.candidates where slug = 'pedro-sanchez');

commit;
