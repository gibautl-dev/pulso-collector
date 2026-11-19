-- Clasificación de anuncios de Meta respecto del candidato (a favor / en contra / neutral).
-- Propuesta: aplicar una vez en pulso-demo cuando se apruebe. NO APLICAR todavía.
-- No contiene secretos. El job queda en PULSO_META_ADS_CLASSIFY_ENABLED (apagado por defecto).
--
-- Tabla propia, no columnas en meta_ads: el upsert diario de la Biblioteca no debe
-- pisar ni borrar una clasificación. Nunca se actualiza una fila existente.
--
-- El job (python -m pulso.meta_ads.classify) usa el rol pulso_classifier, la clave
-- del LLM y CLASSIFIER_DATABASE_URL. Lee meta_ads (SELECT) y escribe solo inserts.
-- La web (authenticated, vía candidate_members) solo lee. anon no recibe permisos.
-- No hay triggers ni funciones (nada de auth.uid() en un camino del recolector;
-- las policies de lectura web sí usan (select auth.uid())).
--
-- Supabase otorga ALL a authenticated en tablas nuevas: este archivo revoca
-- esos privilegios y deja solo SELECT.

begin;

create table if not exists public.meta_ad_classifications (
  id uuid primary key default gen_random_uuid(),
  meta_ad_id uuid not null references public.meta_ads(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  ad_id text not null,
  stance text not null
    check (stance in ('a_favor', 'en_contra', 'neutral_otro')),
  reason text,
  confidence numeric(5, 4)
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  classified_at timestamptz not null default now(),
  classification_model text,
  classification_prompt_version text,
  unique (meta_ad_id),
  unique (candidate_id, ad_id)
);

comment on table public.meta_ad_classifications is
  'Clasificación de cada anuncio de la Biblioteca respecto del candidato. Una fila por anuncio; no se pisa.';
comment on column public.meta_ad_classifications.stance is
  'a_favor: apoya o promociona al candidato o su gobierno. en_contra: lo ataca o critica. neutral_otro: noticia, informativo o no trata de él.';
comment on column public.meta_ad_classifications.reason is
  'Frase corta generada por el clasificador. No es una cita literal del anuncio.';
comment on column public.meta_ad_classifications.confidence is
  'Confianza del modelo, de 0 a 1.';

create index if not exists meta_ad_classifications_candidate_stance_idx
  on public.meta_ad_classifications (candidate_id, stance);

alter table public.meta_ad_classifications enable row level security;
alter table public.meta_ad_classifications force row level security;

-- El clasificador necesita leer los anuncios pendientes.
drop policy if exists meta_ads_classifier_select on public.meta_ads;
create policy meta_ads_classifier_select
  on public.meta_ads for select to pulso_classifier using (true);

drop policy if exists meta_ad_classifications_classifier_select on public.meta_ad_classifications;
create policy meta_ad_classifications_classifier_select
  on public.meta_ad_classifications for select to pulso_classifier using (true);

drop policy if exists meta_ad_classifications_classifier_insert on public.meta_ad_classifications;
create policy meta_ad_classifications_classifier_insert
  on public.meta_ad_classifications for insert to pulso_classifier with check (true);

drop policy if exists meta_ad_classifications_member_select on public.meta_ad_classifications;
create policy meta_ad_classifications_member_select
  on public.meta_ad_classifications
  for select
  to authenticated
  using (
    exists (
      select 1 from public.candidate_members m
      where m.candidate_id = meta_ad_classifications.candidate_id
        and m.user_id = (select auth.uid())
    )
  );

revoke all on table public.meta_ad_classifications
  from public, anon, authenticated, pulso_collector, pulso_classifier;
grant select on table public.meta_ad_classifications to authenticated;
grant select, insert on table public.meta_ad_classifications to pulso_classifier;
grant all on table public.meta_ad_classifications to service_role;

-- SELECT adicional sobre meta_ads para el clasificador; no se tocan los demás grants.
grant select on table public.meta_ads to pulso_classifier;

commit;
