-- NO APLICAR todavía. Visitas diarias a la ficha de Wikipedia de cada
-- candidato (API oficial de Wikimedia, sin clave).
--
-- Por qué una tabla propia y no mentions: es una serie de interés (visitas
-- por día), no una mención periodística. La deduplicación es por
-- (candidato, proyecto, artículo, día).
--
-- El job (python -m pulso.wikipedia) queda apagado hasta
-- PULSO_WIKIPEDIA_ENABLED=true, después de aplicar esta migración y
-- redesplegar el cron.
--
-- La web (authenticated, vía candidate_members) solo lee. anon no recibe
-- permisos. Supabase otorga ALL a authenticated en tablas nuevas: este
-- archivo revoca esos privilegios y deja solo SELECT.
--
-- Títulos por defecto (se pueden cambiar en wikipedia_pageview_settings.article):
--   axel-kicillof  Axel_Kicillof
--   milei          Javier_Milei
--   pedro-sanchez  Pedro_Sánchez
-- Proyecto por defecto: es.wikipedia.

begin;

create table if not exists public.wikipedia_pageview_settings (
  candidate_id uuid primary key references public.candidates(id) on delete cascade,
  enabled boolean not null default true,
  project text not null default 'es.wikipedia',
  article text not null check (length(trim(article)) > 0),
  last_run_on date,
  updated_at timestamptz not null default now()
);

comment on table public.wikipedia_pageview_settings is
  'Configuración por candidato para la serie de visitas de Wikipedia. article es el título en el wiki (con guiones bajos).';
comment on column public.wikipedia_pageview_settings.project is
  'Proyecto Wikimedia, por defecto es.wikipedia.';
comment on column public.wikipedia_pageview_settings.article is
  'Título del artículo, configurable por candidato.';
comment on column public.wikipedia_pageview_settings.last_run_on is
  'Día de la última corrida exitosa en America/Argentina/Buenos_Aires.';

create table if not exists public.wikipedia_pageviews (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  project text not null,
  article text not null,
  day date not null,
  views bigint not null check (views >= 0),
  collected_at timestamptz not null default now(),
  unique (candidate_id, project, article, day)
);

comment on table public.wikipedia_pageviews is
  'Visitas diarias (agentes user, all-access) según la API de Wikimedia. El día es el que declara la API.';
comment on column public.wikipedia_pageviews.views is
  'Cantidad de visitas de personas ese día, según Wikimedia.';

create index if not exists wikipedia_pageviews_candidate_day_idx
  on public.wikipedia_pageviews (candidate_id, day desc);

alter table public.wikipedia_pageview_settings enable row level security;
alter table public.wikipedia_pageview_settings force row level security;
alter table public.wikipedia_pageviews enable row level security;
alter table public.wikipedia_pageviews force row level security;

drop policy if exists wikipedia_settings_collector_select on public.wikipedia_pageview_settings;
create policy wikipedia_settings_collector_select
  on public.wikipedia_pageview_settings for select to pulso_collector using (true);

drop policy if exists wikipedia_settings_collector_insert on public.wikipedia_pageview_settings;
create policy wikipedia_settings_collector_insert
  on public.wikipedia_pageview_settings for insert to pulso_collector with check (true);

drop policy if exists wikipedia_settings_collector_update on public.wikipedia_pageview_settings;
create policy wikipedia_settings_collector_update
  on public.wikipedia_pageview_settings for update to pulso_collector using (true) with check (true);

drop policy if exists wikipedia_pageviews_collector_select on public.wikipedia_pageviews;
create policy wikipedia_pageviews_collector_select
  on public.wikipedia_pageviews for select to pulso_collector using (true);

drop policy if exists wikipedia_pageviews_collector_insert on public.wikipedia_pageviews;
create policy wikipedia_pageviews_collector_insert
  on public.wikipedia_pageviews for insert to pulso_collector with check (true);

drop policy if exists wikipedia_pageviews_collector_update on public.wikipedia_pageviews;
create policy wikipedia_pageviews_collector_update
  on public.wikipedia_pageviews for update to pulso_collector using (true) with check (true);

drop policy if exists wikipedia_settings_member_select on public.wikipedia_pageview_settings;
create policy wikipedia_settings_member_select
  on public.wikipedia_pageview_settings
  for select
  to authenticated
  using (
    exists (
      select 1 from public.candidate_members m
      where m.candidate_id = wikipedia_pageview_settings.candidate_id
        and m.user_id = (select auth.uid())
    )
  );

drop policy if exists wikipedia_pageviews_member_select on public.wikipedia_pageviews;
create policy wikipedia_pageviews_member_select
  on public.wikipedia_pageviews
  for select
  to authenticated
  using (
    exists (
      select 1 from public.candidate_members m
      where m.candidate_id = wikipedia_pageviews.candidate_id
        and m.user_id = (select auth.uid())
    )
  );

revoke all on table public.wikipedia_pageview_settings, public.wikipedia_pageviews
  from public, anon, authenticated, pulso_collector;
grant select on table public.wikipedia_pageview_settings, public.wikipedia_pageviews to authenticated;
grant select, insert, update on public.wikipedia_pageview_settings, public.wikipedia_pageviews to pulso_collector;
grant all on table public.wikipedia_pageview_settings, public.wikipedia_pageviews to service_role;

insert into public.wikipedia_pageview_settings (candidate_id, enabled, project, article)
select c.id, true, 'es.wikipedia', v.article
  from public.candidates c
  join (values
    ('axel-kicillof', 'Axel_Kicillof'),
    ('milei', 'Javier_Milei'),
    ('pedro-sanchez', 'Pedro_Sánchez')
  ) as v(slug, article) on v.slug = c.slug
on conflict (candidate_id) do nothing;

commit;
