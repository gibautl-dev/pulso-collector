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


## Color del balance

En cualquier KPI o gráfico de balance (−100 a +100), el color sigue el
signo con el mismo umbral de la IA: verde si es mayor que +5, rojo si es
menor que −5, gris en el resto. La leyenda (A favor / En contra / Neutro)
usa esa misma regla.

## Texto de anuncios

El cuerpo de las cards de anuncios se recorta a 120 caracteres y como
máximo 5 líneas, con elipsis. La altura del recuadro es fija.


## Ventana común en comparaciones (fix/rival-common-window)

Un rival que se suma después (Milei empezó a recolectarse el 24/11 23:25
ART; Kicillof el 03/11) quedaba subrepresentado: se sumaban 7 días de un
lado contra horas del otro, y fuentes que solo existen para uno (X, YouTube).

- **Período:** desde el inicio de recolección más tardío entre todos los
  sujetos comparados (candidato + rivales) y todas las fuentes compartidas,
  nunca antes de hoy − N días. Inicio = `candidate_sources.collection_started_at`
  (fuente activa); si la fila no es legible por RLS (un miembro no ve las
  fuentes del rival) o no tiene fecha, el primer `collected_at` de esa fuente
  en `mentions`. Las notas viejas que trae el primer barrido no cuentan.
- **Fuentes:** solo las que se miden para todos (en Radar, solo medios).
- **Variación (pp):** solo si la ventana anterior de la misma longitud
  también está cubierta para todos; si no, no se muestra. La ventana anterior
  ahora tiene tope superior (antes contaba los últimos 2N días).
- **UI:** «Período comparado: 24–25 nov» en gris y un ⓘ con período,
  hora de inicio si se recortó, fuentes y por qué no hay variación.
- Aplica a la tarjeta del tablero, a «Quién domina la conversación» y al
  frente a frente de Rivales y anuncios (menciones, balance, curvas, medios;
  X se oculta si no se mide para los dos).
- Sin cambios de schema ni de permisos.

### Variaciones de un solo candidato y pauta de rivales

- **Menciones ±% (tablero):** la ventana anterior ahora es [hoy − 2N, hoy − N)
  (antes no tenía tope y contaba 2N días, para todos los candidatos). Solo se
  cuentan fuentes activas desde el inicio del período anterior; si no hay
  ninguna (candidato o rival recién dado de alta), no se muestra la variación.
  Si se excluyó alguna fuente, un ⓘ dice cuáles se compararon.
- **Temas a medida:** la tendencia frente al tramo anterior y el pico (3 vs 7
  días) usan la misma regla; el volumen visible sigue contando todo.
- **Anuncios en Rivales y anuncios:** si la pauta de un rival no se mide
  (sin anuncios guardados y sin `meta_ads_settings` activo legible), no se
  muestra su «Anuncios N activos» ni el ranking frente a frente; un ⓘ en su
  tarjeta lo explica.
