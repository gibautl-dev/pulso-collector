# Sugerencias de rivales y altas pendientes

Migración: `deploy/rival_suggestions.sql`. **Aplicada** en pulso-demo el 2026-11-24 (hora de Argentina).

## Qué creó

- Tabla `public.rival_suggestion_runs`: caché de cada clic en «Sugerir rivales con IA». Solo el equipo de Active (filas en `pulso_staff`) puede leer o insertar. Las sugerencias no se agregan solas a la comparación.
- Tabla `public.pending_candidates`: un nombre pedido (a mano o desde una sugerencia) queda en estado `pendiente_de_alta`. **No entra en `candidates`**, así que el recolector y el cron actuales no lo miden. La aprobación y el alta real quedan para un paso posterior, con costo informado.
- Política extra para que el staff lea `ai_answers` (hace falta el costo registrado de «En la IA» para la estimación mensual). El cliente no ve estas tablas.

## Costo

- Aplicar el SQL: **USD 0**.
- Cada sugerencia on demand usa `gpt-6-luna` (o `LLM_MODEL` si está definido), **sin búsqueda web**. Tope por llamada: `PULSO_RIVAL_SUGGEST_MAX_COST_USD` (default 0.05). El precio de `gpt-6-luna` verificado el 2026-11-18 es USD 0.10 / 1M tokens de entrada y USD 0.50 / 1M de salida. Una corrida típica de este prompt debería quedar muy por debajo del tope; el costo real se guarda en la caché.
- Dar de alta un pendiente **no** gasta API ahora, porque no se recolecta.
- Estimación mensual al pedir un alta: se arma con costos **ya registrados** en Pulso. Hoy `daily_usage` está vacío, así que medios, X y anuncios se informan como desconocidos. «En la IA» sí tiene `ai_answers.cost` (chat-latest con búsqueda web). Si no hay suficientes días, se dice. No se inventan tarifas de X ni de Meta.

La web, si las tablas no existieran, no escribe: el panel avisa que falta la migración. El modelo en producción usa `LLM_API_KEY` u `OPENAI_API_KEY` solo en el servidor de pulso-web (nunca `NEXT_PUBLIC_`).


## Corrida local de prueba (2026-11-24, hora de Argentina)

Se llamó a `gpt-6-luna` una vez por candidato, sin búsqueda web, con la clave del servidor de la máquina de trabajo (nunca se copió a la app ni a Render). Las sugerencias de esa corrida se guardaron en el fixture `/workspace/pulso/fixture_rival_suggestions.json` con `origin: "ai"` y una nota que aclara que no es producción.

| Candidato | Modelo | Tokens entrada | Tokens salida | Costo real |
|-----------|--------|----------------|---------------|------------|
| Axel Kicillof | gpt-6-luna | 2978 | 741 | USD 0.000668 |
| Pedro Sánchez | gpt-6-luna | 1753 | 828 | USD 0.000589 |

Total de las dos llamadas: USD 0.001257, muy por debajo del tope de USD 0.05. El recolector, el cron y pulso-web de producción no se tocaron.
