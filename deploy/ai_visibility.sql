-- Resultados en IA (respuestas de un modelo a preguntas fijas sobre el candidato).
-- PROPUESTA. NO APLICAR en pulso-demo hasta que se apruebe explícitamente.
-- No contiene secretos. No habilita el job: PULSO_AI_VISIBILITY_ENABLED sigue en false.
--
-- El job (python -m pulso.ai_visibility) usa la misma clave LLM que el clasificador
-- y, cuando se habilite, debería correr con el rol pulso_classifier. La web
-- (authenticated, vía candidate_members) solo lee. anon no recibe permisos.

begin;

create table if not exists public.ai_visibility_settings (
  candidate_id uuid primary key references public.candidates(id) on delete cascade,
  enabled boolean not null default false,
  provider text not null default 'openai',
  model text not null default 'chat-latest',
  use_web_search boolean not null default true,
  prompts jsonb,
  updated_at timestamptz not null default now(),
  check (prompts is null or jsonb_typeof(prompts) = 'array')
);

comment on table public.ai_visibility_settings is
  'Configuración por candidato. prompts null usa el set por defecto del código (8 a 12 preguntas).';
comment on column public.ai_visibility_settings.prompts is
  'Lista opcional de {key, text}. El texto admite {name}.';

create table if not exists public.ai_answers (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  provider text not null default 'openai',
  model text not null,
  prompt_key text not null,
  prompt text not null,
  answer text not null,
  citations jsonb not null default '[]'::jsonb,
  tone text check (tone in ('a_favor', 'critica', 'insulto', 'acusacion', 'pregunta', 'informativo')),
  target text check (target in ('candidate', 'other', 'unclear')),
  tone_confidence numeric,
  tone_reason text,
  topic text,
  relevance text check (relevance in ('alta', 'media', 'baja')),
  other_politicians jsonb not null default '[]'::jsonb,
  asked_at timestamptz not null,
  asked_on date not null,
  cost numeric,
  usage jsonb not null default '{}'::jsonb,
  classification_model text,
  classification_prompt_version text,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(citations) = 'array'),
  check (jsonb_typeof(other_politicians) = 'array'),
  unique (candidate_id, provider, prompt_key, asked_on)
);

comment on table public.ai_answers is
  'Respuestas de un modelo a un set fijo de preguntas sobre el candidato. Una fila por pregunta y día.';
comment on column public.ai_answers.asked_on is
  'Día de la corrida en America/Argentina/Buenos_Aires. Garantiza una corrida diaria.';
comment on column public.ai_answers.citations is
  'Lista de {url, title, source} extraída de la búsqueda web de la API.';
comment on column public.ai_answers.cost is
  'Costo estimado en USD de esa respuesta (tokens + llamadas de web search).';

create index if not exists ai_answers_candidate_asked_idx
  on public.ai_answers (candidate_id, asked_at desc);

alter table public.ai_visibility_settings enable row level security;
alter table public.ai_visibility_settings force row level security;
alter table public.ai_answers enable row level security;
alter table public.ai_answers force row level security;

-- El job de visibilidad comparte el rol del clasificador (misma clave LLM).
grant select, insert, update on public.ai_visibility_settings to pulso_classifier;
grant select, insert on public.ai_answers to pulso_classifier;

drop policy if exists ai_visibility_settings_classifier_select on public.ai_visibility_settings;
create policy ai_visibility_settings_classifier_select
  on public.ai_visibility_settings for select to pulso_classifier using (true);

drop policy if exists ai_visibility_settings_classifier_insert on public.ai_visibility_settings;
create policy ai_visibility_settings_classifier_insert
  on public.ai_visibility_settings for insert to pulso_classifier with check (true);

drop policy if exists ai_visibility_settings_classifier_update on public.ai_visibility_settings;
create policy ai_visibility_settings_classifier_update
  on public.ai_visibility_settings for update to pulso_classifier using (true) with check (true);

drop policy if exists ai_answers_classifier_select on public.ai_answers;
create policy ai_answers_classifier_select
  on public.ai_answers for select to pulso_classifier using (true);

drop policy if exists ai_answers_classifier_insert on public.ai_answers;
create policy ai_answers_classifier_insert
  on public.ai_answers for insert to pulso_classifier with check (true);

-- Web: miembros del candidato leen configuración no secreta y las respuestas.
drop policy if exists ai_visibility_settings_member_select on public.ai_visibility_settings;
create policy ai_visibility_settings_member_select
  on public.ai_visibility_settings
  for select
  to authenticated
  using (
    exists (
      select 1 from public.candidate_members m
      where m.candidate_id = ai_visibility_settings.candidate_id
        and m.user_id = (select auth.uid())
    )
  );

drop policy if exists ai_answers_member_select on public.ai_answers;
create policy ai_answers_member_select
  on public.ai_answers
  for select
  to authenticated
  using (
    exists (
      select 1 from public.candidate_members m
      where m.candidate_id = ai_answers.candidate_id
        and m.user_id = (select auth.uid())
    )
  );

-- Supabase otorga ALL a authenticated en tablas nuevas; hay que recortar.
revoke all on table public.ai_visibility_settings, public.ai_answers
  from public, anon, authenticated;
grant select on table public.ai_visibility_settings, public.ai_answers to authenticated;
grant all on table public.ai_visibility_settings, public.ai_answers to service_role;

commit;
