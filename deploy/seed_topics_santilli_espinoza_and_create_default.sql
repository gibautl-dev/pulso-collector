-- Temas del clasificador para Diego Santilli y Fernando Espinoza, y preset
-- de temas por país en el alta de candidatos (create_candidate).
-- Idempotente. Costo de aplicar el SQL: USD 0.
-- No contiene secretos. No invita usuarios. No cambia env de Render.
-- Requiere public.topics y public.create_candidate (admin_candidates_pause_create.sql).
--
-- Qué hace:
--   * Inserta los temas aprobados para diego-santilli y fernando-espinoza
--     (siempre incluye "otros", que el clasificador exige).
--   * Crea public.apply_candidate_default_topics(uuid, text) y la llama
--     desde create_candidate para altas futuras (AR u ES).
--
-- Rollback (solo si hay que deshacer, no borra temas de otros candidatos):
--   -- Quitar el perform de create_candidate volviendo a la versión anterior
--   -- de deploy/admin_candidates_pause_create.sql, o dejar la función helper
--   -- (es idempotente y no daña).
--   drop function if exists public.apply_candidate_default_topics(uuid, text);
--   delete from public.topics t
--    using public.candidates c
--    where t.candidate_id = c.id
--      and c.slug in ('diego-santilli', 'fernando-espinoza');

begin;

create or replace function public.apply_candidate_default_topics(
  p_candidate_id uuid,
  p_country text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  labels text[];
  lbl text;
  country text := upper(btrim(coalesce(p_country, 'AR')));
begin
  if p_candidate_id is null then
    return;
  end if;
  if to_regclass('public.topics') is null then
    return;
  end if;
  if country = 'ES' then
    -- Preset genérico de España (sin etiquetas atadas a un candidato o a una elección).
    labels := array[
      'agenda institucional',
      'economía',
      'educación',
      'sanidad',
      'vivienda',
      'justicia',
      'otros'
    ];
  else
    -- Preset genérico de Argentina. Siempre incluye "otros".
    labels := array[
      'agenda institucional',
      'economía',
      'seguridad',
      'elecciones 2027',
      'relación con provincias',
      'justicia',
      'educación',
      'salud',
      'otros'
    ];
  end if;
  if not ('otros' = any (labels)) then
    labels := labels || 'otros';
  end if;
  foreach lbl in array labels loop
    insert into public.topics (candidate_id, label)
    select p_candidate_id, lbl
     where not exists (
       select 1
         from public.topics t
        where t.candidate_id = p_candidate_id
          and t.label = lbl
     );
  end loop;
end;
$$;

comment on function public.apply_candidate_default_topics(uuid, text) is
  'Siembra el preset de temas del clasificador según el país (siempre incluye otros). Uso interno del alta y de la semilla.';

revoke all on function public.apply_candidate_default_topics(uuid, text)
  from public, anon, authenticated, pulso_collector, pulso_classifier;
grant execute on function public.apply_candidate_default_topics(uuid, text)
  to service_role;

-- Temas aprobados para Santilli (no se pisan si ya existen).
insert into public.topics (candidate_id, label)
select c.id, lbl
  from public.candidates c
  cross join unnest(array[
    'agenda institucional',
    'economía',
    'seguridad',
    'elecciones 2027',
    'relación con provincias',
    'justicia',
    'educación',
    'salud',
    'otros'
  ]::text[]) as lbl
 where c.slug = 'diego-santilli'
   and not exists (
     select 1 from public.topics t
      where t.candidate_id = c.id and t.label = lbl
   );

-- Temas aprobados para Espinoza.
insert into public.topics (candidate_id, label)
select c.id, lbl
  from public.candidates c
  cross join unnest(array[
    'gestión municipal',
    'seguridad',
    'economía',
    'infraestructura',
    'educación',
    'salud',
    'elecciones 2027',
    'relación con Provincia/Nación',
    'otros'
  ]::text[]) as lbl
 where c.slug = 'fernando-espinoza'
   and not exists (
     select 1 from public.topics t
      where t.candidate_id = c.id and t.label = lbl
   );

-- create_candidate: igual que admin_candidates_pause_create.sql, más el preset de temas.
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
  perform public.apply_candidate_default_topics(new_id, country);

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
  'Staff: da de alta un candidato con preset de país, temas del clasificador (incluye otros), membresía del equipo y rival opcional. En la IA apagada salvo p_enable_ai_visibility.';

revoke all on function public.create_candidate(text, text, text, text, text, text, text[], text[], text, text, text, uuid, text, numeric, boolean)
  from public, anon, pulso_collector, pulso_classifier;
grant execute on function public.create_candidate(text, text, text, text, text, text, text[], text[], text, text, text, uuid, text, numeric, boolean)
  to authenticated, service_role;

commit;
