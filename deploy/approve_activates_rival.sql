-- Aprobar un alta pendiente crea (o reusa) el candidato, enciende solo medios/RSS
-- y lo vincula en candidate_rivals con el nivel pedido. La IA queda apagada
-- salvo p_enable_ia = true. Idempotente. No se aplicó en pulso-demo.
-- No contiene secretos. No cambia env ni el cron. No invita usuarios.
--
-- Costo de aplicar el SQL: USD 0.

begin;

create or replace function public.approve_and_activate_pending_candidate(
  p_pending_id uuid,
  p_enable_ia boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  staff_id uuid := auth.uid();
  pending public.pending_candidates%rowtype;
  parent public.candidates%rowtype;
  existing public.candidates%rowtype;
  activated_id uuid;
  created_new boolean := false;
  new_slug text;
  new_keywords text[];
  last_word text;
  parent_rss jsonb;
  parent_news jsonb;
  news_settings jsonb;
  enable_ia boolean := coalesce(p_enable_ia, false);
begin
  if staff_id is null or not exists (
    select 1 from public.pulso_staff s where s.user_id = staff_id
  ) then
    raise exception 'Solo el equipo de Active puede aprobar un alta';
  end if;

  select * into pending
    from public.pending_candidates
   where id = p_pending_id
   for update;

  if not found then
    raise exception 'No está ese pedido de alta';
  end if;
  if pending.status = 'borrado' then
    raise exception 'No está ese pedido de alta';
  end if;

  select * into parent
    from public.candidates
   where id = pending.requested_for_candidate_id;

  if not found then
    raise exception 'Candidato inválido';
  end if;

  new_slug := nullif(trim(both from coalesce(pending.slug, '')), '');
  if new_slug is null or new_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    new_slug := trim(both '-' from lower(regexp_replace(trim(pending.name), '[^a-zA-Z0-9]+', '-', 'g')));
  end if;
  if new_slug is null or new_slug = '' or new_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'No se pudo armar un slug para este rival';
  end if;

  select * into existing
    from public.candidates c
   where c.slug = new_slug
      or lower(trim(c.name)) = lower(trim(pending.name))
   order by case when c.slug = new_slug then 0 else 1 end
   limit 1;

  if found then
    activated_id := existing.id;
    if activated_id = parent.id then
      raise exception 'Un candidato no puede ser rival de sí mismo';
    end if;
  else
    last_word := nullif(trim(both from regexp_replace(trim(pending.name), '^.*\s+', '')), '');
    new_keywords := array[trim(pending.name)];
    if last_word is not null and lower(last_word) <> lower(trim(pending.name)) then
      new_keywords := new_keywords || last_word;
    end if;

    insert into public.candidates (slug, name, keywords, exclude_keywords, alert_feeds)
    values (new_slug, trim(pending.name), new_keywords, array[]::text[], array[]::text[])
    returning id into activated_id;
    created_new := true;
  end if;

  select s.settings into parent_rss
    from public.candidate_sources s
   where s.candidate_id = parent.id and s.source = 'rss_media';

  update public.candidate_sources
     set enabled = true,
         settings = jsonb_build_object(
           'feeds', case
             when parent_rss ? 'feeds' and jsonb_typeof(parent_rss->'feeds') = 'array'
               then parent_rss->'feeds'
             else '[]'::jsonb
           end,
           'own_domains', '[]'::jsonb,
           'reference_domains', '[]'::jsonb
         ),
         updated_at = now()
   where candidate_id = activated_id and source = 'rss_media';

  select s.settings into parent_news
    from public.candidate_sources s
   where s.candidate_id = parent.id and s.source = 'google_news';

  news_settings := jsonb_strip_nulls(jsonb_build_object(
    'hl', parent_news->'hl',
    'gl', parent_news->'gl',
    'ceid', parent_news->'ceid'
  ));

  update public.candidate_sources
     set enabled = true,
         settings = coalesce(news_settings, '{}'::jsonb),
         updated_at = now()
   where candidate_id = activated_id and source = 'google_news';

  if created_new then
    update public.candidate_sources
       set enabled = false,
           updated_at = now()
     where candidate_id = activated_id
       and source not in ('rss_media', 'google_news');
  end if;

  insert into public.candidate_rivals (candidate_id, rival_id, level, created_by)
  values (parent.id, activated_id, pending.requested_level, staff_id)
  on conflict (candidate_id, rival_id) do update
    set level = excluded.level;

  if enable_ia and to_regclass('public.ai_visibility_settings') is not null then
    execute $q$
      insert into public.ai_visibility_settings (candidate_id, enabled)
      values ($1, true)
      on conflict (candidate_id) do update set enabled = true
    $q$ using activated_id;
  end if;

  update public.pending_candidates
     set status = 'aprobado',
         approved_at = coalesce(pending.approved_at, now()),
         approved_by = coalesce(pending.approved_by, staff_id)
   where id = pending.id
   returning * into pending;

  return jsonb_build_object(
    'id', pending.id,
    'name', pending.name,
    'slug', pending.slug,
    'arena', pending.arena,
    'status', pending.status,
    'requested_for_candidate_id', pending.requested_for_candidate_id,
    'requested_level', pending.requested_level,
    'source', pending.source,
    'reason', pending.reason,
    'created_at', pending.created_at,
    'created_by', pending.created_by,
    'approved_at', pending.approved_at,
    'approved_by', pending.approved_by,
    'activated_candidate_id', activated_id,
    'created_candidate', created_new,
    'enable_ia', enable_ia
  );
end;
$$;

comment on function public.approve_and_activate_pending_candidate(uuid, boolean) is
  'Staff: aprueba un alta pendiente, crea o reusa el candidato (medios/RSS) y el vínculo en candidate_rivals. IA apagada salvo p_enable_ia.';

revoke all on function public.approve_and_activate_pending_candidate(uuid, boolean)
  from public, anon, authenticated, pulso_collector, pulso_classifier;
grant execute on function public.approve_and_activate_pending_candidate(uuid, boolean)
  to authenticated, service_role;

commit;
