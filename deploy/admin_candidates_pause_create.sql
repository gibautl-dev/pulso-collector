-- Panel /admin/candidatos: pausa por candidato, país, modo de recolección y alta desde el admin.
-- NO APLICADO todavía en pulso-demo (bkjugpesqbplnaeotadh). No ejecutar hasta que Leandro lo apruebe
-- para producción. Idempotente. Costo de aplicar el SQL: USD 0.
-- No contiene secretos. No invita usuarios. No cambia env de Render.
--
-- Qué hace:
--   * candidates.collection_paused (default false): pausar no oculta al candidato ni borra datos.
--   * candidates.country (AR/ES; backfill pedro-sanchez → ES).
--   * candidates.collection_mode (full / media_only; backfill milei → media_only).
--   * office y party opcionales.
--   * RPCs staff: set_candidate_collection_paused, create_candidate (SECURITY DEFINER).
--
-- Rollback (solo si se aplicó y hay que deshacer):
--   drop function if exists public.create_candidate(text, text, text, text, text, text, text[], text[], text, text, text, uuid, text, numeric, boolean);
--   drop function if exists public.set_candidate_collection_paused(uuid, boolean);
--   drop function if exists public.apply_candidate_collection_preset(uuid, text, text, text, text);
--   drop function if exists public.grant_staff_candidate_admin(uuid);
--   drop function if exists public.normalize_wikipedia_article(text);
--   drop function if exists public.normalize_x_handle(text);
--   drop function if exists public.is_pulso_staff();
--   alter table public.candidates
--     drop column if exists collection_paused,
--     drop column if exists country,
--     drop column if exists collection_mode,
--     drop column if exists office,
--     drop column if exists party;

begin;

alter table public.candidates
  add column if not exists collection_paused boolean not null default false;

alter table public.candidates
  add column if not exists country text;

update public.candidates
   set country = case when slug = 'pedro-sanchez' then 'ES' else 'AR' end
 where country is null;

alter table public.candidates
  alter column country set default 'AR';

update public.candidates set country = 'AR' where country is null;
alter table public.candidates
  alter column country set not null;

alter table public.candidates
  drop constraint if exists candidates_country_check;
alter table public.candidates
  add constraint candidates_country_check check (country in ('AR', 'ES'));

alter table public.candidates
  add column if not exists collection_mode text;

update public.candidates
   set collection_mode = case when slug = 'milei' then 'media_only' else 'full' end
 where collection_mode is null;

alter table public.candidates
  alter column collection_mode set default 'full';

update public.candidates set collection_mode = 'full' where collection_mode is null;
alter table public.candidates
  alter column collection_mode set not null;

alter table public.candidates
  drop constraint if exists candidates_collection_mode_check;
alter table public.candidates
  add constraint candidates_collection_mode_check
    check (collection_mode in ('full', 'media_only'));

alter table public.candidates
  add column if not exists office text,
  add column if not exists party text;

-- El alta staff escribe role='admin'. web_permissions.sql solo permite 'viewer';
-- custom_topics.sql ya amplió el check en pulso-demo. Esto lo deja idempotente
-- también en una base nueva.
alter table public.candidate_members
  drop constraint if exists candidate_members_role_check;
alter table public.candidate_members
  add constraint candidate_members_role_check
  check (role in ('viewer', 'admin'));


comment on column public.candidates.collection_paused is
  'Si true, el cron no recolecta ni corre jobs de ese candidato. El tablero y los datos ya medidos siguen visibles.';
comment on column public.candidates.country is
  'País del candidato (AR o ES). Define locale de Google News, RSS y GDELT.';
comment on column public.candidates.collection_mode is
  'full: recolección completa (X, YouTube, Meta, En la IA, crisis). media_only: medios + clasificador + Wikipedia + resumen + contradicciones.';
comment on column public.candidates.office is
  'Cargo (opcional, texto libre).';
comment on column public.candidates.party is
  'Partido o coalición (opcional, texto libre).';

-- authenticated ya tiene SELECT solo de id, slug, name, created_at (column-level).
grant select (collection_paused, country, collection_mode, office, party)
  on table public.candidates to authenticated;

-- pulso_classifier tiene SELECT solo de id, slug, name.
grant select (collection_paused, country, collection_mode)
  on table public.candidates to pulso_classifier;

