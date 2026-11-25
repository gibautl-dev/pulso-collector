# Resumen del día (daily brief) — feat/daily-brief

Estado: migración aplicada en pulso-demo (2026-11-25); job activado en el cron pulso-rss.

## Qué hace
- Una vez por día, por candidato (incluye rivales descubiertos en DB), genera un resumen
  del día anterior (hora local del candidato): Qué cambió / Por qué importa / Qué hacer.
- Los números se calculan en Python (`pulso/daily_brief/metrics.py`); el modelo solo redacta
  texto, cita menciones por referencia (m1..mN → UUID, nunca se envían ids reales) y elige
  el "dato del día" entre opciones calculadas.
- Validación posterior (`grounding.py`): se descarta todo punto sin mención citada válida
  o con un número que no esté en las métricas o en las piezas citadas.
- Comparación "no fiable" (alta de fuentes, rampas de volumen): no se muestran variaciones.
- Datos insuficientes (<15 menciones de terceros o <5 clasificadas): no hay llamada al
  modelo y el resumen lo dice.
- Las acciones son sugerencias para revisión humana (`coordinator.human_review_required=true`,
  `auto_publish=false`). Nada se publica.

## Cómo corre
Paso post-colector en `pulso/deploy_run.py` (mismo cron, sin servicio nuevo), con timeout propio.
Usa `CLASSIFIER_DATABASE_URL` (rol pulso_classifier) y `LLM_API_KEY`.

| Variable | Default | |
|---|---|---|
| PULSO_DAILY_BRIEF_ENABLED | false | activar el paso |
| PULSO_DAILY_BRIEF_HOUR | 8 | hora local desde la que se genera el del día anterior |
| PULSO_DAILY_BRIEF_MAX_COST_USD | 0.05 | tope por resumen (estimado antes de llamar) |
| PULSO_DAILY_BRIEF_MAX_RUN_COST_USD | 0.20 | tope por corrida |
| PULSO_DAILY_BRIEF_MIN_MENTIONS | 15 | umbral de datos suficientes |
| PULSO_DAILY_BRIEF_MAX_PIECES | 36 | menciones enviadas al modelo |
| PULSO_DAILY_BRIEF_MODEL | LLM_MODEL / gpt-6-luna | |
| PULSO_DAILY_BRIEF_TIMEOUT_SECONDS | 180 | |
| PULSO_DAILY_BRIEF_DRY_RUN | false | calcula sin escribir |

CLI: `python -m pulso.daily_brief --candidate axel-kicillof [--date YYYY-MM-DD] [--dry-run] [--force]`
o sin DB: `--pack pack.json --out out.json`.

## Migración (aplicada)
`deploy/daily_brief.sql`: tabla `public.daily_briefs`, RLS forzado; pulso_classifier
select/insert/update; authenticated solo lectura vía `candidate_members`; anon nada.

## Costo
- EST por resumen: ~USD 0.0018 (~6.5k tokens entrada / ~2.2k salida, gpt-6-luna $0.10/$0.50 por M).
- CALC mensual: 3 candidatos × 30 días ≈ 90 resúmenes ≈ USD 0.16/mes (≈0.19 con el estimado previo de 0.0021).
- Días con datos insuficientes: USD 0.
