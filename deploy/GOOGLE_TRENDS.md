# Google Trends para Pulso (investigación, sin implementar)

Uso pedido: interés de búsqueda relativo del candidato frente a rivales
(Kicillof vs Milei, Sánchez vs Feijóo), por provincia o región, en la pestaña
Comparación. **Solo rutas oficiales.** No se usa pytrends ni se scrapea
[Google Trends](https://trends.google.com/).

No hay migración, recolector ni cambio de UI en esta entrega: **no es viable
sin credenciales** para el caso de uso. Abajo va qué hace falta y una propuesta
de interfaz para cuando haya acceso.

## 1. API oficial de Google Trends (alpha)

Fuentes: [página de la API](https://developers.google.com/search/apis/trends)
(consultada el 24/11/2026) y el
[anuncio del 24/07/2025](https://developers.google.com/search/blog/2025/07/trends-api)
(Daniel Waisberg y Hadas Jacobi). El formulario oficial está embebido en esa
página: [solicitud de acceso alpha](https://docs.google.com/forms/d/e/1FAIpQLSfiP3XUUWGr4CkYk1oJHpthCAcAw2kL0UaE6p7tq3ZoxFiLtA/viewform).

### Qué ofrece (oficial)

- Interés de búsqueda de Google Search, **no un volumen absoluto**.
- Ventana móvil de **1800 días (~5 años)**; los datos llegan **hasta hace 2 días**.
  El anuncio menciona elecciones (cada ~4 años) como motivo de esa ventana.
- Agregación **diaria, semanal, mensual y anual**.
- Recorte geográfico por **región y subregión, ISO 3166-2** (provincias argentinas
  y comunidades/provincias españolas, si el país está cubierto).
- Escalado **consistente entre pedidos** (no se reescala a 0–100 en cada
  consulta, como en el sitio). Permite unir pedidos y comparar **docenas de
  términos**. El anuncio dice que el sitio web compara 5 términos; la página de
  la API dice que el sitio compara 8. En ambos casos el API permite más.

Eso encaja con Comparación: serie temporal del candidato vs rivales y un
desglose por provincia.

### Acceso, elegibilidad, cuotas y costo

- Sigue en **alpha**. La página, el 24/11/2026, todavía dice “We're now accepting
  applications for alpha testers”.
- Cupo limitado. Priorizan a quien tiene un caso de uso concreto, puede empezar
  pronto y va a dar feedback.
- El formulario oficial dice que **todos los campos son obligatorios**, que el
  acceso se otorga “after evaluation of your specific request and according to
  our internal guidelines”, que la versión **no está completa**, **no hay SLA
  ni garantía de soporte técnico**, que es **solo para entornos de prueba** y
  que “it might occasionally break”. Al enviar se acepta probar, dar feedback y
  los Términos de Google.
- Campos del formulario oficial: nombre, apellido, email de la organización,
  **cuenta de Gmail** (“To access the Alpha version, you will need to use a
  Gmail account.”), **ID de un proyecto de Google Cloud**, URL de la
  organización, tipo (University, Research institution, Public company, Private
  company, Independent developer), uso comercial o no comercial, descripción del
  uso, fecha en la que podrían empezar, y si el feedback sería por videollamada,
  email o ambos.
- Sobre el proyecto de Cloud, el formulario cita la guía
  [crear un proyecto](https://developers.google.com/workspace/guides/create-project)
  y aclara: el Gmail tiene que tener permiso sobre ese proyecto; **“Google
  Trends API quota is granted on a per project basis”**; una sola solicitud por
  proyecto.
- **Cuotas numéricas, precio y fecha de disponibilidad general: no están
  publicados** en la página de la API ni en el anuncio. No se inventan. La ayuda
  oficial de testers ([docs / 404](https://developers.google.com/search/apis/trends/help/cant-access-docs))
  confirma que la documentación de la API queda detrás del acceso aprobado.

Para Pulso haría falta: ok de Leandro para postular a Active Marketing
(activemkt.com) como Private company / uso comercial, una cuenta Gmail, un
proyecto de GCP (no creado en este trabajo) y una descripción concreta
(interés relativo candidato vs rivales, por provincia, en Comparación; no se
republica el dataset crudo; solo se muestra en la app). Si aceptan, recién ahí
se ven cuotas, endpoints y si entra en la capa gratuita.

## 2. Dataset público de Google Trends en BigQuery

Fuentes:
[Get started with the Google Trends dataset](https://support.google.com/trends/answer/12764470?hl=en),
[anuncio internacional (31/03/2022)](https://cloud.google.com/blog/products/data-analytics/international-google-trends-datasets-in-bigquery),
marketplace
[google-trends-intl](https://console.cloud.google.com/marketplace/product/bigquery-public-datasets/google-trends-intl).

- Tablas: `bigquery-public-data.google_trends.top_terms` y `top_rising_terms`
  (EE.UU.); `international_top_terms` e `international_top_rising_terms`
  (otros países).
- Internacional: “approximately 50 additional countries”, Top 25 y Top 25
  Rising, por código ISO de país y subregión, granularidad diaria, historial
  móvil de 5 años. Cada partición de un set diario caduca a los 30 días; cada
  término trae backfill de 5 años. “Countries and/or sub-regions may be
  excluded based on data-sharing regulation and policies.”
- Costo: capa gratuita de BigQuery, 1 TB/mes de consultas; sandbox sin tarjeta,
  según la ayuda oficial. Hace falta un **proyecto de GCP**. No se creó.
- **Argentina sí aparece** en un ejemplo oficial de documentación de Google
  Cloud (consulta a `international_top_terms` con
  `refresh_date = DATE_SUB(CURRENT_DATE, INTERVAL 1 DAY)`): `AR` / Argentina,
  24 regiones. Ese ejemplo lista 41 países en esa corrida y muestra, entre
  otros, TR, TH, VN, JP, IN, CO, MX, BR, **AR**, FR, IT, PT, NZ, PH. En el
  fragmento publicado **no se ve ES / Spain**; no se afirma ni se niega la
  cobertura de España sin un dry-run en un proyecto.
- Límite decisivo para Comparación: el dataset **solo trae los Top 25 / Top 25
  Rising del día**, no un término a pedido. No se puede pedir “Kicillof vs
  Milei” o “Sánchez vs Feijóo” salvo que ese día el término esté entre los 25
  más buscados. No sirve como serie estable de candidato vs rival.

## Factibilidad

| Ruta | ¿Sirve para candidato vs rivales por provincia? | ¿Sin credenciales? |
|---|---|---|
| API Trends alpha | Sí, según lo publicado (términos a elección, ISO 3166-2, escalado comparable) | No: formulario, Gmail, proyecto GCP, aprobación, y la cuota no está publicada |
| BigQuery `google_trends` | No, solo Top 25 / Rising | No: hace falta un proyecto GCP, aunque la consulta entre en el 1 TB gratis |
| Sitio de Trends, pytrends u otros no oficiales | Fuera de alcance | — |

**No se agregó un mock con números inventados en las capturas.** La consigna era
incluir un ejemplo en el fixture solo si era viable sin credenciales. No lo es.
La propuesta de UI queda acá, para armarla cuando (y si) aprueben el alpha.

## Qué pedir para avanzar

1. Ok de Leandro para postular a Active Marketing en el
   [formulario oficial](https://docs.google.com/forms/d/e/1FAIpQLSfiP3XUUWGr4CkYk1oJHpthCAcAw2kL0UaE6p7tq3ZoxFiLtA/viewform).
2. Una cuenta Gmail y un proyecto de GCP (sandbox, sin tarjeta, a crear solo
   con su ok). Un solo pedido por proyecto.
3. Texto del caso de uso (borrador): comparar el interés de búsqueda relativo
   de cada candidato de Pulso con sus rivales, por país y por subregión
   (provincias de Argentina / regiones de España), en la pestaña Comparación;
   no se republica el dataset; es un producto de escucha política para
   campañas, en entorno de prueba mientras la API esté en alpha; feedback por
   email o videollamada.
4. Cuando hayan endpoints y cuotas, estimar costo (sin inventar números) y
   recién ahí proponer recolector, tope y migración. No cablear al cron ni
   scrapear el sitio si no hay acceso.

## Propuesta de UI (Comparación)

En `/c/[slug]/comparacion`, un bloque **“Interés de búsqueda (Google Trends)”**
debajo o al lado de las series que ya hay:

- Un gráfico de líneas en el tiempo del candidato y de cada rival (Kicillof y
  Milei en Argentina; Sánchez y Feijóo en España). Agregación semanal por
  defecto, con el reloj del candidato (hora de Argentina / de España).
- Una tabla o mapa simple por provincia o región (ISO 3166-2) con el interés
  relativo del último período.
- Texto fijo: es interés relativo de Search, no un recuento de búsquedas; la
  fuente es la API oficial de Google Trends; no se scrapea el sitio.
- Hasta que haya acceso: el bloque visible, vacío, con “Todavía no está
  configurado. Hace falta el acceso alpha de Google Trends y un proyecto de
  Cloud.” Sin números de ejemplo que parezcan datos reales.
- Si más adelante el BigQuery de Top 25 aporta un término que coincida con un
  candidato, se puede mostrar como “apareció entre los 25 más buscados”, no
  como serie completa vs el rival.

No se propone una pestaña nueva: Comparación ya es el lugar del candidato
frente a rivales.
