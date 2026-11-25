# Plan: crons por candidato (no aplicado)

Planificación solamente. No crear servicios, no cambiar env, no desplegar
hasta que Leandro lo apruebe. Rama: `feat/cron-parent-rivals`.

## Diseño

Dos crons, mismo repo/imagen que `pulso-rss` (crn-dbl4916i0phs738eg1kg):

| Cron | `PULSO_CANDIDATES` | Recolecta también | Schedule (UTC) | Jobs de post (solo slugs del env) |
| --- | --- | --- | --- | --- |
| pulso-rss (o pulso-rss-kicillof) | `axel-kicillof` | milei (rival en `candidate_rivals` con medios/RSS) | `*/20 * * * *` (igual que hoy) | Google Ads diario + crisis (habilitado en Kicillof) + classify/suspicious/ai_visibility/meta |
| pulso-rss-sanchez | `pedro-sanchez` | ninguno hoy | `10 * * * *` (horario; min 10 para no coincidir con :00/:20/:40) | classify/suspicious/ai_visibility; Google Ads `atc_disabled`; crisis apagado en código para Sánchez |

Sánchez es demo: menos frecuente (1/h) alcanza y sigue en el piso de USD 1/mes. Si se deja cada 20 min también queda en ese piso.

**Selección de candidatos (cambio de código en esta rama):**
`discover_collectable_slugs` ya no usa todos los candidatos con medios en la DB.
Usa los slugs de `PULSO_CANDIDATES` más *solo* rivales de esos padres
(`candidate_rivals.candidate_id` = padre, `rival_id` = rival) con fuentes
media/RSS encendidas. Así Milei entra solo en el cron de Kicillof.
Google Ads y crisis ya corrían solo para slugs del env (`cron_post_steps_skipped`
/ `db_rival_media_only`): un cron por padre los deja en un solo lugar.

Sin este cambio, un cron de solo Sánchez también recolectaría Kicillof y Milei.

## Costo (starter USD 0.00016/min, mínimo USD 1 por cron/mes)

Muestra de logs del cron actual, 25 Nov 2026 (ART, UTC−3), n=17 colectas /
n=16 wall (03:00–09:44 UTC y corridas 00:00–01:11 ART). Tiempos de referencia
citados: Kicillof ~192 s, Sánchez ~130 s, Milei ~141 s (colecta 01:00 ART).

| | Fuente | Min/run | Runs/30d | Compute | Facturado |
| --- | --- | --- | --- | --- | --- |
| Actual (1 cron, */20) | CALC media wall 415.9 s = 6.93 min (min 246 s, máx 698 s c/ZIP Google Ads) | 6.93 | 2160 | USD 2.40 | USD 2.40 |
| Actual, corrida “ocupada” | EST colecta citada + post | ~10.2 | 2160 | USD 3.52 | USD 3.52 |
| Kicillof+Milei, */20 | EST media (colecta media + post + crisis ~44 s) | ~5.15 | 2160 | USD 1.78 | USD 1.78 |
| Kicillof+Milei ocupado | EST 192+141 + post + crisis | ~7.40 | 2160 | USD 2.56 | USD 2.56 |
| Sánchez, 1/h | EST media ~2.18 min (ocupado ~3.0) | 2.18 | 720 | USD 0.25 | USD 1.00 (piso) |
| Sánchez, */20 | EST media | 2.18 | 2160 | USD 0.75 | USD 1.00 (piso) |

Comparación recomendada (K */20 + S 1/h, medias): USD 1.78 + 1.00 = **USD 2.78** vs actual CALC **USD 2.40** (delta **+USD 0.38**, casi todo el piso del segundo cron). Con tiempos “ocupados”: USD 2.56 + 1.00 = 3.56 vs EST 3.52. El ZIP diario de Google Ads (~174 s, una vez al día en el cron de Kicillof) suma ~USD 0.01/mes (CALC). Timeout 1100 s sigue holgado.

## Env (solo nombres)

Render MCP no lista variables ni administra env groups.
`update_environment_variables` exige el valor: no puede copiar secretos
desconocidos. Ningún secreto se puede cargar por MCP sin que Leandro lo
entregue. Flags no secretos sí podrían escribirse si se conoce el literal,
pero conviene copiar del cron actual o usar un env group.

**Cambia por cron (no va en el grupo compartido):** `PULSO_CANDIDATES`.
No definir `PULSO_CANDIDATE` si se usa la lista.

