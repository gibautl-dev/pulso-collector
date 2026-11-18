-- Biblioteca de anuncios de Meta (Ad Library API, ads_archive).
-- Propuesta: aplicar una vez en pulso-demo cuando se apruebe. NO APLICAR todavía.
-- No contiene secretos. El job queda en PULSO_META_ADS_ENABLED (apagado por defecto).
--
-- Por qué una tabla propia y no mentions: el gasto y las impresiones llegan en
-- rangos, hay demografía, regiones, moneda y un snapshot; no encajan en una
-- mención periodística. La deduplicación es por id de la Biblioteca (ad_id).
--
-- El job (python -m pulso.meta_ads) usa META_ADS_ACCESS_TOKEN y el rol
-- pulso_collector. La web (authenticated, vía candidate_members) solo lee.
-- anon no recibe permisos. No hay triggers ni funciones (nada de auth.uid()
-- en un camino que recorra el recolector; las policies de lectura web sí
-- usan (select auth.uid())).
--
-- Supabase otorga ALL a authenticated en tablas nuevas: este archivo revoca
-- esos privilegios y deja solo SELECT.

begin;

create table if not exists public.meta_ads_settings (
  candidate_id uuid primary key references public.candidates(id) on delete cascade,
  enabled boolean not null default true,
  search_terms text[],
  search_page_ids text[] not null default '{}',
  ad_reached_countries text[] not null default array['AR']::text[],
  ad_active_status text not null default 'ALL'
    check (ad_active_status in ('ACTIVE', 'ALL', 'INACTIVE')),
  ad_type text not null default 'POLITICAL_AND_ISSUE_ADS'
    check (ad_type in (
      'ALL',
      'EMPLOYMENT_ADS',
      'FINANCIAL_PRODUCTS_AND_SERVICES_ADS',
      'HOUSING_ADS',
      'POLITICAL_AND_ISSUE_ADS'
    )),
  last_run_on date,
  updated_at timestamptz not null default now()
);

comment on table public.meta_ads_settings is
  'Configuración por candidato. search_terms null usa el default del código. search_page_ids son IDs de Páginas (hasta 10 por pedido a la API).';
comment on column public.meta_ads_settings.search_terms is
  'Lista de consultas a ads_archive. Cada término es un pedido aparte (límite oficial: 100 caracteres; el espacio es AND).';
comment on column public.meta_ads_settings.search_page_ids is
  'IDs opcionales de Páginas (la del candidato y rivales). La API acepta hasta 10 por request.';
comment on column public.meta_ads_settings.last_run_on is
  'Día de la última corrida exitosa en America/Argentina/Buenos_Aires.';

create table if not exists public.meta_ads (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  ad_id text not null,
  page_id text,
  page_name text,
  bylines text,
  publisher_platforms jsonb not null default '[]'::jsonb,
  currency text,
  spend_lower bigint,
  spend_upper bigint,
  spend_raw jsonb,
  impressions_lower bigint,
  impressions_upper bigint,
  impressions_raw jsonb,
  estimated_audience_size_lower bigint,
  estimated_audience_size_upper bigint,
  estimated_audience_size_raw jsonb,
  demographic_distribution jsonb not null default '[]'::jsonb,
  delivery_by_region jsonb not null default '[]'::jsonb,
  languages jsonb not null default '[]'::jsonb,
  ad_creative_bodies jsonb not null default '[]'::jsonb,
  ad_creative_link_captions jsonb not null default '[]'::jsonb,
  ad_creative_link_descriptions jsonb not null default '[]'::jsonb,
  ad_creative_link_titles jsonb not null default '[]'::jsonb,
  ad_snapshot_url text,
  ad_creation_time timestamptz,
  ad_delivery_start_time timestamptz,
  ad_delivery_stop_time timestamptz,
  query_kind text,
  query_value text,
  fetched_at timestamptz not null default now(),
  fetched_on date not null,
  updated_at timestamptz not null default now(),
  unique (candidate_id, ad_id),
  check (jsonb_typeof(publisher_platforms) = 'array'),
  check (jsonb_typeof(demographic_distribution) = 'array'),
  check (jsonb_typeof(delivery_by_region) = 'array'),
  check (jsonb_typeof(languages) = 'array'),
  check (jsonb_typeof(ad_creative_bodies) = 'array')
);

