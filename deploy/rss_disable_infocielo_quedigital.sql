-- Aplicado en pulso-demo el 2026-11-25 (hora de Argentina). Quita InfoCielo y Qué Digital del RSS de Kicillof y Milei (403 desde Render).
-- Radio Nacional se queda. Sánchez no se toca. No borra menciones ni cambia enabled.
-- Idempotente: si las URLs ya no están, el UPDATE no altera el resto de feeds.
--
-- Backup ANTES de aplicar (exportar el resultado a JSON, fuera del repo):
--
--   select c.slug, cs.settings, cs.updated_at
--     from public.candidate_sources cs
--     join public.candidates c on c.id = cs.candidate_id
--    where cs.source = 'rss_media'
--      and c.slug in ('axel-kicillof', 'milei');
--
-- Las notas de estos medios siguen llegando por Google News.

begin;

with drop_feeds as (
  select jsonb_build_array(
    'https://www.infocielo.com/rss',
    'https://quedigital.com.ar/feed'
  ) as urls
)
update public.candidate_sources cs
   set settings = jsonb_set(
         coalesce(cs.settings, '{}'::jsonb),
         '{feeds}',
         coalesce((
           select jsonb_agg(to_jsonb(e.v))
           from jsonb_array_elements_text(coalesce(cs.settings->'feeds', '[]'::jsonb)) as e(v)
           where not exists (
             select 1
               from jsonb_array_elements_text((select urls from drop_feeds)) as d(u)
              where d.u = e.v
           )
         ), '[]'::jsonb)
       ),
       updated_at = now()
 where cs.source = 'rss_media'
   and cs.candidate_id in (
     select id from public.candidates where slug in ('axel-kicillof', 'milei')
   );

commit;
