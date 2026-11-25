-- Anuncios de Google (rutas oficiales: Political Ads Transparency Report y
-- Ads Transparency Center en BigQuery / GCS).
-- Propuesta: aplicar una vez en pulso-demo cuando se apruebe. NO APLICAR todavía.
-- No contiene secretos. El job queda apagado por defecto y NO está cableado al cron.
--
-- Por qué una tabla propia y no mentions: el gasto y las impresiones llegan en
-- rangos, hay región, targeting y un vínculo a la ficha oficial; no encajan en
-- una mención periodística. La deduplicación es por (candidato, fuente, ad_id).
--
-- El job (python -m pulso.google_ads) usa, según la fuente:
--   - el ZIP público official (sin credenciales) para el reporte político, o
--   - un proyecto de Google Cloud para consultar BigQuery del ATC.
-- La web (authenticated, vía candidate_members) solo lee. anon no recibe permisos.
--
-- Supabase otorga ALL a authenticated en tablas nuevas: este archivo revoca
-- esos privilegios y deja solo SELECT.

begin;

create table if not exists public.google_ads_settings (
  candidate_id uuid primary key references public.candidates(id) on delete cascade,
  enabled boolean not null default true,
  -- political_report: CSV/BigQuery de google_political_ads (Argentina, etc.).
  -- ads_transparency_center: dataset EEE/Turquía (España sí, Argentina no).
  source text not null default 'political_report'
    check (source in ('political_report', 'ads_transparency_center')),
  region text not null default 'AR',
  advertiser_ids text[] not null default '{}',
  advertiser_name_patterns text[] not null default '{}',
  last_run_on date,
  report_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.google_ads_settings is
  'Configuración por candidato para anuncios de Google. source elige la ruta oficial. advertiser_ids y advertiser_name_patterns filtran el reporte; patterns vacíos usan el default del código.';
comment on column public.google_ads_settings.source is
  'political_report = ZIP/BigQuery de anuncios electorales verificados. ads_transparency_center = anuncios mostrados en el EEE o Turquía.';
comment on column public.google_ads_settings.region is
  'Código ISO 3166-1 alpha-2 del país a filtrar (AR, ES, …).';
comment on column public.google_ads_settings.advertiser_ids is
  'IDs oficiales de anunciante (AR…). Vacío: se usan solo los patrones de nombre (o el default del código).';
comment on column public.google_ads_settings.advertiser_name_patterns is
  'Subcadenas a buscar en el nombre del anunciante, sin distinción de mayúsculas. Vacío usa el default del código.';
comment on column public.google_ads_settings.last_run_on is
  'Día de la última corrida exitosa en America/Argentina/Buenos_Aires.';
comment on column public.google_ads_settings.report_updated_at is
  'Momento de actualización que declara la fuente oficial, si está disponible.';

create table if not exists public.google_ads (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  source text not null
    check (source in ('political_report', 'ads_transparency_center')),
  ad_id text not null,
  ad_url text,
  ad_type text,
  regions text[] not null default '{}',
  advertiser_id text,
  advertiser_name text,
  advertiser_legal_name text,
  date_range_start date,
  date_range_end date,
  first_served_at text,
  last_served_at text,
  num_of_days integer,
  impressions_lower bigint,
  impressions_upper bigint,
  impressions_raw text,
  spend_currency text,
  spend_lower bigint,
  spend_upper bigint,
  age_targeting text,
  gender_targeting text,
  geo_targeting_included text,
  geo_targeting_excluded text,
  topic text,
  ad_funded_by text,
  is_funded_by_google_ad_grants boolean,
  raw jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  fetched_on date not null,
  updated_at timestamptz not null default now(),
  unique (candidate_id, source, ad_id),
  check (jsonb_typeof(raw) = 'object')
);

comment on table public.google_ads is
  'Anuncios de rutas oficiales de Google. Gasto e impresiones son rangos, no valores exactos. El creativo (texto, imagen, video) no viene en los datasets: ad_url apunta a la ficha oficial.';
comment on column public.google_ads.ad_id is
  'ID oficial del creativo (Ad_ID o creative_id).';
comment on column public.google_ads.ad_url is
  'URL oficial de la ficha en Ads Transparency Center. No se scrapea la página.';
comment on column public.google_ads.impressions_lower is
  'Cota inferior de impresiones según el rango oficial. Puede ser null si el rango es abierto.';
comment on column public.google_ads.spend_currency is
  'ISO de la moneda del rango de gasto (p. ej. ARS). El reporte político también publica otras monedas; se guarda la del país configurado.';
comment on column public.google_ads.first_served_at is
  'Texto oficial del primer served/shown. El reporte político no declara zona horaria en este campo; no se interpreta.';
comment on column public.google_ads.fetched_on is
  'Día de la corrida en America/Argentina/Buenos_Aires.';

create index if not exists google_ads_candidate_served_idx
  on public.google_ads (candidate_id, last_served_at desc);
create index if not exists google_ads_candidate_advertiser_idx
  on public.google_ads (candidate_id, advertiser_id);
create index if not exists google_ads_candidate_fetched_idx
  on public.google_ads (candidate_id, fetched_at desc);

alter table public.google_ads_settings enable row level security;
alter table public.google_ads_settings force row level security;
alter table public.google_ads enable row level security;
alter table public.google_ads force row level security;

grant select, insert, update on public.google_ads_settings to pulso_collector;
grant select, insert, update on public.google_ads to pulso_collector;

drop policy if exists google_ads_settings_collector_select on public.google_ads_settings;
create policy google_ads_settings_collector_select
  on public.google_ads_settings for select to pulso_collector using (true);

drop policy if exists google_ads_settings_collector_insert on public.google_ads_settings;
create policy google_ads_settings_collector_insert
  on public.google_ads_settings for insert to pulso_collector with check (true);

drop policy if exists google_ads_settings_collector_update on public.google_ads_settings;
create policy google_ads_settings_collector_update
  on public.google_ads_settings for update to pulso_collector using (true) with check (true);

drop policy if exists google_ads_collector_select on public.google_ads;
create policy google_ads_collector_select
  on public.google_ads for select to pulso_collector using (true);

drop policy if exists google_ads_collector_insert on public.google_ads;
create policy google_ads_collector_insert
  on public.google_ads for insert to pulso_collector with check (true);

drop policy if exists google_ads_collector_update on public.google_ads;
create policy google_ads_collector_update
  on public.google_ads for update to pulso_collector using (true) with check (true);

drop policy if exists google_ads_settings_member_select on public.google_ads_settings;
create policy google_ads_settings_member_select
  on public.google_ads_settings
  for select
  to authenticated
  using (
    exists (
      select 1 from public.candidate_members m
      where m.candidate_id = google_ads_settings.candidate_id
        and m.user_id = (select auth.uid())
    )
  );

drop policy if exists google_ads_member_select on public.google_ads;
create policy google_ads_member_select
  on public.google_ads
  for select
  to authenticated
  using (
    exists (
      select 1 from public.candidate_members m
      where m.candidate_id = google_ads.candidate_id
        and m.user_id = (select auth.uid())
    )
  );

revoke all on table public.google_ads_settings, public.google_ads
  from public, anon, authenticated, pulso_collector;
grant select on table public.google_ads_settings, public.google_ads to authenticated;
grant select, insert, update on public.google_ads_settings, public.google_ads to pulso_collector;
grant all on table public.google_ads_settings, public.google_ads to service_role;

commit;