comment on table public.meta_ads is
  'Anuncios de la Biblioteca de Meta (Facebook e Instagram) que alcanzaron el país configurado. Gasto e impresiones son rangos, no valores exactos. La moneda es el ISO que informa la API.';
comment on column public.meta_ads.ad_id is
  'Library ID oficial del anuncio (campo id de ArchivedAd).';
comment on column public.meta_ads.bylines is
  'Quién pagó el anuncio (funding entity), solo en POLITICAL_AND_ISSUE_ADS.';
comment on column public.meta_ads.spend_lower is
  'Cota inferior del gasto, en la moneda de currency. Puede ser null si el rango es abierto (p. ej. <100).';
comment on column public.meta_ads.spend_upper is
  'Cota superior del gasto. Puede ser null si el rango es abierto (p. ej. >1M).';
comment on column public.meta_ads.impressions_lower is
  'Cota inferior de impresiones (rangos oficiales, no un recuento exacto).';
comment on column public.meta_ads.ad_snapshot_url is
  'URL oficial del anuncio archivado en la Biblioteca. No se scrapea la ficha.';
comment on column public.meta_ads.fetched_on is
  'Día de la corrida en America/Argentina/Buenos_Aires.';

create index if not exists meta_ads_candidate_fetched_idx
  on public.meta_ads (candidate_id, fetched_at desc);
create index if not exists meta_ads_candidate_page_idx
  on public.meta_ads (candidate_id, page_id);
create index if not exists meta_ads_candidate_delivery_idx
  on public.meta_ads (candidate_id, ad_delivery_start_time desc);

alter table public.meta_ads_settings enable row level security;
alter table public.meta_ads_settings force row level security;
alter table public.meta_ads enable row level security;
alter table public.meta_ads force row level security;

grant select, insert, update on public.meta_ads_settings to pulso_collector;
grant select, insert, update on public.meta_ads to pulso_collector;

drop policy if exists meta_ads_settings_collector_select on public.meta_ads_settings;
create policy meta_ads_settings_collector_select
  on public.meta_ads_settings for select to pulso_collector using (true);

drop policy if exists meta_ads_settings_collector_insert on public.meta_ads_settings;
create policy meta_ads_settings_collector_insert
  on public.meta_ads_settings for insert to pulso_collector with check (true);

drop policy if exists meta_ads_settings_collector_update on public.meta_ads_settings;
create policy meta_ads_settings_collector_update
  on public.meta_ads_settings for update to pulso_collector using (true) with check (true);

drop policy if exists meta_ads_collector_select on public.meta_ads;
create policy meta_ads_collector_select
  on public.meta_ads for select to pulso_collector using (true);

drop policy if exists meta_ads_collector_insert on public.meta_ads;
create policy meta_ads_collector_insert
  on public.meta_ads for insert to pulso_collector with check (true);

drop policy if exists meta_ads_collector_update on public.meta_ads;
create policy meta_ads_collector_update
  on public.meta_ads for update to pulso_collector using (true) with check (true);

drop policy if exists meta_ads_settings_member_select on public.meta_ads_settings;
create policy meta_ads_settings_member_select
  on public.meta_ads_settings
  for select
  to authenticated
  using (
    exists (
      select 1 from public.candidate_members m
      where m.candidate_id = meta_ads_settings.candidate_id
        and m.user_id = (select auth.uid())
    )
  );

drop policy if exists meta_ads_member_select on public.meta_ads;
create policy meta_ads_member_select
  on public.meta_ads
  for select
  to authenticated
  using (
    exists (
      select 1 from public.candidate_members m
      where m.candidate_id = meta_ads.candidate_id
        and m.user_id = (select auth.uid())
    )
  );

revoke all on table public.meta_ads_settings, public.meta_ads
  from public, anon, authenticated;
grant select on table public.meta_ads_settings, public.meta_ads to authenticated;
grant all on table public.meta_ads_settings, public.meta_ads to service_role;

commit;
