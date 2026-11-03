-- Paso 1. Ejecutar una vez en un proyecto Supabase nuevo.
begin;

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete set null,
  slug text unique not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(trim(name)) > 0),
  keywords text[] not null check (cardinality(keywords) > 0),
  exclude_keywords text[] not null default '{}',
  own_accounts jsonb not null default '{}',
  reference_accounts jsonb not null default '{}',
  alert_feeds text[] not null default '{}',
  x_daily_cap integer not null default 300 check (x_daily_cap >= 0),
  created_at timestamptz not null default now()
);

create table public.source_catalog (
  source text primary key,
  enabled_by_default boolean not null default false,
  interval_seconds integer not null check (interval_seconds >= 60)
);
insert into public.source_catalog values
 ('rss_media',true,1200), ('google_news',true,1200),
 ('google_alerts',false,1200), ('youtube',false,3600),
 ('gdelt',false,1200), ('x',false,1200), ('facebook',false,1200),
 ('instagram',false,1200), ('serp',false,86400), ('llm',false,1200);

create table public.candidate_sources (
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  source text not null references public.source_catalog(source),
  enabled boolean not null default false,
  interval_seconds integer not null check (interval_seconds >= 60),
  settings jsonb not null default '{}' check (jsonb_typeof(settings) = 'object'),
  cursor jsonb not null default '{}' check (jsonb_typeof(cursor) = 'object'),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  next_run_at timestamptz,
  collection_started_at timestamptz,
  baseline_started_at timestamptz,
  requested_since timestamptz,
  earliest_observed_at timestamptz,
  latest_observed_at timestamptz,
  coverage_status text not null default 'unknown'
    check (coverage_status in ('unknown','partial','complete')),
  coverage_from timestamptz,
  coverage_to timestamptz,
  updated_at timestamptz not null default now(),
  primary key (candidate_id,source),
  check (source <> 'youtube' or interval_seconds >= 3600),
  check (source <> 'serp' or interval_seconds >= 86400),
  check (earliest_observed_at <= latest_observed_at),
  check (coverage_from <= coverage_to),
  check (coverage_status <> 'complete' or
    (coverage_from is not null and coverage_to is not null))
);

create function public.initialize_candidate_sources() returns trigger
language plpgsql set search_path = '' as $$
begin
  insert into public.candidate_sources (candidate_id,source,enabled,interval_seconds)
    select new.id,source,enabled_by_default,interval_seconds from public.source_catalog;
  return new;
end;
$$;
create trigger candidate_sources_after_insert after insert on public.candidates
 for each row execute function public.initialize_candidate_sources();

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  label text not null check (length(trim(label)) > 0),
  summary text,
  first_seen timestamptz,
  last_seen timestamptz,
  unique (candidate_id,id),
  check (first_seen <= last_seen)
);

create table public.mentions (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  source text not null references public.source_catalog(source),
  source_item_id text,
  url text not null check (url ~ '^https?://'),
  url_hash text not null check (url_hash ~ '^[0-9a-f]{64}$'),
  title text,
  content text,
  author text,
  author_handle text,
  outlet text,
  published_at timestamptz not null,
  collected_at timestamptz not null default now(),
  metrics jsonb not null default '{}' check (jsonb_typeof(metrics) = 'object'),
  lang text,
  account_relation text not null default 'third_party'
    check (account_relation in ('third_party','own','reference')),
  tone text check (tone in ('a_favor','critica','insulto','acusacion','pregunta','informativo')),
  tone_reason text,
  tone_confidence numeric(5,4) check (tone_confidence between 0 and 1),
  target text check (target in ('candidate','other','unclear')),
  topic_id uuid,
  classified_at timestamptz,
  classification_model text,
  classification_prompt_version text,
  unique (candidate_id,url_hash),
  foreign key (candidate_id,topic_id) references public.topics(candidate_id,id),
  check (classified_at is null or (tone is not null and target is not null
    and tone_confidence is not null))
);
create unique index mentions_native_id on public.mentions(candidate_id,source,source_item_id)
 where source_item_id is not null;
