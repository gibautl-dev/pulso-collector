-- Semilla: alta de Diego Santilli y Fernando Espinoza, y pausa de la recolección de
-- Kicillof, Milei y Pedro Sánchez.
-- NO APLICADO todavía en pulso-demo. Requiere haber aplicado antes
-- deploy/admin_candidates_pause_create.sql. Idempotente. Costo: USD 0.
-- No contiene URLs privadas de Google Alerts. No invita usuarios.
-- No agrega a demo@activemkt.com ni a ricardohugogomez@gmail.com.
--
-- Verificado el 2026-11-26 (hora de Argentina):
--   * Diego Santilli: Jefe de Gabinete desde el 29/06/2026 (Decreto 548/2026),
--     X @diegosantilli, Wikipedia Diego_Santilli, YouTube UCTtJfqABtqN8ZOWIiho8VGA
--     (canal "Diego Santilli" / user Soydiegosantilli, feed Atom oficial).
--   * Fernando Espinoza: Intendente de La Matanza, X @FerEspinozaOK (Wikidata P2002
--     ferespinozaok; municipio y cuenta histórica lo confirman), Wikipedia
--     Fernando_Espinoza_(político). "Fernando_Espinoza" es una desambiguación:
--     no usar ese título. Keywords evitan el apellido suelto "Espinoza".
--
-- Google Alerts: no se cargan feeds en este seed. Quedan apagados (google_alerts
-- enabled=false) hasta pegar la URL del feed en un paso posterior, sin commitear
-- URLs privadas.
--
-- Rollback:
--   delete from public.candidates where slug in ('diego-santilli', 'fernando-espinoza');
--   update public.candidates
--      set collection_paused = false
--    where slug in ('axel-kicillof', 'milei', 'pedro-sanchez');

begin;

-- 1) Pausar la recolección de los candidatos actuales. No se ocultan ni se borran datos.
--    La demo de España (pedro-sanchez / demo@) sigue visible: solo se corta la recolección.
update public.candidates
   set collection_paused = true
 where slug in ('axel-kicillof', 'milei', 'pedro-sanchez');

-- 2) Diego Santilli (candidato principal, modo full).
insert into public.candidates (
  slug, name, keywords, exclude_keywords, own_accounts, alert_feeds,
  country, collection_mode, collection_paused, office, party
)
values (
  'diego-santilli',
  'Diego Santilli',
  array['Diego Santilli', 'Santilli', '@diegosantilli']::text[],
  array[]::text[],
  jsonb_build_object(
    'x', jsonb_build_array('diegosantilli'),
    'youtube', jsonb_build_array('UCTtJfqABtqN8ZOWIiho8VGA')
  ),
  array[]::text[],
  'AR',
  'full',
  false,
  'Jefe de Gabinete de Ministros de la Nación',
  'PRO / La Libertad Avanza'
)
on conflict (slug) do update
  set name = excluded.name,
      keywords = excluded.keywords,
      exclude_keywords = excluded.exclude_keywords,
      own_accounts = excluded.own_accounts,
      country = excluded.country,
      collection_mode = excluded.collection_mode,
      collection_paused = false,
      office = excluded.office,
      party = excluded.party;

select public.apply_candidate_collection_preset(
  (select id from public.candidates where slug = 'diego-santilli'),
  'AR',
  'full',
  'diegosantilli',
  'UCTtJfqABtqN8ZOWIiho8VGA'
);

insert into public.wikipedia_pageview_settings (candidate_id, enabled, project, article)
select c.id, true, 'es.wikipedia', 'Diego_Santilli'
  from public.candidates c
 where c.slug = 'diego-santilli'
on conflict (candidate_id) do update
  set enabled = true,
      article = excluded.article,
      project = excluded.project,
      updated_at = now();

insert into public.ai_visibility_candidate_budget (candidate_id, daily_budget_usd)
select c.id, 1.00
  from public.candidates c
 where c.slug = 'diego-santilli'
on conflict (candidate_id) do update
  set daily_budget_usd = 1.00;

insert into public.meta_ads_settings (candidate_id, enabled)
select c.id, true
  from public.candidates c
 where c.slug = 'diego-santilli'
on conflict (candidate_id) do update
  set enabled = true,
      updated_at = now();

select public.grant_staff_candidate_admin(
  (select id from public.candidates where slug = 'diego-santilli')
);

-- 3) Fernando Espinoza (rival, solo medios).
insert into public.candidates (
  slug, name, keywords, exclude_keywords, own_accounts, alert_feeds,
  country, collection_mode, collection_paused, office, party
)
values (
  'fernando-espinoza',
  'Fernando Espinoza',
  array['Fernando Espinoza', 'Intendente Espinoza', '@FerEspinozaOK', 'Espinoza La Matanza']::text[],
  array[]::text[],
  jsonb_build_object('x', jsonb_build_array('ferespinozaok')),
  array[]::text[],
  'AR',
  'media_only',
  false,
  'Intendente de La Matanza',
  'Partido Justicialista'
)
on conflict (slug) do update
  set name = excluded.name,
      keywords = excluded.keywords,
      exclude_keywords = excluded.exclude_keywords,
      own_accounts = excluded.own_accounts,
      country = excluded.country,
      collection_mode = excluded.collection_mode,
      collection_paused = false,
      office = excluded.office,
      party = excluded.party;

select public.apply_candidate_collection_preset(
  (select id from public.candidates where slug = 'fernando-espinoza'),
  'AR',
  'media_only',
  'ferespinozaok',
  null
);

insert into public.wikipedia_pageview_settings (candidate_id, enabled, project, article)
select c.id, true, 'es.wikipedia', 'Fernando_Espinoza_(político)'
  from public.candidates c
 where c.slug = 'fernando-espinoza'
on conflict (candidate_id) do update
  set enabled = true,
      article = excluded.article,
      project = excluded.project,
      updated_at = now();

insert into public.ai_visibility_candidate_budget (candidate_id, daily_budget_usd)
select c.id, 1.00
  from public.candidates c
 where c.slug = 'fernando-espinoza'
on conflict (candidate_id) do update
  set daily_budget_usd = 1.00;

select public.grant_staff_candidate_admin(
  (select id from public.candidates where slug = 'fernando-espinoza')
);

insert into public.candidate_rivals (candidate_id, rival_id, level)
select s.id, e.id, 'comparativo'
  from public.candidates s
  join public.candidates e on e.slug = 'fernando-espinoza'
 where s.slug = 'diego-santilli'
on conflict (candidate_id, rival_id) do update
  set level = excluded.level;

-- Defensa extra: jamás dejar a demo@ o a la cuenta externa como miembros de estos dos.
delete from public.candidate_members cm
 using public.candidates c, auth.users u
 where cm.candidate_id = c.id
   and cm.user_id = u.id
   and c.slug in ('diego-santilli', 'fernando-espinoza')
   and lower(coalesce(u.email, '')) in (
         'demo@activemkt.com',
         'ricardohugogomez@gmail.com'
       );

commit;