-- pulso_collector ya tiene GRANT SELECT a nivel tabla (incluye columnas nuevas).

create or replace function public.is_pulso_staff()
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.pulso_staff s
    where s.user_id = (select auth.uid())
  );
$$;

comment on function public.is_pulso_staff() is
  'True si el usuario autenticado está en pulso_staff.';

revoke all on function public.is_pulso_staff() from public, anon, pulso_collector, pulso_classifier;
grant execute on function public.is_pulso_staff() to authenticated, service_role;

create or replace function public.normalize_x_handle(txt text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(lower(ltrim(btrim(coalesce(txt, '')), '@')), '');
$$;

create or replace function public.normalize_wikipedia_article(txt text)
returns text
language plpgsql
immutable
parallel safe
as $$
declare
  value text := btrim(coalesce(txt, ''));
begin
  if value = '' then
    return null;
  end if;
  if value ~* '^https?://' then
    value := regexp_replace(value, '/+$', '');
    value := regexp_replace(value, '^.*/', '');
  end if;
  value := replace(btrim(value), ' ', '_');
  if value = '' then
    return null;
  end if;
  return value;
end;
$$;

revoke all on function public.normalize_x_handle(text) from public, anon;
grant execute on function public.normalize_x_handle(text) to authenticated, service_role;
revoke all on function public.normalize_wikipedia_article(text) from public, anon;
grant execute on function public.normalize_wikipedia_article(text) to authenticated, service_role;

-- Presets de fuentes por país/modo. Lo usan create_candidate y el seed.
create or replace function public.apply_candidate_collection_preset(
  p_candidate_id uuid,
  p_country text,
  p_collection_mode text,
  p_x_handle text default null,
  p_youtube_channel_id text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  country text := upper(btrim(coalesce(p_country, 'AR')));
  mode text := lower(btrim(coalesce(p_collection_mode, 'full')));
  handle text := public.normalize_x_handle(p_x_handle);
  channel text := nullif(btrim(coalesce(p_youtube_channel_id, '')), '');
  feeds jsonb;
  news jsonb;
  sourcecountry text;
  full_mode boolean;
begin
  if country not in ('AR', 'ES') then
    raise exception 'País inválido';
  end if;
  if mode not in ('full', 'media_only') then
    raise exception 'Modo de recolección inválido';
  end if;
  full_mode := (mode = 'full');
  sourcecountry := country;

  if country = 'ES' then
    feeds := '["https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/espana/portada","https://e00-elmundo.uecdn.es/elmundo/rss/espana.xml","https://www.abc.es/rss/feeds/abc_EspanaEspana.xml","https://www.lavanguardia.com/rss/home.xml","https://rss.elconfidencial.com/espana/","https://www.20minutos.es/rss/","https://www.eldiario.es/rss/","https://www.europapress.es/rss/rss.aspx","https://www.elespanol.com/rss/","https://www.elindependiente.com/feed/","https://theobjective.com/feed/","https://www.infolibre.es/rss/","https://www.huffingtonpost.es/feeds/index.xml","https://www.newtral.es/feed/","https://www.rtve.es/rss/temas_noticias.xml","https://maldita.es/feed","https://www.newtral.es/zona-verificacion/feed/"]'::jsonb;
    news := jsonb_build_object('hl', 'es', 'gl', 'ES', 'ceid', 'ES:es');
  else
    -- Medios AR compartidos: sin gba.gob.ar ni casarosada.gob.ar (feeds oficiales propios).
    feeds := '["https://www.clarin.com/rss/politica/","https://www.lanacion.com.ar/arc/outboundfeeds/rss/category/politica/?outputType=xml","https://www.infobae.com/arc/outboundfeeds/rss/","https://www.pagina12.com.ar/arc/outboundfeeds/rss/?outputType=xml","https://www.perfil.com/feed","https://www.ambito.com/rss/pages/politica.xml","https://www.eldiarioar.com/rss/","https://www.tn.com.ar/arc/outboundfeeds/rss/?outputType=xml","https://www.eldia.com/feed","https://www.cronista.com/files/rss/news.xml","https://www.tiempoar.com.ar/seccion/politica/feed/","https://www.eldestapeweb.com/adjuntos/177/rss/home.xml","https://www.c5n.com/rss/pages/politica.xml","https://www.dataclave.com.ar/rss","https://www.parlamentario.com/feed/","https://www.noticiasargentinas.com/rss","https://www.iprofesional.com/rss/politica","https://elcanciller.com/rss.xml","https://urgente24.com/rss/pages/actualidad.xml","https://www.filo.news/rss/rss.xml","https://www.diagonales.com/rss","https://dib.com.ar/rss/pages/politica.xml","https://www.0221.com.ar/rss/pages/provincia.xml","https://www.todoprovincial.com/feed","https://realpolitik.com.ar/rss","https://www.impulsobaires.com.ar/rss","https://elintransigente.com/feed","https://www.0223.com.ar/rss","https://www.radionacional.com.ar/feed/"]'::jsonb;
    news := jsonb_build_object('hl', 'es-419', 'gl', 'AR', 'ceid', 'AR:es-419');
  end if;

  update public.candidate_sources
     set enabled = true,
         settings = jsonb_build_object(
           'feeds', feeds,
           'own_domains', '[]'::jsonb,
           'reference_domains', '[]'::jsonb
         ),
         updated_at = now()
   where candidate_id = p_candidate_id and source = 'rss_media';

  update public.candidate_sources
     set enabled = true,
         settings = news,
         updated_at = now()
   where candidate_id = p_candidate_id and source = 'google_news';

  update public.candidate_sources
     set enabled = true,
         interval_seconds = greatest(interval_seconds, 3300),
         settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('sourcecountry', sourcecountry),
         updated_at = now()
   where candidate_id = p_candidate_id and source = 'gdelt';

  update public.candidate_sources
     set enabled = false,
         updated_at = now()
   where candidate_id = p_candidate_id and source = 'google_alerts';

  update public.candidate_sources
     set enabled = full_mode,
         interval_seconds = case when full_mode then greatest(interval_seconds, 3600) else interval_seconds end,
         settings = case
           when full_mode then jsonb_build_object(
             'lang_es', true,
             'exclude_replies', true,
             'exclude_retweets', true,
             'max_posts_per_day', 300,
             'max_posts_per_run', 25,
             'max_requests_per_day', 10
           )
           else coalesce(settings, '{}'::jsonb)
         end,
         updated_at = now()
   where candidate_id = p_candidate_id and source = 'x';

  update public.candidate_sources
     set enabled = full_mode,
         interval_seconds = greatest(interval_seconds, 3600),
         settings = case
           when full_mode then jsonb_strip_nulls(jsonb_build_object(
             'collect_comments', true,
             'max_units_per_day', 3000,
             'max_comment_videos', 5,
             'max_searches_per_day', 20,
             'max_comments_per_video', 20,
             'own_channel_ids', case when channel is not null then jsonb_build_array(channel) else '[]'::jsonb end
           ))
           else coalesce(settings, '{}'::jsonb)
         end,
         updated_at = now()
   where candidate_id = p_candidate_id and source = 'youtube';

  -- El resto de fuentes del catálogo queda apagado en un alta nueva.
  update public.candidate_sources
     set enabled = false,
         updated_at = now()
   where candidate_id = p_candidate_id
     and source not in ('rss_media', 'google_news', 'gdelt', 'google_alerts', 'x', 'youtube');

  if handle is not null or channel is not null then
    update public.candidates
       set own_accounts = jsonb_strip_nulls(jsonb_build_object(
             'x', case when handle is not null then jsonb_build_array(handle) else null end,
             'youtube', case when channel is not null then jsonb_build_array(channel) else null end
           ))
     where id = p_candidate_id
       and (own_accounts = '{}'::jsonb or own_accounts is null);
  end if;
end;
$$;

comment on function public.apply_candidate_collection_preset(uuid, text, text, text, text) is
  'Aplica el preset de fuentes RSS/News/GDELT/X/YouTube según país y modo. Uso interno (alta y seed).';

revoke all on function public.apply_candidate_collection_preset(uuid, text, text, text, text)
  from public, anon, authenticated, pulso_collector, pulso_classifier;

create or replace function public.grant_staff_candidate_admin(p_candidate_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if to_regclass('public.candidate_members') is null then
    return;
  end if;
  insert into public.candidate_members (candidate_id, user_id, role)
  select p_candidate_id, s.user_id, 'admin'
    from public.pulso_staff s
    join auth.users u on u.id = s.user_id
   where lower(coalesce(u.email, '')) not in (
           'demo@activemkt.com',
           'ricardohugogomez@gmail.com'
         )
  on conflict (candidate_id, user_id) do update
    set role = 'admin';
end;
$$;

comment on function public.grant_staff_candidate_admin(uuid) is
  'Da rol admin en candidate_members a pulso_staff, excluyendo demo@ y cuentas externas no staff.';

revoke all on function public.grant_staff_candidate_admin(uuid)
  from public, anon, authenticated, pulso_collector, pulso_classifier;

create or replace function public.set_candidate_collection_paused(
  p_candidate_id uuid,
  p_paused boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rec public.candidates%rowtype;
begin
  if not public.is_pulso_staff() then
    raise exception 'Solo el equipo de Active puede pausar o reanudar la recolección';
  end if;
  update public.candidates
     set collection_paused = coalesce(p_paused, false)
   where id = p_candidate_id
   returning * into rec;
  if not found then
    raise exception 'Candidato inválido';
  end if;
  return jsonb_build_object(
    'id', rec.id,
    'slug', rec.slug,
    'name', rec.name,
    'collection_paused', rec.collection_paused
  );
end;
$$;

comment on function public.set_candidate_collection_paused(uuid, boolean) is
  'Staff: pausa o reanuda la recolección de un candidato. No oculta el tablero ni borra datos.';

revoke all on function public.set_candidate_collection_paused(uuid, boolean)
  from public, anon, pulso_collector, pulso_classifier;
grant execute on function public.set_candidate_collection_paused(uuid, boolean)
  to authenticated, service_role;

create or replace function public.create_candidate(
  p_name text,
  p_slug text,
  p_country text default 'AR',
  p_collection_mode text default 'full',
  p_office text default null,
  p_party text default null,
  p_keywords text[] default null,
  p_exclude_keywords text[] default '{}'::text[],
  p_x_handle text default null,
  p_youtube_channel_id text default null,
  p_wikipedia_article text default null,
  p_rival_candidate_id uuid default null,
  p_rival_level text default 'comparativo',
  p_daily_budget_usd numeric default 1.00,
  p_enable_ai_visibility boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  staff_id uuid := auth.uid();
  new_id uuid;
  name_txt text := btrim(coalesce(p_name, ''));
  slug_txt text := btrim(coalesce(p_slug, ''));
  country text := upper(btrim(coalesce(p_country, 'AR')));
  mode text := lower(btrim(coalesce(p_collection_mode, 'full')));
  office_txt text := nullif(btrim(coalesce(p_office, '')), '');
  party_txt text := nullif(btrim(coalesce(p_party, '')), '');
  handle text := public.normalize_x_handle(p_x_handle);
  channel text := nullif(btrim(coalesce(p_youtube_channel_id, '')), '');
  article text := public.normalize_wikipedia_article(p_wikipedia_article);
  keywords text[];
  excludes text[] := coalesce(p_exclude_keywords, '{}'::text[]);
  last_word text;
  budget numeric := coalesce(p_daily_budget_usd, 1.00);
  rival_level text := coalesce(nullif(btrim(coalesce(p_rival_level, '')), ''), 'comparativo');
  own jsonb := '{}'::jsonb;
begin
  if staff_id is null or not public.is_pulso_staff() then
    raise exception 'Solo el equipo de Active puede dar de alta un candidato';
  end if;
  if name_txt = '' then
    raise exception 'Falta el nombre del candidato';
  end if;
  if slug_txt is null or slug_txt = '' then
    slug_txt := trim(both '-' from lower(regexp_replace(name_txt, '[^a-zA-Z0-9]+', '-', 'g')));
  end if;
  if slug_txt !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'El slug no es válido';
  end if;
  if country not in ('AR', 'ES') then
    raise exception 'País inválido';
  end if;
  if mode not in ('full', 'media_only') then
    raise exception 'Modo de recolección inválido';
  end if;
  if budget < 0 or budget > 50 then
    raise exception 'Tope inválido';
  end if;
  if exists (select 1 from public.candidates c where c.slug = slug_txt) then
    raise exception 'Ya existe un candidato con ese slug';
  end if;
  if exists (select 1 from public.candidates c where lower(btrim(c.name)) = lower(name_txt)) then
    raise exception 'Ya existe un candidato con ese nombre';
  end if;
  if p_rival_candidate_id is not null then
    if not exists (select 1 from public.candidates c where c.id = p_rival_candidate_id) then
      raise exception 'El rival indicado no existe';
    end if;
    if rival_level not in ('radar', 'comparativo', 'completo') then
      raise exception 'Nivel de rival inválido';
    end if;
  end if;
  if channel is not null and channel !~ '^UC[A-Za-z0-9_-]{22}$' then
    raise exception 'El canal de YouTube no es válido';
  end if;

  keywords := p_keywords;
  if keywords is null or cardinality(keywords) = 0 then
    last_word := nullif(btrim(regexp_replace(name_txt, '^.*\s+', '')), '');
    keywords := array[name_txt];
    if last_word is not null and lower(last_word) <> lower(name_txt) then
      keywords := keywords || last_word;
    end if;
    if handle is not null then
      keywords := keywords || ('@' || handle);
    end if;
  end if;

  if handle is not null then
    own := own || jsonb_build_object('x', jsonb_build_array(handle));
  end if;
  if channel is not null then
    own := own || jsonb_build_object('youtube', jsonb_build_array(channel));
  end if;

  insert into public.candidates (
    slug, name, keywords, exclude_keywords, own_accounts, alert_feeds,
    country, collection_mode, collection_paused, office, party
  ) values (
    slug_txt, name_txt, keywords, excludes, own, array[]::text[],
    country, mode, false, office_txt, party_txt
  ) returning id into new_id;

  perform public.apply_candidate_collection_preset(new_id, country, mode, handle, channel);

  if budget is distinct from 1.00 and to_regclass('public.ai_visibility_candidate_budget') is not null then
    update public.ai_visibility_candidate_budget
       set daily_budget_usd = budget,
           updated_at = now(),
           updated_by = staff_id
     where candidate_id = new_id;
  end if;

  if article is not null and to_regclass('public.wikipedia_pageview_settings') is not null then
    insert into public.wikipedia_pageview_settings (candidate_id, enabled, project, article)
    values (new_id, true, 'es.wikipedia', article)
    on conflict (candidate_id) do update
      set enabled = true,
          article = excluded.article,
          updated_at = now();
  end if;

  perform public.grant_staff_candidate_admin(new_id);

  if p_rival_candidate_id is not null then
    insert into public.candidate_rivals (candidate_id, rival_id, level, created_by)
    values (new_id, p_rival_candidate_id, rival_level, staff_id)
    on conflict (candidate_id, rival_id) do update
      set level = excluded.level;
  end if;

  if country = 'AR' and mode = 'full' and to_regclass('public.meta_ads_settings') is not null then
    insert into public.meta_ads_settings (candidate_id, enabled)
    values (new_id, true)
    on conflict (candidate_id) do update
      set enabled = true,
          updated_at = now();
  end if;

  if coalesce(p_enable_ai_visibility, false) and to_regclass('public.ai_visibility_settings') is not null then
    insert into public.ai_visibility_settings (candidate_id, enabled)
    values (new_id, true)
    on conflict (candidate_id) do update
      set enabled = true,
          updated_at = now();
  end if;

  return jsonb_build_object('id', new_id, 'slug', slug_txt, 'name', name_txt);
end;
$$;

comment on function public.create_candidate(text, text, text, text, text, text, text[], text[], text, text, text, uuid, text, numeric, boolean) is
  'Staff: da de alta un candidato con preset de país, membresía del equipo y rival opcional. En la IA apagada salvo p_enable_ai_visibility.';

revoke all on function public.create_candidate(text, text, text, text, text, text, text[], text[], text, text, text, uuid, text, numeric, boolean)
  from public, anon, pulso_collector, pulso_classifier;
grant execute on function public.create_candidate(text, text, text, text, text, text, text[], text[], text, text, text, uuid, text, numeric, boolean)
  to authenticated, service_role;

commit;
