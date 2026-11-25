-- Comparación de rivales por candidato (panel Active + vista del cliente).
-- Aplicada en pulso-demo (bkjugpesqbplnaeotadh) el 2026-11-24. No volver a aplicar tal cual si ya está.
-- No contiene secretos. No cambia roles de collector/classifier. No invita usuarios.
--
-- Qué crea:
--   * public.pulso_staff: quién de Active puede asignar rivales. La primera fila
--     se carga a mano (un INSERT con el user_id de Auth). No hay alta desde la app.
--   * public.candidate_rivals: par (candidato, rival) con un nivel:
--       radar        = solo menciones en medios
--       comparativo  = volumen, balance y anuncios
--       completo     = medios, X, IA, anuncios y cuentas sospechosas
--   * Políticas RLS extra para que un miembro de A lea, acotado por nivel, los
--     datos ya recolectados de B si B está asignado como rival de A. El cliente
--     no ve rivales de otro candidato ni datos fuera del nivel.
--   * El staff puede leer el directorio de candidatos (id, slug, name) y
--     crear/editar/borrar filas de candidate_rivals.
--
-- Costo: aplicar este SQL no gasta API ni tokens. Si el rival ya es un candidato
-- de Pulso con recolección andando, no hay costo extra. Ver deploy/CANDIDATE_RIVALS.md.

begin;

create table if not exists public.pulso_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  note text
);

comment on table public.pulso_staff is
  'Equipo de Active que puede administrar asignaciones de rivales. Sin altas desde la app.';

create table if not exists public.candidate_rivals (
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  rival_id uuid not null references public.candidates(id) on delete cascade,
  level text not null check (level in ('radar', 'comparativo', 'completo')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  primary key (candidate_id, rival_id),
  check (candidate_id <> rival_id)
);

comment on table public.candidate_rivals is
  'Rivales designados por Active para la comparación que ve el cliente de ese candidato.';

create index if not exists candidate_rivals_rival on public.candidate_rivals(rival_id);

alter table public.pulso_staff enable row level security;
alter table public.candidate_rivals enable row level security;

revoke all on table public.pulso_staff from public, anon, authenticated, pulso_collector, pulso_classifier;
revoke all on table public.candidate_rivals from public, anon, authenticated, pulso_collector, pulso_classifier;
grant all on table public.pulso_staff to service_role;
grant all on table public.candidate_rivals to service_role;
grant select on table public.pulso_staff to authenticated;
grant select, insert, update, delete on table public.candidate_rivals to authenticated;

drop policy if exists pulso_staff_read_own on public.pulso_staff;
create policy pulso_staff_read_own on public.pulso_staff
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists candidate_rivals_member_select on public.candidate_rivals;
create policy candidate_rivals_member_select on public.candidate_rivals
  for select to authenticated
  using (
    exists (
      select 1 from public.candidate_members m
      where m.candidate_id = candidate_rivals.candidate_id
        and m.user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.pulso_staff s
      where s.user_id = (select auth.uid())
    )
  );

drop policy if exists candidate_rivals_staff_insert on public.candidate_rivals;
create policy candidate_rivals_staff_insert on public.candidate_rivals
  for insert to authenticated
  with check (
    exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid()))
  );

drop policy if exists candidate_rivals_staff_update on public.candidate_rivals;
create policy candidate_rivals_staff_update on public.candidate_rivals
  for update to authenticated
  using (
    exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid()))
  );

drop policy if exists candidate_rivals_staff_delete on public.candidate_rivals;
create policy candidate_rivals_staff_delete on public.candidate_rivals
  for delete to authenticated
  using (
    exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid()))
  );

drop policy if exists candidates_staff_read on public.candidates;
create policy candidates_staff_read on public.candidates
  for select to authenticated
  using (
    exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid()))
  );

drop policy if exists candidates_rival_read on public.candidates;
create policy candidates_rival_read on public.candidates
  for select to authenticated
  using (
    exists (
      select 1
      from public.candidate_rivals r
      join public.candidate_members m
        on m.candidate_id = r.candidate_id
       and m.user_id = (select auth.uid())
      where r.rival_id = candidates.id
    )
  );

drop policy if exists topics_rival_read on public.topics;
create policy topics_rival_read on public.topics
  for select to authenticated
  using (
    exists (
      select 1
      from public.candidate_rivals r
      join public.candidate_members m
        on m.candidate_id = r.candidate_id
       and m.user_id = (select auth.uid())
      where r.rival_id = topics.candidate_id
    )
  );

drop policy if exists mentions_rival_read on public.mentions;
create policy mentions_rival_read on public.mentions
  for select to authenticated
  using (
    exists (
      select 1
      from public.candidate_rivals r
      join public.candidate_members m
        on m.candidate_id = r.candidate_id
       and m.user_id = (select auth.uid())
      where r.rival_id = mentions.candidate_id
        and (
          r.level in ('comparativo', 'completo')
          or (
            r.level = 'radar'
            and mentions.source in ('rss_media', 'google_news', 'google_alerts')
          )
        )
    )
  );

-- Tablas que existen en pulso-demo; si faltaran en un entorno de prueba, se omiten.
do $policies$
begin
  if to_regclass('public.meta_ads') is not null then
    execute 'drop policy if exists meta_ads_rival_read on public.meta_ads';
    execute $p$
      create policy meta_ads_rival_read on public.meta_ads
        for select to authenticated
        using (
          exists (
            select 1
            from public.candidate_rivals r
            join public.candidate_members m
              on m.candidate_id = r.candidate_id
             and m.user_id = (select auth.uid())
            where r.rival_id = meta_ads.candidate_id
              and r.level in ('comparativo', 'completo')
          )
        )
    $p$;
  end if;

  if to_regclass('public.meta_ad_classifications') is not null then
    execute 'drop policy if exists meta_ad_classifications_rival_read on public.meta_ad_classifications';
    execute $p$
      create policy meta_ad_classifications_rival_read on public.meta_ad_classifications
        for select to authenticated
        using (
          exists (
            select 1
            from public.candidate_rivals r
            join public.candidate_members m
              on m.candidate_id = r.candidate_id
             and m.user_id = (select auth.uid())
            where r.rival_id = meta_ad_classifications.candidate_id
              and r.level in ('comparativo', 'completo')
          )
        )
    $p$;
  end if;

  if to_regclass('public.ai_answers') is not null then
    execute 'drop policy if exists ai_answers_rival_read on public.ai_answers';
    execute $p$
      create policy ai_answers_rival_read on public.ai_answers
        for select to authenticated
        using (
          exists (
            select 1
            from public.candidate_rivals r
            join public.candidate_members m
              on m.candidate_id = r.candidate_id
             and m.user_id = (select auth.uid())
            where r.rival_id = ai_answers.candidate_id
              and r.level = 'completo'
          )
        )
    $p$;
  end if;

  if to_regclass('public.suspicious_accounts') is not null then
    execute 'drop policy if exists suspicious_accounts_rival_read on public.suspicious_accounts';
    execute $p$
      create policy suspicious_accounts_rival_read on public.suspicious_accounts
        for select to authenticated
        using (
          exists (
            select 1
            from public.candidate_rivals r
            join public.candidate_members m
              on m.candidate_id = r.candidate_id
             and m.user_id = (select auth.uid())
            where r.rival_id = suspicious_accounts.candidate_id
              and r.level = 'completo'
          )
        )
    $p$;
  end if;
end
$policies$;

commit;
