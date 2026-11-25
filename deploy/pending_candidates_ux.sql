-- UX de altas pendientes: evita duplicados, permite aprobar o borrar, registra quién y cuándo.
-- ESTE ARCHIVO NO SE EJECUTÓ. No aplicarlo hasta que Leandro lo apruebe.
-- No aplicar todavía: en pulso-demo hay filas duplicadas de "Milei" para Kicillof
-- que harían fallar el índice único. Hay que limpiarlas antes, en un paso aparte.
-- No contiene secretos. No cambia roles de collector/classifier. No invita usuarios.
-- No enciende recolección: un 'aprobado' queda listo, pero el cron no lo mide
-- hasta que exista en public.candidates.
--
-- Costo de aplicar el SQL: USD 0.

begin;

-- Quién aprobó y cuándo. Borrar es un estado (no un DELETE físico).
alter table public.pending_candidates
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id);

alter table public.pending_candidates
  drop constraint if exists pending_candidates_status_check;
alter table public.pending_candidates
  add constraint pending_candidates_status_check
  check (status in ('pendiente_de_alta', 'aprobado', 'borrado'));

create or replace function public.normalize_pending_candidate_name(txt text)
returns text
language sql
immutable
parallel safe
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        lower(normalize(coalesce(txt, ''), nfd)),
        U&'[\0300-\036F]',
        '',
        'g'
      ),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  );
$$;

comment on function public.normalize_pending_candidate_name(text) is
  'Nombre comparable: minúsculas, sin acentos ni signos, espacios colapsados.';

-- Un mismo nombre (sin importar mayúsculas o tildes) no puede pedirse dos veces
-- para el mismo candidato mientras siga pendiente o aprobado.
create unique index if not exists pending_candidates_unique_name_per_candidate
  on public.pending_candidates (
    requested_for_candidate_id,
    public.normalize_pending_candidate_name(name)
  )
  where status in ('pendiente_de_alta', 'aprobado');

grant select, insert, update on table public.pending_candidates to authenticated;

drop policy if exists pending_candidates_staff_update on public.pending_candidates;
create policy pending_candidates_staff_update on public.pending_candidates
  for update to authenticated
  using (exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.pulso_staff s where s.user_id = (select auth.uid())));

commit;
