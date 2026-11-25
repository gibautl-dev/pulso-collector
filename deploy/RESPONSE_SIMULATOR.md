# Simulador de respuesta

Sección **Simulador de respuesta** (`/c/<slug>/simulador`), para todos los candidatos.
El equipo escribe un borrador de declaración y Pulso estima cómo caería en cada público
y frente al rival, apoyándose en las menciones recolectadas de los últimos 14 días.

Es una herramienta privada de redacción: **no publica nada**, no responde a nadie y cada
simulación la ve solo quien la hizo.

## Cómo funciona

1. **Contexto con datos reales** (`web/src/lib/response-simulator.ts`, sin I/O):
   - Temas del borrador: los temas del candidato que más se parecen al texto (proporción de
     menciones del tema que comparten palabras con el borrador + coincidencia con la etiqueta).
     Para cada uno: menciones, balance firmado (−100 a +100), negativas y a favor.
   - Públicos derivados de los datos (mínimo 3 menciones en la ventana):
     - **Simpatizantes**: tono a favor del candidato.
     - **Críticos**: crítica, acusación o insulto al candidato.
     - **Medios**: Google News / RSS / Alertas.
     - **Campo rival**: menciones del rival asignado de mayor nivel (si hay rival).
   - Hasta 8 menciones por público, rankeadas por parecido con el borrador, tema, recencia y
     relevancia, con referencia corta (M1, M2…). Cuentas propias no cuentan como público.
2. **Modelo** (`response-simulator-llm.ts`, solo servidor): mismo proveedor que el resto de la
   web (`LLM_API_KEY`/`OPENAI_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`; opcional
   `PULSO_SIMULATOR_MODEL`, `LLM_REASONING_EFFORT`). JSON schema estricto, públicos
   limitados a los disponibles, `max_completion_tokens` 2000, timeout 60 s. Los datos y el
   borrador van marcados como no confiables. El prompt prohíbe comparar volúmenes con el rival
   (se miden con períodos y fuentes distintas).
3. **Control de la salida** (`groundSimulation`): se descartan públicos desconocidos o
   repetidos, contraargumentos sin referencia válida y frases con cifras que no están en los
   datos ni en el borrador. El riesgo se acota a 0–100 (bajo < 35 ≤ medio < 65 ≤ alto).
4. **Salida por público**: recepción probable (favorable / mixta / desfavorable), riesgos,
   contraargumentos probables con una mención real de ejemplo ("Ver original"), ajustes
   sugeridos; más un riesgo general, una línea de resumen y una versión con los ajustes.
   La UI la marca discretamente como "Estimación con IA" (ⓘ).

## Cupos y costos

`start_response_simulation()` (SQL, security definer) corre **antes** de llamar al modelo:

| Tope | Default | Dónde |
|---|---|---|
| Por simulación (estimación previa) | USD 0,01 | `max_request_usd` |
| Presupuesto diario de todo Pulso (día de Buenos Aires) | USD 1,00 | `daily_budget_usd` |
| Ráfaga por usuario | 5 cada 10 min | `per_user_window`, `window_minutes` |
| Diario por usuario | 30 | `per_user_daily` |

- Reserva el costo máximo estimado (entrada estimada + 2000 tokens de salida, piso 1/10 del
  tope). El presupuesto suma `greatest(reservado, costo real)`: nadie puede abaratar una
  simulación después de reservarla. Un `pg_advisory_xact_lock` evita que dos pedidos pasen juntos.
- Si el costo real supera el tope por pedido, no se muestra el resultado (se anota el costo).
- `enabled = false` en `response_simulator_settings` pausa el simulador.

Costo por simulación (gpt-6-luna, USD 0,10 / 0,50 por 1M tokens): prompt real de ~14–16 mil
caracteres (≈ 4,0–4,6 mil tokens) y salida ≈ 1,1 mil tokens → **≈ USD 0,001 EST** (máximo
reservado ≈ USD 0,0015).

## Migración (aplicada en pulso-demo el 2026-11-25)

`deploy/response_simulator.sql` — requiere OK antes de aplicarla en pulso-demo. Crea:

- `response_simulations` (RLS: el autor lee las suyas mientras tenga acceso al candidato;
  la app no inserta/actualiza/borra directo; anon y los roles del cron sin acceso).
- `response_simulator_settings` (una fila; todos los usuarios con sesión la leen; solo staff la cambia).
- `start_response_simulation(uuid, text, numeric)` y `finish_response_simulation(...)`,
  `execute` solo para `authenticated`.

Sin la migración la sección se ve, pero al simular avisa que está pausada. Costo de aplicarla: USD 0.

## Pruebas

- `web/tests/response-simulator.test.ts`: contexto, prompt, control de salida, cupos, repo en
  memoria y llamada al modelo con fetch simulado.
- `web/tests/response-simulator-permissions.sql.test.ts`: la migración en PGlite (RLS, cupos,
  presupuesto, finish una sola vez, staff cambia topes, pausa).
- Capturas: `web/scripts/screenshots-39.mjs` (modo fixture).
