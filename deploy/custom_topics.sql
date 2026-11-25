-- Temas a medida por candidato, con analista especializado (resúmenes para revisión humana).
-- Aplicada en pulso-demo (bkjugpesqbplnaeotadh) el 2026-11-24 (hora de Argentina). No volver a aplicar tal cual si ya está.
-- No contiene secretos. No cambia roles de collector/classifier. No invita usuarios.
-- No enciende recolección nueva: el recorte usa menciones que ya están en public.mentions.
-- No modifica el job ni los umbrales del agente de crisis.
--
-- Qué crearía:
--   * public.custom_topics: temática definida a mano (nombre, descripción, palabras,
--     exclusiones, fuentes opcionales). No se confunde con public.topics (clasificador).
--   * public.custom_topic_summaries: borradores del analista del tema, para aprobar
--     o descartar. Nada se publica solo.
--   * public.custom_topic_classifications: caché opcional de relevancia (gpt-6-luna).
--   * RLS: un miembro ve solo los temas de su candidato. El staff ve y escribe todos.
--     Si más adelante existe candidate_members.role = 'admin', esa persona también
--     puede escribir los temas de su candidato. Hoy el rol permitido sigue siendo
--     solo 'viewer'; la migración deja la puerta lista sin promover a nadie.
--
-- Costo de aplicar el SQL: USD 0.

begin;

-- Puerta para un admin de candidato, sin cambiar filas existentes.
alter table public.candidate_members
  drop constraint if exists candidate_members_role_check;
alter table public.candidate_members
  add constraint candidate_members_role_check
  check (role in ('viewer', 'admin'));

create table if not exists public.custom_topics (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  keywords text[] not null default '{}',
  include_terms text[] not null default '{}',
  exclude_terms text[] not null default '{}',
  sources text[] ,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (candidate_id, id)
);

comment on table public.custom_topics is
  'Temática definida a mano para un candidato. Se recorta sobre menciones ya recolectadas; no es el tema del clasificador automático.';

create index if not exists custom_topics_candidate
  on public.custom_topics (candidate_id, created_at desc);

create table if not exists public.custom_topic_summaries (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.custom_topics(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'discarded')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  output jsonb not null default '{}'::jsonb,
  model text,
  cost_usd numeric(12, 6) check (cost_usd is null or cost_usd >= 0),
  usage jsonb not null default '{}'::jsonb,
  prompt_version text not null,
  origin text not null default 'ai' check (origin in ('ai', 'fixture_example')),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  reviewed_at timestamptz,
  foreign key (candidate_id, topic_id) references public.custom_topics(candidate_id, id)
);

comment on table public.custom_topic_summaries is
  'Resumen del analista de un tema a medida. Una persona aprueba o descarta; Pulso no publica.';

create index if not exists custom_topic_summaries_topic_created
  on public.custom_topic_summaries (topic_id, created_at desc);

create table if not exists public.custom_topic_classifications (
  topic_id uuid not null references public.custom_topics(id) on delete cascade,
  mention_id uuid not null references public.mentions(id) on delete cascade,
  candidate_id uuid not null,
  relevance text not null check (relevance in ('alta', 'media', 'baja')),
  reason text,
  model text,
  cost_usd numeric(12, 6) check (cost_usd is null or cost_usd >= 0),
  created_at timestamptz not null default now(),
  primary key (topic_id, mention_id)
);

comment on table public.custom_topic_classifications is
  'Caché de relevancia (gpt-6-luna) para menciones ya recortadas por palabras clave.';

alter table public.custom_topics enable row level security;
alter table public.custom_topic_summaries enable row level security;
alter table public.custom_topic_classifications enable row level security;

