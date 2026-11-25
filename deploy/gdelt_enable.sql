-- Aplicado en pulso-demo el 2026-11-25 (hora de Argentina). Habilita GDELT DOC 2.0 para los candidatos actuales.
-- source_catalog ya tiene la fila 'gdelt' (intervalo 1200 s, apagada por defecto).
-- NO cambia schema, roles ni políticas: pulso_collector ya puede insertar
-- menciones con source='gdelt' (FK a source_catalog) y actualizar cursores.
--
-- País del operador sourcecountry:
--   * Argentina (Kicillof, Milei): AR
--   * España (Sánchez): ES
-- El adaptador también lo infiere del perfil regional si settings viene vacío.
--
-- Atribución obligatoria al mostrar datos: citar el Proyecto GDELT y enlazar
-- https://www.gdeltproject.org/
--
-- Reversible: set enabled=false en las mismas filas.

begin;

insert into public.candidate_sources (candidate_id, source, enabled, interval_seconds, settings)
select c.id, 'gdelt', false, 1200, '{}'::jsonb
  from public.candidates c
 where c.slug in ('axel-kicillof', 'milei', 'pedro-sanchez')
on conflict (candidate_id, source) do nothing;

update public.candidate_sources cs
   set enabled = true,
       interval_seconds = greatest(cs.interval_seconds, 1200),
       settings = coalesce(cs.settings, '{}'::jsonb) || jsonb_build_object(
         'sourcecountry', case c.slug
           when 'pedro-sanchez' then 'ES'
           else 'AR'
         end
       ),
       updated_at = now()
  from public.candidates c
 where cs.candidate_id = c.id
   and c.slug in ('axel-kicillof', 'milei', 'pedro-sanchez')
   and cs.source = 'gdelt';

commit;
