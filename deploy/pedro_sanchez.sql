-- NO APLICAR todavía. Semilla para la demo de España (Pedro Sánchez).
-- Requiere OK de Leandro antes de ejecutarse en pulso-demo.
-- No crea usuarios ni cambia roles. No habilita Meta Ads.
--
-- Después de aplicarla (cuando se apruebe):
--   1. Invitar al usuario demo y dar de alta candidate_members (ver comentario al final).
--   2. Desplegar recolector y web desde feature/spain-demo.
--   3. Setear en el cron pulso-rss (Save only, sin cambiar otros secretos):
--        PULSO_CANDIDATES=axel-kicillof,pedro-sanchez
--      (PULSO_CANDIDATE queda como respaldo si la lista no está.)

begin;

insert into public.candidates (slug, name, keywords, exclude_keywords)
values (
  'pedro-sanchez',
  'Pedro Sánchez',
  array['Pedro Sánchez', 'Sánchez'],
  array[
    'Alexis Sánchez',
    'Hugo Sánchez',
    'Arantxa Sánchez',
    'Sánchez Vicario',
    'Manu Sánchez',
    'Curro Sánchez',
    'Ona Sanchez',
    'Sánchez Pizjuán',
    'Sánchez-Pizjuán'
  ]
)
on conflict (slug) do nothing;

-- RSS de medios españoles, verificados en lectura el 2026-11-24.
update public.candidate_sources set
  enabled = true,
  settings = jsonb_build_object(
    'feeds', jsonb_build_array(
      'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/espana/portada',
      'https://e00-elmundo.uecdn.es/elmundo/rss/espana.xml',
      'https://www.abc.es/rss/feeds/abc_EspanaEspana.xml',
      'https://www.lavanguardia.com/rss/home.xml',
      'https://rss.elconfidencial.com/espana/',
      'https://www.20minutos.es/rss/',
      'https://www.eldiario.es/rss/',
      'https://www.europapress.es/rss/rss.aspx',
      'https://www.elespanol.com/rss/',
      'https://www.elindependiente.com/feed/',
      'https://theobjective.com/feed/',
      'https://www.infolibre.es/rss/',
      'https://www.huffingtonpost.es/feeds/index.xml',
      'https://www.newtral.es/feed/',
      'https://www.rtve.es/rss/temas_noticias.xml'
    ),
    'own_domains', jsonb_build_array('lamoncloa.gob.es', 'psoe.es'),
    'reference_domains', jsonb_build_array()
  )
where candidate_id = (select id from public.candidates where slug = 'pedro-sanchez')
  and source = 'rss_media';

-- Locale de Google News para España (el código también tiene este default por slug).
update public.candidate_sources set
  enabled = true,
  settings = jsonb_build_object(
    'hl', 'es',
    'gl', 'ES',
    'ceid', 'ES:es',
    'own_domains', jsonb_build_array('lamoncloa.gob.es', 'psoe.es'),
    'reference_domains', jsonb_build_array()
  )
where candidate_id = (select id from public.candidates where slug = 'pedro-sanchez')
  and source = 'google_news';

update public.candidate_sources set
  enabled = true,
  settings = jsonb_build_object(
    'lang_es', true,
    'exclude_retweets', true,
    'exclude_replies', true
  )
where candidate_id = (select id from public.candidates where slug = 'pedro-sanchez')
  and source = 'x';

-- YouTube, Google Alerts y demás fuentes quedan apagadas.
update public.candidate_sources set enabled = false
where candidate_id = (select id from public.candidates where slug = 'pedro-sanchez')
  and source not in ('rss_media', 'google_news', 'x');

insert into public.ai_visibility_settings (
  candidate_id, enabled, provider, model, use_web_search, prompts
)
select
  c.id,
  true,
  'openai',
  'chat-latest',
  true,
  '[
    {"key":"quien_es","text":"¿Quién es {name} y cuál es su trayectoria política?"},
    {"key":"economia","text":"¿Cómo se evalúa la gestión económica de {name} y el manejo de las cuentas públicas en España?"},
    {"key":"vivienda","text":"¿Cómo se evalúa la política de vivienda de {name}?"},
    {"key":"sanidad","text":"¿Cómo se evalúa la gestión de {name} en sanidad?"},
    {"key":"educacion","text":"¿Cómo se evalúa la gestión de {name} en educación?"},
    {"key":"polemicas","text":"¿Cuáles son las principales polémicas, críticas, casos de corrupción o controversias asociadas a {name}?"},
    {"key":"presidente","text":"Según lo que se publica y se debate, ¿sería {name} un buen presidente del Gobierno de España?"},
    {"key":"comparacion_feijoo","text":"¿Cómo se compara {name} con Alberto Núñez Feijóo en el debate político actual de España?"},
    {"key":"coaliciones","text":"¿Qué coaliciones, pactos o escenarios de investidura se mencionan en relación con {name}?"},
    {"key":"elecciones_29n","text":"¿Qué propuestas, posicionamientos o escenarios se mencionan para {name} de cara a las elecciones generales del 29 de noviembre de 2026?"}
  ]'::jsonb
from public.candidates c
where c.slug = 'pedro-sanchez'
on conflict (candidate_id) do update set
  enabled = excluded.enabled,
  prompts = excluded.prompts,
  use_web_search = excluded.use_web_search;

-- No se inserta meta_ads_settings. El recolector no usa los defaults de
-- Kicillof/AR para este slug, y la pestaña de anuncios queda desactivada
-- porque Meta no entrega anuncios políticos en la UE.

commit;

-- Después de que el usuario demo acepte la invitación (mail del equipo de Active,
-- no del candidato), dar acceso solo a este candidato:
--
-- insert into public.candidate_members (candidate_id, user_id)
-- select c.id, u.id
-- from public.candidates c, auth.users u
-- where c.slug = 'pedro-sanchez' and u.email = 'MAIL-DEL-USUARIO-DEMO'
-- on conflict do nothing;