revoke all on table public.custom_topics from public, anon, authenticated, pulso_collector, pulso_classifier;
revoke all on table public.custom_topic_summaries from public, anon, authenticated, pulso_collector, pulso_classifier;
revoke all on table public.custom_topic_classifications from public, anon, authenticated, pulso_collector, pulso_classifier;
grant all on table public.custom_topics to service_role;
grant all on table public.custom_topic_summaries to service_role;
grant all on table public.custom_topic_classifications to service_role;
grant select, insert, update, delete on table public.custom_topics to authenticated;
grant select, insert, update on table public.custom_topic_summaries to authenticated;
grant select, insert, update, delete on table public.custom_topic_classifications to authenticated;

-- Lectura: miembro del candidato, o staff.
drop policy if exists custom_topics_member_select on public.custom_topics;
create policy custom_topics_member_select on public.custom_topics
  for select to authenticated
  using (
    exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid()))
    or exists (
      select 1 from public.candidate_members m
      where m.candidate_id = custom_topics.candidate_id
        and m.user_id = (select auth.uid())
    )
  );

drop policy if exists custom_topics_staff_or_admin_write on public.custom_topics;
create policy custom_topics_staff_or_admin_insert on public.custom_topics
  for insert to authenticated
  with check (
    exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid()))
    or exists (
      select 1 from public.candidate_members m
      where m.candidate_id = custom_topics.candidate_id
        and m.user_id = (select auth.uid())
        and m.role = 'admin'
    )
  );

create policy custom_topics_staff_or_admin_update on public.custom_topics
  for update to authenticated
  using (
    exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid()))
    or exists (
      select 1 from public.candidate_members m
      where m.candidate_id = custom_topics.candidate_id
        and m.user_id = (select auth.uid())
        and m.role = 'admin'
    )
  )
  with check (
    exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid()))
    or exists (
      select 1 from public.candidate_members m
      where m.candidate_id = custom_topics.candidate_id
        and m.user_id = (select auth.uid())
        and m.role = 'admin'
    )
  );

create policy custom_topics_staff_or_admin_delete on public.custom_topics
  for delete to authenticated
  using (
    exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid()))
    or exists (
      select 1 from public.candidate_members m
      where m.candidate_id = custom_topics.candidate_id
        and m.user_id = (select auth.uid())
        and m.role = 'admin'
    )
  );

drop policy if exists custom_topic_summaries_member_select on public.custom_topic_summaries;
create policy custom_topic_summaries_member_select on public.custom_topic_summaries
  for select to authenticated
  using (
    exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid()))
    or exists (
      select 1 from public.candidate_members m
      where m.candidate_id = custom_topic_summaries.candidate_id
        and m.user_id = (select auth.uid())
    )
  );

create policy custom_topic_summaries_member_insert on public.custom_topic_summaries
  for insert to authenticated
  with check (
    exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid()))
    or exists (
      select 1 from public.candidate_members m
      where m.candidate_id = custom_topic_summaries.candidate_id
        and m.user_id = (select auth.uid())
    )
  );

create policy custom_topic_summaries_member_update on public.custom_topic_summaries
  for update to authenticated
  using (
    exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid()))
    or exists (
      select 1 from public.candidate_members m
      where m.candidate_id = custom_topic_summaries.candidate_id
        and m.user_id = (select auth.uid())
    )
  )
  with check (
    exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid()))
    or exists (
      select 1 from public.candidate_members m
      where m.candidate_id = custom_topic_summaries.candidate_id
        and m.user_id = (select auth.uid())
    )
  );

drop policy if exists custom_topic_classifications_member_select on public.custom_topic_classifications;
create policy custom_topic_classifications_member_select on public.custom_topic_classifications
  for select to authenticated
  using (
    exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid()))
    or exists (
      select 1 from public.candidate_members m
      where m.candidate_id = custom_topic_classifications.candidate_id
        and m.user_id = (select auth.uid())
    )
  );

create policy custom_topic_classifications_staff_or_admin_write on public.custom_topic_classifications
  for insert to authenticated
  with check (
    exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid()))
    or exists (
      select 1 from public.candidate_members m
      where m.candidate_id = custom_topic_classifications.candidate_id
        and m.user_id = (select auth.uid())
        and m.role = 'admin'
    )
  );

commit;
