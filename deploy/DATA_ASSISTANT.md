# Asistente de datos — "Preguntale a Pulso" (feat/data-assistant)

Chat sobre los datos del candidato (menciones, temas, tono, resúmenes diarios,
anuncios y rivales). Ejemplo: *¿qué dijo Kicillof sobre la economía esta semana?*
Funciona para cualquier candidato (Kicillof, Milei, Sánchez…).

## Cómo funciona

1. La pregunta va a una **server action** (`app/c/[slug]/asistente/actions.ts`).
   `loadCandidate` valida la sesión y da 404 si el usuario no es miembro.
2. El modelo (servidor, `gpt-6-luna` por defecto) **solo elige herramientas** con
   parámetros acotados (enums, 1–30 días, términos de texto limpiados). No ve la
   base ni escribe SQL. Herramientas (`web/src/lib/assistant/tools.ts`):
   `contar_menciones`, `buscar_menciones`, `temas`, `resumen_diario`,
   `anuncios`, `comparar_rivales`.
3. Las herramientas corren en código sobre datos leídos con el **repo de la
   sesión** (cliente Supabase del usuario → RLS). Rivales que el usuario no puede
   ver no existen para el asistente.
4. Reglas de cobertura iguales al tablero/Rivales: variación solo con fuentes
   activas en los dos períodos; entre candidatos, solo ventana común (período y
   fuentes de ambos); aviso si una fuente empezó dentro del período.
5. El modelo redacta con citas `[m1]`. El servidor:
   - borra citas que no devolvió `buscar_menciones`;
   - busca cifras que no estén en los resultados; si las hay pide **una**
     corrección y, si insiste, muestra solo los datos calculados;
   - las tarjetas de datos y las fuentes de la UI salen de código, no del texto.
6. Si los datos no alcanzan, responde que no tiene el dato (`sin_datos`).

## Topes

| Tope | Valor | Dónde |
| --- | --- | --- |
| Costo por pregunta | USD 0,01 (corte antes de cada llamada, calibrado con el uso real) | `LIMITS` + `PULSO_ASSISTANT_MAX_COST_USD` (solo baja) |
| Costo por día (todos) | USD 1 | `LIMITS`, trigger SQL, `PULSO_ASSISTANT_MAX_DAILY_COST_USD` (solo baja) |
| Preguntas por usuario | 20/hora, 60/día | `LIMITS` + trigger SQL |
| Preguntas por día (todos) | 400 | `LIMITS` + trigger SQL |
| Llamadas al modelo | ≤ 5 por pregunta (3 rondas de herramientas, respuesta, 1 corrección) | `LIMITS` |
| Salida | 700 tokens por llamada; resultados de herramientas ≤ 6.000 caracteres | `LIMITS` |

Filas sin costo (pendientes o con error) cuentan como USD 0,01 para el tope diario.

## Costo (gpt-6-luna: USD 0,10 / 1M entrada, 0,50 / 1M salida)

- **EST por pregunta: ~USD 0,001** (2 llamadas: ~2.600 + ~4.300 tokens de
  entrada y ~470 de salida). Con una ronda extra o corrección: ~USD 0,0016.
- **CALC mensual**: 5 usuarios × 10 preguntas/día × 30 días = 1.500 preguntas ≈
  **USD 1,50/mes**. Techo duro: USD 1/día ⇒ máx. USD 30/mes.

## Migración (aplicada en pulso-demo el 2026-11-25)

`deploy/data_assistant.sql` — tabla `assistant_questions`, trigger de cupos,
función `assistant_quota()`. Solo `authenticated` vía `candidate_members`; cada
usuario ve solo sus preguntas; sin borrado; `anon` y roles del recolector sin
acceso. Costo de aplicar: USD 0. Probada en PGlite
(`web/tests/data-assistant-permissions.sql.test.ts`).

Hasta aplicarla, el asistente queda **oculto** (sin botón, sin ítem de menú y sin
"Preguntale a Pulso sobre esto" en los ⓘ). Además necesita `LLM_API_KEY` (o
`OPENAI_API_KEY`) en `pulso-web`; sin clave muestra "todavía no está disponible".

## UI

- Botón flotante "✦ Preguntale a Pulso" en todas las páginas del candidato →
  panel lateral (conserva la conversación al cerrar).
- Página `/c/[slug]/asistente` (ítem de menú).
- En los ⓘ de tarjetas y KPIs: "✦ Preguntale a Pulso sobre esto" abre el panel
  con la pregunta y el contexto de esa tarjeta.
- Sugerencias según la página; preguntas de seguimiento después de cada respuesta.
- Respuesta: texto con citas numeradas, tarjetas de datos, fuentes ("Ver
  original" / "Ver en Pulso") y nota de cobertura cuando aplica.

## Ejemplos y capturas

Sin clave del modelo en la máquina de trabajo, los ejemplos de
`screens/40-*` tienen **texto escrito a mano** sobre cifras y menciones reales
calculadas por las herramientas (exportación de solo lectura del 25/11 11:26,
hora de Argentina) y pasan los mismos controles de citas y cifras
(`web/tests/assistant-examples.gen.test.ts`, no corre en `npm test`).
