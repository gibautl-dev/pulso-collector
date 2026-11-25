# Alertas de contradicciones

**Estado:** el código está en `feat/inconsistency-alerts`. La migración `deploy/inconsistency_alerts.sql` **no está aplicada** y el paso del cron está **apagado** (`PULSO_INCONSISTENCY_ENABLED=false`).

## Qué hace
1. **Junta las declaraciones** de cada candidato (`pulso/inconsistency/statements.py`):
   - *own*: publicaciones de sus cuentas o dominios (`account_relation = own`);
   - *attributed*: frases que los medios le atribuyen, como «Kicillof: "…"» o «Sánchez afirmó que…»;
   - *flag*: notas de terceros que señalan una contradicción («da marcha atrás», «se desdijo», «anunció como medida estrella»…);
   - *context*: notas previas sobre el mismo tema.
   Las de terceros quedan separadas de lo que dijo el candidato.
2. **Arma pares** (`pairs.py`): cada frase nueva (últimas 48 h) se compara con frases anteriores del mismo tema, separadas por al menos 2 días y con palabras distintivas en común. Las frases que solo repiten un mensaje no se mandan.
3. **Juicio del modelo** (`llm.py`): el modelo recibe piezas `s1…sN`, sin ids ni URLs, y devuelve un JSON estricto con veredicto, severidad, tema y refs. Usa el mismo proveedor de IA y los mismos topes que el resumen diario.
4. **Validación** (`grounding.py`): se descarta todo hallazgo que:
   - no cite refs conocidas;
   - cambie el par;
   - traiga números que no estén en las fuentes;
   - sugiera acciones prohibidas (bots, cuentas falsas, respuestas en masa).
   `tension` siempre queda con severidad baja.
5. **Alerta**: las dos citas salen **de los datos**, nunca del texto del modelo. La alerta queda en estado `new` hasta que una persona la revisa en `/c/<slug>/contradicciones`. Nada se publica.
6. **Datos insuficientes**: con menos de 10 declaraciones en 5 días distintos del último mes, la revisión queda con `reason` y la web lo dice. Los señalamientos de terceros se siguen revisando igual.

## Variables (`PULSO_INCONSISTENCY_*`)
| Variable | Default |
|---|---|
| `ENABLED` | `false` |
| `DRY_RUN` | `false` |
| `TIMEOUT_SECONDS` | 180 |
| `EVERY_HOURS` | 6 |
| `LOOKBACK_DAYS` | 90 |
| `NEW_WINDOW_HOURS` | 48 |
| `MIN_STATEMENTS` | 10 |
| `MIN_DAYS` | 5 |
| `MIN_GAP_DAYS` | 2 |
| `MAX_PAIRS` | 12 |
| `MAX_FLAGS` | 6 |
| `MAX_COST_PER_CALL` | 0.02 |
| `MAX_COST_PER_RUN` | 0.06 |

También usa `CLASSIFIER_DATABASE_URL` (rol `pulso_classifier`) y `LLM_API_KEY` / `LLM_MODEL`, iguales a los del resumen diario.

## Costo
- **EST:** unos USD 0,0015 por llamada (≈2,8k tokens de entrada y ≈2k de salida con gpt-6-luna).
- **CALC:** 3 candidatos × 4 revisiones por día × 30 días = 360 llamadas, o sea como máximo USD 0,55 por mes. Solo se llama al modelo cuando hay pares o señalamientos nuevos sin juzgar (`judged_keys`), así que en la práctica es menos.

## Permisos (`deploy/inconsistency_alerts.sql`)
- RLS forzada.
- `pulso_classifier`: inserta alertas (no las cambia ni las borra) y escribe revisiones.
- `authenticated`: lee las alertas de sus candidatos (`candidate_members`) y solo puede actualizar `status*`. De las revisiones lee solo `status`, `reason`, `stats` y las fechas; nunca el costo ni los pares juzgados.
- anon y el recolector no tienen acceso. Probado en `web/tests/inconsistency-permissions.sql.test.ts` (PGlite).

## Activar (requiere aprobación)
1. Aplicar `deploy/inconsistency_alerts.sql` en Supabase.
2. En el cron de Render: `PULSO_INCONSISTENCY_ENABLED=true`. Para probar primero sin escribir, usar `PULSO_INCONSISTENCY_DRY_RUN=true`.
3. Correr una vez a mano: `python -m pulso.inconsistency --dry-run --candidate axel-kicillof`.
