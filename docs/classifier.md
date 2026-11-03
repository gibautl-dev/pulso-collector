# Clasificador automático (IA)

`python -m pulso.ai.classify --candidate axel-kicillof [--dry-run] [--max N]`

Toma menciones sin clasificar (`tone is null`) del candidato, en tandas, y llama a un
modelo compatible con la API de Chat Completions de OpenAI con salida estructurada
(`json_schema` estricto). Valida cada ítem (valores permitidos, refs de la tanda, tema
existente), mapea la etiqueta de tema a `topic_id` y escribe solo columnas de
clasificación, con `classification_model` (el que devuelve la API) y
`classification_prompt_version` (`auto-v1-2026-11-03`). Nunca pisa una mención ya
clasificada (`where tone is null and classified_at is null`). Ítems inválidos o
faltantes quedan pendientes para la próxima corrida.

## En el cron

`pulso.deploy_run` corre el recolector y después, si `PULSO_CLASSIFY_ENABLED=true`,
el clasificador como subproceso aparte con su propio timeout. El código de salida
del cron es siempre el del recolector: la IA nunca hace fallar la recolección.
Cada subproceso recibe solo sus credenciales (el recolector no ve `LLM_API_KEY`;
el clasificador no ve `DATABASE_URL`/`PGPASSWORD`). Se omite si el recolector
terminó por timeout o cancelación.

## Variables

| Variable | Default | Uso |
| --- | --- | --- |
| `PULSO_CLASSIFY_ENABLED` | `false` | Activa el paso en el cron |
| `PULSO_CLASSIFY_DRY_RUN` | `false` | Llama al modelo y loguea, sin escribir |
| `PULSO_CLASSIFY_MAX_PER_RUN` | `30` | Tope de menciones por corrida (1..500) |
| `PULSO_CLASSIFY_BATCH_SIZE` | `10` | Menciones por llamada (1..25) |
| `PULSO_CLASSIFY_TIMEOUT_SECONDS` | `240` | Timeout total del subproceso |
| `LLM_API_KEY` | (secreto) | Clave del proveedor |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | Endpoint compatible (https) |
| `LLM_MODEL` | `gpt-6-luna` | Modelo |
| `LLM_REASONING_EFFORT` | `none` | Vacío para no enviarlo |
| `LLM_TIMEOUT_SECONDS` | `45` | Timeout por request |
| `LLM_MAX_RETRIES` | `2` | Reintentos ante 429/5xx/timeout (respeta Retry-After, máx 30 s) |
| `CLASSIFIER_DATABASE_URL` | (secreto) | Pooler con usuario `pulso_classifier.<ref>`; rechaza `pulso_collector`/admin |
| `CLASSIFIER_PGPASSWORD` | (secreto) | Contraseña del rol `pulso_classifier` |

Rol de base: `deploy/classifier_permissions.sql` (SELECT por columnas, UPDATE solo
en columnas de clasificación, RLS, NOBYPASSRLS, NOINHERIT).

Fallback barato: Gemini por su endpoint compatible con OpenAI,
`LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`,
`LLM_MODEL=gemini-3.1-flash-lite`. Validar primero con `PULSO_CLASSIFY_DRY_RUN=true`
(parámetros como `reasoning_effort` pueden diferir; dejarlo vacío si da 400).

## Evaluación

`eval/labeled_mentions.jsonl`: 97 menciones clasificadas a mano (las 13 usadas como
few-shot en `pulso/ai/fewshot.json` están excluidas).

```bash
python scripts/eval_classifier.py --baseline                 # sin clave
python scripts/eval_classifier.py --predictions out.jsonl    # sin clave
LLM_API_KEY=... python scripts/eval_classifier.py            # llama al modelo, no toca la base
```
