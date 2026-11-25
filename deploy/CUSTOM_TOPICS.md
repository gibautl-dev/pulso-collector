# Temas a medida y analista por tema

Migración: `deploy/custom_topics.sql`. **Aplicada** en pulso-demo el 2026-11-24 (hora de Argentina).

Renombre visible: la bandeja de crisis pasa a llamarse **Equipo de acción**. La ruta sigue siendo `/c/[slug]/accion`.

## Qué creó

- Tabla `public.custom_topics`: una temática definida a mano por candidato (nombre, descripción, palabras clave, inclusiones, exclusiones, fuentes opcionales). **No es** `public.topics`, que sigue siendo el clasificador automático de menciones.
- Tabla `public.custom_topic_summaries`: resumen del analista de ese tema (qué está pasando, riesgos, oportunidades, ángulos de contenido propio). Estado `draft` / `approved` / `discarded`. Una persona aprueba; Pulso no publica ni postea.
- Tabla `public.custom_topic_classifications`: caché opcional de relevancia con `gpt-6-luna` sobre menciones que ya coincidieron por palabras.
- RLS: el cliente ve solo los temas de su candidato. El staff de Active crea y edita. Si más adelante un miembro tiene `candidate_members.role = 'admin'` (hoy el rol en uso es solo `viewer`), también podría editar los de su candidato. Esta rama no invita usuarios ni cambia roles existentes.
- El recorte corre sobre menciones que Pulso **ya recolecta**. No hay consultas nuevas a X ni fuentes extra en el recolector.

Señal de pico: la interfaz puede marcar un posible pico (últimos 3 días al menos al doble del ritmo previo, con un mínimo de menciones). **No dispara** el agente de crisis ni cambia sus umbrales. Queda como enganche futuro, apagado.

## Costo

- Aplicar el SQL: **USD 0**.
- Matching por palabras clave: **USD 0** (usa datos ya guardados).
- Clasificación de relevancia, si se pide: **USD 0.000097 por mención** (dato informado de una pasada corta con `gpt-6-luna`, sin búsqueda web).
- Resumen on demand: `gpt-6-luna`, sin búsqueda web, tope `PULSO_TOPIC_SUMMARY_MAX_COST_USD` (default 0.05). El costo real de una corrida local de prueba, si se hizo, se anota abajo.
- Recolección extra por tema (Google News o X con queries propias): **no está en esta rama**. Sería costo adicional de API/cuota; se describe como opción en el informe, no se enciende.

La web, si las tablas no existen, no escribe: lista vacía o aviso de migración no aplicada. Esta rama no configura env ni publica.


## Corrida local de prueba (2026-11-24, hora de Argentina)

Se llamó a `gpt-6-luna` una vez por tema, sin búsqueda web, con la clave del servidor de la máquina de trabajo (nunca se copió a la app ni a Render). Los resúmenes quedaron en `/workspace/pulso/fixture_custom_topics.json` con `origin: "ai"` y una nota de que no es producción.

| Tema | Candidato | Tokens entrada | Tokens salida | Costo real |
|------|-----------|----------------|---------------|------------|
| Cierre de aulas y educación | Axel Kicillof | 626 | 496 | USD 0.000311 |
| Vivienda y alquileres | Pedro Sánchez | 908 | 367 | USD 0.000274 |

Total de las dos llamadas: USD 0.000585, muy por debajo del tope de USD 0.05. El recolector, el cron y pulso-web de producción no se tocaron.
