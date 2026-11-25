# Altas pendientes: duplicados, aprobar y borrar

**Aplicada** en pulso-demo el 2026-11-24 (hora de Argentina), después de borrar 3 duplicados de Milei y conservar `0ab49778-abe4-4a9a-b95d-45194898eb48`.

## Qué creó

- Estados `aprobado` y `borrado` además de `pendiente_de_alta`.
- Columnas `approved_at` y `approved_by` (quién y cuándo). Aprobar deja el pedido listo para recolectar; **no enciende** el cron ni crea la fila en `public.candidates`.
- `Borrar` pasa a `borrado` (no borra en duro). Esas filas salen de la lista y no bloquean un alta nueva.
- Función `normalize_pending_candidate_name` e índice único por candidato + nombre normalizado (minúsculas, sin acentos), solo sobre pendientes y aprobados.

## Duplicados que se limpiaron antes de aplicar

En pulso-demo, el 24 de noviembre de 2026 (hora de Argentina), quedaron cuatro filas de “Milei” para Axel Kicillof por envíos repetidos sin feedback en el formulario. Se borraron las tres primeras y se conservó la última, luego se aplicó el índice único. Ids involucrados:

- `9fc43420-8ff4-4ead-8876-917d6f12966d` — Milei, sin arena, 22:25:54 America/Buenos_Aires
- `3ec05365-ad49-4dbd-a173-8d11d1ecbc80` — Milei, sin arena, 22:25:57 America/Buenos_Aires
- `de8296d3-c2f8-4389-874d-ba8c978842d6` — Milei, Argentina, 22:26:00 America/Buenos_Aires
- `0ab49778-abe4-4a9a-b95d-45194898eb48` — Milei, Argentina, 22:26:02 America/Buenos_Aires

Todas: `pendiente_de_alta`, nivel Comparativo, para `axel-kicillof`, source `manual`.

## Costo

USD 0 al aplicar el SQL. No toca el collector ni variables de entorno.
