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
