# Resultados en IA

Qué responde un modelo cuando alguien pregunta por el candidato. Arranca solo
con OpenAI. Esta migración **no está aplicada**. El job queda apagado
(`PULSO_AI_VISIBILITY_ENABLED=false`) hasta que se apruebe.

## Qué hace el módulo

Una vez por día, si se habilita, hace un set fijo de 8 a 12 preguntas neutrales
(las que haría un votante) sobre el candidato. Las preguntas viven en
`pulso/ai_visibility/prompts.py` y se pueden reemplazar por candidato con un
JSON (`--prompts`) o, cuando exista la tabla, con
`ai_visibility_settings.prompts`.

El modelo por defecto es `chat-latest` (Instant de ChatGPT, según la
documentación de OpenAI) vía Responses API, con la herramienta `web_search` y
ubicación aproximada en Argentina. Si la cuenta no admite la herramienta, el
módulo reintenta sin web y lo deja asentado. Las URLs citadas se guardan en
`citations`.

Cada respuesta se clasifica con el clasificador existente (`gpt-6-luna`): tono
hacia el candidato, target, tema y relevancia. Las menciones de otros políticos
salen de una extracción estructurada extra, con el mismo modelo, porque el
contrato del clasificador de menciones no devuelve nombres. Las fuentes citadas
vienen de la API, no del clasificador.

## Modelo y costos

Precios públicos verificados el 2026-11-18 en
https://developers.openai.com/api/docs/pricing:

- `chat-latest`: USD 5.00 / 1M input, USD 0.50 / 1M input en caché, USD 30.00 / 1M output.
- `web_search` (incl. imágenes): USD 10.00 / 1k llamadas + tokens de contenido al precio del modelo.
- `gpt-6-luna` (clasificador): USD 0.10 / 1M input, USD 0.50 / 1M output.

El costo de una corrida se calcula con los tokens que devuelve la API, no con
una estimación a ojo. La proyección mensual asume una corrida diaria × 30.

## Limitaciones

- La Responses API no es idéntica a la app ChatGPT (memoria, enrutado, interfaz).
- OpenAI suele ilustrar búsquedas de producción con `gpt-6.2-astra`; acá se usa
  `chat-latest` porque es el Instant documentado de ChatGPT.
- El corte de conocimiento de `chat-latest` es el 20 de abril de 2026; la
  búsqueda web puede aportar fuentes más recientes.
- El clasificador recorta cada respuesta a 1200 caracteres.
- Una corrida diaria es una foto fija, no un panel de usuarios.

## Cómo habilitarlo (cuando se apruebe)

1. Revisar y aplicar `deploy/ai_visibility.sql` en el SQL editor (una vez).
2. En el cron, agregar `PULSO_AI_VISIBILITY_ENABLED=true` por fusión, sin
   reemplazar el resto de las variables. Hace falta `LLM_API_KEY` (ya usada
   por el clasificador) y `CLASSIFIER_DATABASE_URL`.
3. El supervisor llama `python -m pulso.ai_visibility` después del detector de
   cuentas sospechosas. Un error de este paso no cambia el código de salida del cron.
4. No mergear ni desplegar este cambio hasta que se pida explícitamente.

El dry-run de desarrollo:

```
python -m pulso.ai_visibility --candidate "Axel Kicillof" --dry-run --output FILE
```

Nunca escribe en la base. La clave se lee de `LLM_API_KEY` o `OPENAI_API_KEY`
en el entorno; no se imprime.