**Copiar igual a ambos** (nombres; el MCP no confirmó el set live). Secretos
que el código usa en los pasos que hoy corren: `DATABASE_URL`, `PGPASSWORD`,
`CLASSIFIER_DATABASE_URL`, `CLASSIFIER_PGPASSWORD`, `LLM_API_KEY`,
`META_ADS_ACCESS_TOKEN`, y si ya están en el cron actual `YOUTUBE_API_KEY`
y `X_BEARER_TOKEN`. `OPENAI_API_KEY` solo si ya está (fallback de
`LLM_API_KEY`; no hace falta duplicar).

Flags / no secretos usados por esos pasos, copiar si existen hoy:
`PULSO_DRY_RUN`, `PULSO_URL_SECURITY_MODE`, `PULSO_URL_ALLOWED_HOSTS`,
`PULSO_HTTP_TRUST_ENV`, `PULSO_RUN_TIMEOUT_SECONDS`,
`PULSO_CLASSIFY_ENABLED`, `PULSO_CLASSIFY_DRY_RUN`, `PULSO_CLASSIFY_MAX_PER_RUN`,
`PULSO_CLASSIFY_TIMEOUT_SECONDS`, `LLM_MODEL`, `LLM_BASE_URL`,
`LLM_TIMEOUT_SECONDS`, `LLM_MAX_RETRIES`, `LLM_REASONING_EFFORT`,
`PULSO_SUSPICIOUS_ENABLED`, `PULSO_SUSPICIOUS_TIMEOUT_SECONDS`,
`PULSO_AI_VISIBILITY_ENABLED`, `PULSO_AI_VISIBILITY_DRY_RUN`,
`PULSO_AI_VISIBILITY_MODEL`, `PULSO_AI_VISIBILITY_TIMEOUT_SECONDS`,
`PULSO_AI_VISIBILITY_HOUR`, `PULSO_AI_VISIBILITY_WEB_SEARCH`,
`PULSO_META_ADS_ENABLED`, `PULSO_META_ADS_DRY_RUN`,
`PULSO_META_ADS_TIMEOUT_SECONDS`, `PULSO_META_ADS_HTTP_TIMEOUT`,
`PULSO_META_ADS_RUN_HOUR`, `PULSO_META_ADS_API_VERSION`,
`PULSO_META_ADS_CLASSIFY_ENABLED`, `PULSO_META_ADS_CLASSIFY_DRY_RUN`,
`PULSO_META_ADS_CLASSIFY_TIMEOUT_SECONDS`,
`PULSO_GOOGLE_ADS_ENABLED`, `PULSO_GOOGLE_ADS_DRY_RUN`,
`PULSO_GOOGLE_ADS_TIMEOUT_SECONDS`,
`PULSO_CRISIS_AGENT_ENABLED`, `PULSO_CRISIS_AGENT_DRY_RUN`,
`PULSO_CRISIS_AGENT_MAX_BRIEFS`, `PULSO_CRISIS_AGENT_MAX_COST_USD`,
`PULSO_CRISIS_AGENT_TIMEOUT_SECONDS`.
`PGOPTIONS` solo si está sobreescrito en el servicio (la imagen ya lo define).

No hace falta copiar al cron, salvo que ya estén y se usen: `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_URL`, `SERPAPI_KEY`, `META_ACCESS_TOKEN`, `META_IG_USER_ID`,
`GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT`, `COLLECTOR_DATABASE_URL`.

**Env groups:** sí. Leandro puede crear un grupo en el Dashboard, cargar ahí
los secretos y flags compartidos, y vincularlo a todos los crons. El
`PULSO_CANDIDATES` de cada servicio pisa el grupo. El MCP no crea ni vincula
grupos. Un cambio en el grupo puede redeployar servicios con autodeploy
encendido; estos crons tienen `autoDeploy` off — confirmar en el panel si
una edición del grupo igual dispara deploy.

## Solapes y locks

- Hoy la colecta usa `pg_try_advisory_lock(hashtextextended(candidate_id,0))`;
  si está tomado, salta con `candidate_locked`. El clasificador usa la misma clave.
- Con el cambio de discovery no debería haber el mismo candidato en dos crons.
  Si por error `PULSO_CANDIDATES` se duplica, el segundo salta el lock (no escribe a la vez).
- Google Ads (`already_ran_today`) y crisis quedan solo en el cron de Kicillof.
- Dos crons en paralelo: más conexiones al pool y RSS/Google News / OpenAI a la vez
  (hoy van en serie). El schedule de Sánchez en minuto 10 reduce el solape de arranque.
  El clasificador limita ~30 menciones/run; crisis solo en un cron.
- Si una corrida se pasa de 20 min, Render puede lanzar otra instancia del mismo
  cron; el advisory lock cubre ese caso. El cron partido debería ser más corto
  que el actual (máx observado 698 s).

