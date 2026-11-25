# Panel "Gasto" (solo equipo de Active)

Ruta: `/admin/gasto` (link "Gasto" en el Panel Active). Solo `pulso_staff`.

## Qué muestra
- IA del mes en curso por función, candidato y día (hora de Buenos Aires), y lo de hoy contra el tope de cada función.
- API de X: posts leídos y pedidos por día contra el cupo (`x_daily_cap` / `max_requests_per_day`), y su costo **CALC** = posts × USD 0,005. No incluye USD 0,010 por usuario de la expansión `author_id` (el recolector no lo cuenta).
- Proyección del mes **CALC**: lo gastado + promedio de los últimos 7 días completos × días que faltan (IA + X, sin infraestructura).
- Infraestructura: solo lo leído de las APIs (Render: web y cron en plan Starter; Supabase: org en plan Free). El cron de Render se cobra por segundo y su monto **no está disponible** por API.

## Fuentes de costo
| Función | Tabla | Dato |
| --- | --- | --- |
| En la IA | ai_answers.cost | registrado |
| Equipo de acción | crisis_agent_runs.cost_usd (no crisis_briefs, que duplica) | registrado |
| Resumen del día | daily_briefs.cost_usd (status ok) | registrado |
| Contradicciones | inconsistency_scans.cost_usd (solo el último escaneo por candidato) | registrado, por debajo del real |
| Simulador | response_simulations.cost_usd | registrado |
| Preguntale a Pulso | assistant_questions.cost_usd | registrado |
| Temas a medida | custom_topic_classifications / custom_topic_summaries | registrado |
| Sugerencias de rivales | rival_suggestion_runs.cost_usd | registrado |
| Clasificador de menciones | mentions.classified_at (conteo) | **EST** USD 0,0000884 por mención (logs del cron 25/11: 18 corridas, 71 menciones, 43.737 / 3.801 tokens, gpt-6-luna) |
| Clasificación de anuncios | meta_ad_classifications (conteo) | sin dato de costo |

## Migración (PROPUESTA, sin aplicar)
`deploy/spend_panel.sql` crea solo la función `public.pulso_spend_report(p_from, p_to)`:
SECURITY DEFINER, verifica `pulso_staff` con `auth.uid()`, devuelve agregados (sin textos ni ids de usuario),
`execute` solo para `authenticated` (revocado a public/anon). No crea tablas ni cambia RLS. Costo USD 0.
Sin la función, la página muestra un aviso vacío y no rompe.

Pruebas: `tests/spend-panel-permissions.sql.test.ts` (PGlite) y `tests/spend.test.ts`.

## Tope diario de "En la IA" (deploy/ai_visibility_cap.sql)
- Aprobado por Leandro el 25/11: USD 1,00 por día **en total** (todos los candidatos), día de Buenos Aires.
- Tabla `ai_visibility_budget` (una fila). Solo `pulso_staff` la ve y la edita (formulario en /admin/gasto).
  El job (`pulso_classifier`) la lee y solo puede escribir `last_reached_on`.
- El job suma `ai_answers.cost` del día y, antes de cada pregunta, reserva el costo máximo de las últimas
  50 respuestas (o USD 0,15 si no hay historia). Si no entra, no pregunta más ese día y marca `last_reached_on`.
- La web del cliente llama `ai_visibility_cap_reached_today()` (solo un booleano) y muestra en En la IA:
  "Por hoy ya completamos las consultas a la IA. Volvé mañana…". Sin montos ni texto técnico.
- Impacto CALC con el uso actual (~USD 0,086 por respuesta; reserva actual USD 0,128 = máx. de las últimas 50): Sánchez corre primero
  (09:00 de Madrid = 05:00 de Buenos Aires), hace sus 10 preguntas (~USD 0,86) y a Kicillof (09:00 de Buenos Aires)
  no le alcanza para ninguna: 0,86 + 0,128 > 1. Para que entren los dos hace falta ~USD 1,85/día.
- Aplicada en pulso-demo el 25/11 junto con spend_panel.sql. Requiere deploy del cron (el corte vive en `pulso/ai_visibility`). Aplicar antes que `spend_panel.sql`.
