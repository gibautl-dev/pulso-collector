# Visuales del video CCO (rama feat/cco-visuals, no desplegado)

Rediseño de Tablero, Comparación (Rivales y anuncios), Cuentas sospechosas
y En la IA, con datos reales y estados vacíos cuando falta información.
Sin cambios de schema, roles, env ni cron.

## Fórmulas

- **Menciones ±%:** (total del período − total de la ventana anterior de la
  misma longitud) / anterior × 100. En 7 días se etiqueta “vs semana
  anterior”. Si la base es 0, se muestra “sin base anterior”.
- **PICO +X%:** el día de mayor volumen (el más reciente si hay empate)
  contra el promedio de los *demás* días del período visible, incluidos
  ceros. X = round((pico − promedio) / promedio × 100). Solo se muestra
  si X ≥ 15.
- **Balance del día (−100 a +100):** promedio de los `balance` ya
  guardados en la última foto diaria. A favor / En contra / Neutrales:
  proporción de esas respuestas con el umbral existente (>5, <−5, resto).
- **Subrayado en la respuesta de IA:** frases de `positives` y `negatives`
  que aparecen en el texto (sin tildes ni mayúsculas). No hay llamada
  extra a un modelo. Si la frase no está textual, no se inventa el
  resaltado.
- **Share of voice:** menciones de terceros de cada sujeto sobre la suma
  de esas menciones en el período.
- **Pauta de rivales:** anuncios de Meta del candidato cuyo `page_name` o
  `bylines` contienen un token de 4+ letras del nombre del rival. El % en
  contra es sobre los atribuidos ya clasificados.
- **Red de sospechosas:** nodos reales (candidato al centro, cuentas de la
  conversación, marcadas en rojo). Aristas entre cuentas solo si el
  detector guardó la misma evidencia (fingerprint de coordinación/texto,
  URL compartida o ráfaga de grupo). Si no hay esa evidencia, no se
  dibujan vínculos entre cuentas.

## Huecos de datos (no se inventan)

- Google Ads no trae texto de creativo: la tarjeta lo declara.
- Sánchez / UE: Meta no aplica; se muestra el aviso existente.
- Si un rival no coincide con ningún anunciante, la tarjeta de pauta queda
  vacía.
- Si no hay relaciones documentadas entre cuentas sospechosas, la red lo
  explica.

## Tarjetas del final del tablero

Las tres cards de abajo (Comparación con rivales, Equipo de acción, Temas
a medida) muestran un dato real en el estilo de los KPI y un botón
«Ver más →». Si no hay dato, queda el estado vacío (sin inventar).

- **Comparación:** share of voice del candidato vs el rival con más
  menciones de terceros en la ventana, sobre la suma de candidato +
  rivales asignados. El ± es en puntos porcentuales frente a la ventana
  anterior de la misma longitud.
- **Equipo de acción:** cantidad de alertas en `new` o `in_review` y el
  título de la de mayor riesgo (severidad, empate por `last_detected_at`).
- **Temas a medida:** el tema con más menciones del período y, si
  corresponde, el indicador de pico ya calculado por la interfaz.

## Extracto de menciones

Títulos y extractos se limpian antes de mostrarlos (listas de capítulos
con horarios, pipes, URLs; recorte con elipsis). En Temas a medida se
muestran 2–3 menciones recientes como en el feed, con fecha/hora ART y
un enlace «Ver original →».

Los costos de API y las notas internas («no dispara el agente de
crisis», topes en USD, modelo) no van en la UI del cliente; quedan en
el panel Active o en el código.