create index mentions_candidate_time on public.mentions(candidate_id,published_at desc);
create index mentions_candidate_topic_time on public.mentions(candidate_id,topic_id,published_at desc);
create index mentions_pending on public.mentions(candidate_id,collected_at) where classified_at is null;

create table public.serp_snapshots (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  query text not null,
  taken_at timestamptz not null default now(),
  results jsonb not null check (jsonb_typeof(results) = 'array')
);
create index serp_candidate_time on public.serp_snapshots(candidate_id,taken_at desc);

create table public.source_runs (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  source text not null references public.source_catalog(source),
  run_kind text not null default 'scheduled' check (run_kind in ('scheduled','backfill','manual')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','ok','partial','error','skipped')),
  items_found integer not null default 0 check (items_found >= 0),
  items_new integer not null default 0 check (items_new >= 0 and items_new <= items_found),
  error text,
  cursor jsonb,
  check (finished_at >= started_at),
  check ((status = 'running' and finished_at is null) or
         (status <> 'running' and finished_at is not null))
);
create index source_runs_candidate_time on public.source_runs(candidate_id,source,started_at desc);

-- Dos filas si corresponde: global por credencial y candidate por candidato.
-- Reservas y consumos deben actualizarse atómicamente, bajo bloqueo de fila.
create table public.daily_usage (
  id uuid primary key default gen_random_uuid(),
  source text not null references public.source_catalog(source),
  credential_scope text not null default 'default', -- identificador no secreto
  scope text not null check (scope in ('global','candidate')),
  candidate_id uuid references public.candidates(id) on delete cascade,
  usage_date date not null,
  reset_timezone text not null,
  units_used bigint not null default 0 check (units_used >= 0),
  units_reserved bigint not null default 0 check (units_reserved >= 0),
  units_limit bigint check (units_limit >= 0),
  cost_usd numeric(16,8) not null default 0 check (cost_usd >= 0),
  cost_reserved_usd numeric(16,8) not null default 0 check (cost_reserved_usd >= 0),
  budget_usd numeric(16,8) check (budget_usd >= 0),
  updated_at timestamptz not null default now(),
  check ((scope = 'global' and candidate_id is null) or
         (scope = 'candidate' and candidate_id is not null)),
  unique nulls not distinct (source,credential_scope,scope,candidate_id,usage_date)
);

create table public.ai_outputs (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  kind text not null check (kind in ('explain','reply','daily_brief')),
  input_ref jsonb not null default '{}',
  output jsonb not null check (jsonb_typeof(output) = 'object'),
  model text not null,
  prompt_version text not null,
  created_at timestamptz not null default now()
);
create index ai_outputs_candidate_time on public.ai_outputs(candidate_id,created_at desc);
create index candidates_owner on public.candidates(owner_user_id);

-- Denegar acceso de navegador por defecto, aun con grants previos de Supabase.
-- Solo datos de producto legibles por el dueño autenticado. Sin escritura pública.
do $$
declare t text;
begin
  foreach t in array array['candidates','source_catalog','candidate_sources','topics',
    'mentions','serp_snapshots','source_runs','daily_usage','ai_outputs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end;
$$;
revoke all on function public.initialize_candidate_sources() from public, anon, authenticated;

grant select on public.candidates, public.topics, public.mentions,
  public.serp_snapshots, public.ai_outputs to authenticated;
create policy candidates_owner_read on public.candidates for select to authenticated
 using (owner_user_id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['topics','mentions','serp_snapshots','ai_outputs'] loop
    execute format('create policy owner_read on public.%I for select to authenticated
      using (exists (select 1 from public.candidates c
        where c.id = candidate_id and c.owner_user_id = (select auth.uid())))', t);
  end loop;
end;
$$;
commit;
