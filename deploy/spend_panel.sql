-- Panel "Gasto" (solo equipo de Active): una función de lectura que agrega el
-- gasto registrado de la app por función, candidato y día.
-- Aplicada en pulso-demo el 2026-11-25 (aprobada por Leandro). Requiere deploy/ai_visibility_cap.sql y deploy/ai_visibility_cap_per_candidate.sql aplicados antes.
-- Idempotente. No crea tablas, no cambia RLS existentes, no toca roles ni datos.
-- Costo de aplicar el SQL: USD 0.
--
-- Por qué SECURITY DEFINER: varias tablas de costos solo se leen por
-- candidate_members (p. ej. daily_briefs, assistant_questions es por usuario).
-- La función devuelve SOLO agregados (montos, conteos, topes); nunca textos,
-- preguntas, borradores ni ids de usuario. Adentro verifica pulso_staff con
-- auth.uid(): para cualquier otro usuario (o anon) lanza error.
-- Fechas: días en America/Argentina/Buenos_Aires, salvo el cupo de X, que el
-- recolector cuenta por día UTC (se reinicia a las 21:00 de Buenos Aires).

begin;

create or replace function public.pulso_spend_report(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  tz constant text := 'America/Argentina/Buenos_Aires';
  v_from timestamptz;
  v_to timestamptz;
  v_rows jsonb;
  v_x jsonb;
  v_x_caps jsonb;
  v_caps jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.pulso_staff s where s.user_id = auth.uid()) then
    raise exception 'pulso_spend: solo el equipo de Active' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'pulso_spend: rango inválido' using errcode = '22023';
  end if;
  v_from := (p_from::timestamp) at time zone tz;
  v_to := ((p_to + 1)::timestamp) at time zone tz;

  with costs as (
    select 'ia_visibilidad'::text as feature, candidate_id, asked_at as ts, cost::numeric as cost_usd, 1 as items
      from public.ai_answers where asked_at >= v_from and asked_at < v_to
    union all
    select 'equipo_accion', candidate_id, started_at, cost_usd, case when agent_role = 'writer' then 1 else 0 end
      from public.crisis_agent_runs where started_at >= v_from and started_at < v_to
    union all
    select 'resumen_diario', candidate_id, created_at, cost_usd, 1
      from public.daily_briefs where created_at >= v_from and created_at < v_to and status = 'ok'
    union all
    select 'contradicciones', candidate_id, last_scan_at, cost_usd, 1
      from public.inconsistency_scans where last_scan_at >= v_from and last_scan_at < v_to
    union all
    select 'simulador', candidate_id, created_at, cost_usd, 1
      from public.response_simulations where created_at >= v_from and created_at < v_to
    union all
    select 'asistente', candidate_id, created_at, cost_usd, 1
      from public.assistant_questions where created_at >= v_from and created_at < v_to
    union all
    select 'temas_clasificacion', candidate_id, created_at, cost_usd, 1
      from public.custom_topic_classifications where created_at >= v_from and created_at < v_to
    union all
    select 'temas_resumen', candidate_id, created_at, cost_usd, 1
      from public.custom_topic_summaries where created_at >= v_from and created_at < v_to
    union all
    select 'sugerencias_rivales', candidate_id, created_at, cost_usd, 1
      from public.rival_suggestion_runs where created_at >= v_from and created_at < v_to
  ),
  uncosted as (
    -- Sin costo por fila en la base: solo conteos (la web aplica un EST).
    select 'clasificador'::text as feature, candidate_id, classified_at as ts, count(*)::bigint as items
      from public.mentions
     where classified_at >= v_from and classified_at < v_to
       and classification_model is not null and classification_model not like '%manual%'
     group by 1, 2, 3
    union all
    select 'anuncios_clasificacion', candidate_id, classified_at, count(*)::bigint
      from public.meta_ad_classifications
     where classified_at >= v_from and classified_at < v_to
     group by 1, 2, 3
  ),
  agg as (
    select (ts at time zone tz)::date as day, feature, candidate_id,
           sum(items)::bigint as items,
           count(*)::bigint as calls,
           sum(cost_usd) as cost_usd,
           count(*) filter (where cost_usd is null)::bigint as calls_without_cost,
           'registrado'::text as basis
      from costs group by 1, 2, 3
    union all
    select (ts at time zone tz)::date, feature, candidate_id, sum(items)::bigint, sum(items)::bigint,
           null::numeric, sum(items)::bigint, 'sin_costo'
      from uncosted group by 1, 2, 3
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'day', day, 'feature', feature, 'candidate_id', candidate_id, 'items', items,
           'calls', calls, 'cost_usd', round(cost_usd, 6), 'calls_without_cost', calls_without_cost,
           'basis', basis) order by day, feature), '[]'::jsonb)
    into v_rows from agg;

  -- X: el recolector guarda en cursor.quota el acumulado del día UTC (posts
  -- devueltos y pedidos). El máximo por día es lo leído ese día.
  select coalesce(jsonb_agg(jsonb_build_object(
           'quota_date', q.quota_date, 'candidate_id', q.candidate_id,
           'posts', q.posts, 'requests', q.requests, 'runs', q.runs, 'items_new', q.items_new)
           order by q.quota_date, q.candidate_id), '[]'::jsonb)
    into v_x
    from (
      select r.cursor -> 'quota' ->> 'date' as quota_date, r.candidate_id,
             max(coalesce((r.cursor -> 'quota' ->> 'posts')::int, 0)) as posts,
             max(coalesce((r.cursor -> 'quota' ->> 'requests')::int, 0)) as requests,
             count(*) as runs, sum(coalesce(r.items_new, 0)) as items_new
        from public.source_runs r
       where r.source = 'x' and r.started_at >= v_from - interval '1 day' and r.started_at < v_to + interval '1 day'
         and r.cursor -> 'quota' ->> 'date' between p_from::text and p_to::text
       group by 1, 2
    ) q;

  select coalesce(jsonb_agg(jsonb_build_object(
           'candidate_id', c.id, 'enabled', coalesce(s.enabled, false),
           'max_posts_per_day', coalesce((s.settings ->> 'max_posts_per_day')::int, nullif(c.x_daily_cap, 0), 300),
           'max_requests_per_day', coalesce((s.settings ->> 'max_requests_per_day')::int, 10)) order by c.slug), '[]'::jsonb)
    into v_x_caps
    from public.candidates c
    left join public.candidate_sources s on s.candidate_id = c.id and s.source = 'x';

  select jsonb_build_object(
      'simulator', (select jsonb_build_object('enabled', enabled, 'daily_budget_usd', daily_budget_usd,
                                              'max_request_usd', max_request_usd)
                      from public.response_simulator_settings limit 1),
      'crisis', (select coalesce(jsonb_agg(jsonb_build_object('candidate_id', candidate_id, 'enabled', enabled,
                                                               'max_cost_usd', max_cost_usd)), '[]'::jsonb)
                   from public.crisis_agent_settings),
      'ai_visibility', (select coalesce(jsonb_agg(jsonb_build_object('candidate_id', candidate_id, 'enabled', enabled,
                                                                      'model', model, 'web_search', use_web_search,
                                                                      'prompts', jsonb_array_length(coalesce(prompts, '[]'::jsonb)))), '[]'::jsonb)
                          from public.ai_visibility_settings),
      'ai_visibility_budget', (select jsonb_build_object('daily_budget_usd', daily_budget_usd,
                                                         'last_reached_on', last_reached_on,
                                                         'updated_at', updated_at)
                                 from public.ai_visibility_budget where id),
      'ai_visibility_candidate_budgets', (select coalesce(jsonb_agg(jsonb_build_object(
                                             'candidate_id', candidate_id, 'daily_budget_usd', daily_budget_usd,
                                             'last_reached_on', last_reached_on, 'updated_at', updated_at)), '[]'::jsonb)
                                            from public.ai_visibility_candidate_budget))
    into v_caps;

  return jsonb_build_object(
    'generated_at', now(), 'from', p_from, 'to', p_to, 'timezone', tz,
    'rows', v_rows, 'x_usage', v_x, 'x_caps', v_x_caps, 'caps', v_caps,
    'candidates', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'slug', slug, 'name', name) order by name), '[]'::jsonb)
                     from public.candidates));
end;
$$;

comment on function public.pulso_spend_report(date, date) is
  'Panel Gasto (solo pulso_staff): agregados de costo por función/candidato/día, uso de X y topes. Sin textos ni ids de usuario.';

revoke all on function public.pulso_spend_report(date, date) from public, anon;
grant execute on function public.pulso_spend_report(date, date) to authenticated;

commit;
