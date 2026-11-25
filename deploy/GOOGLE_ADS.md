# Anuncios de Google

Propuesta para mostrar anuncios de Google junto a la Biblioteca de Meta, con
**rutas oficiales solamente**. No se scrapea [Ads Transparency Center](https://adstransparency.google.com/).
No hay una API pública del Centro de Transparencia (respuesta del equipo de Google Ads API, julio 2024; no aparece un anuncio posterior de una API).

**La migración `deploy/google_ads.sql` no está aplicada.** El job
`python -m pulso.google_ads` **no está cableado al cron**. No crear un proyecto
de GCP ni un recurso pago hasta que se apruebe.

## Dos datasets oficiales, cobertura distinta

### 1. Political Ads Transparency Report (`google_political_ads`)

- Marketplace: [Political Advertising on Google](https://console.cloud.google.com/marketplace/details/transparency-report/google-political-ads)
- BigQuery: `bigquery-public-data.google_political_ads`
- Descarga oficial sin proyecto: [google-political-ads-transparency-bundle.zip](https://storage.googleapis.com/political-csv/google-political-ads-transparency-bundle.zip)
  (el ZIP viejo en `transparencyreport/` solo redirige a esta URL; README oficial del 31/05/2022).
- Qué incluye: anuncios **electorales de anunciantes verificados** en Google Ads, YouTube y DV360. Creativo (el vínculo a la ficha), targeting de edad/género/geo, rangos de impresiones y de gasto, fechas.
- Retención declarada: desde 2018, 7 años después de la elección (marketplace).
- Actualización: el marketplace dice **diaria**. El CSV `google-political-ads-updated.csv` de la copia del **24/11/2026 16:04:21 PT** (hora del archivo). El gasto semanal se actualiza **los martes** (README del ZIP).
- Países en esa misma copia, campo `Regions` de `advertiser_stats` (23.344 anunciantes): US, BR, IN, **AR**, AU, CL, IL, GB, MX, TW, NZ, ZA. **No aparecen ES, EU ni EEA** (0 filas).
- Política: [Election Ads](https://support.google.com/adspolicy/answer/6014595) lista a **Argentina**. España no está en esa lista de verificación electoral.
- Desde **septiembre 2025**, Google restringe la publicidad política en la UE según el Reglamento 2024/900 y **dejó de publicar el informe de anuncios políticos de la UE**. Los anuncios electorales de la UE que ya estaban en el informe siguen accesibles en el Ads Transparency Center, sujetos a retención. Fuente: [Update to Political Content policy (September 2025)](https://support.google.com/adspolicy/answer/16409999).

### 2. Ads Transparency Center (`google_ads_transparency_center`)

- Marketplace: [Google Ads Transparency Center](https://console.cloud.google.com/marketplace/details/bigquery-public-data/google-ads-transparency-center)
- BigQuery: `bigquery-public-data.google_ads_transparency_center` (tablas `creative_stats` y `removed_creative_stats`)
- Descarga oficial sin login: `gs://ads-transparency-center/` (también `https://storage.googleapis.com/ads-transparency-center/`). README en `api-data/README.txt` (última modificación 18/03/2026).
- Cobertura oficial: anuncios **mostrados en el Espacio Económico Europeo o Turquía**. España entra. **Argentina no**. El marketplace incluye de ejemplo la consulta “Which ads were shown in Spain?”.
- Campos (README oficial): anunciante (nombre legal y divulgado, verificación, ubicación), `creative_id`, `creative_page_url`, formato, tema, `ad_funded_by`, Ad Grants, `region_stats` (código de región, first/last shown, rangos de impresiones y fechas) y criterios de audiencia. **No hay gasto. No hay texto, imagen ni URL de aterrizaje** del creativo; solo el vínculo a la ficha.
- Impresiones: desde el 1/03/2023; si el anuncio es anterior, `first_shown` se reporta como esa fecha. El README documenta `times_shown_availability_date` cuando las impresiones todavía no se publicaron.
- Actualización: marketplace **diaria**, “may be delayed from what appears on the website”. Listado GCS del **24/11/2026 22:44 ART** (25/11/2026 01:44:20 UTC): 5.000 shards de `creative_stats` y 1.000 de `removed_creative_stats`, recién escritos.
- Tamaño oficial medido en ese listado (no es el tamaño de facturación de BigQuery): `creative_stats` **670.916.438.650 bytes (624,84 GiB)**; `removed_creative_stats` **34.494.591.863 bytes (32,13 GiB)**; total **705.411.039.945 bytes (656,97 GiB)**. Bajar el dump completo para filtrar no es razonable.

Para consultar BigQuery hace falta **un proyecto de GCP**. El [blog oficial](https://cloud.google.com/blog/topics/developers-practitioners/how-get-started-political-ads-transparency-report-dataset) indica que el [sandbox de BigQuery](https://cloud.google.com/bigquery/docs/sandbox) permite consultar la capa gratuita **sin tarjeta**. No se creó ningún proyecto en este trabajo.

## Cobertura por candidato (evidencia de la copia oficial del 24/11/2026)

Copia usada: ZIP `political-csv`, `content-length` **316.434.593** bytes, `last-modified` **25/11/2026 00:47:37 UTC**, `Report_Data_Updated_Time (PT)` **2026-11-24 16:04:21**. En noviembre ese PT es PST (UTC−8), o sea **24/11/2026 21:04:21 hora de Argentina**.

### Axel Kicillof (Argentina)

- El reporte político **sí cubre AR**: 856 anunciantes y 64.490 creativos con `Regions=AR` (de 1.644.184 creativos en total).
- **No hay ningún anunciante cuyo nombre contenga “Kicillof”** (0 filas en `advertiser_stats`). Tampoco “Gobierno de la Provincia de Buenos Aires”.
- Sí aparecen coaliciones y partidos de la provincia, entre otros:

  | Anunciante | Advertiser_ID | Creativos | Spend_ARS (total del archivo) | Última semana con gasto | Último `Last_Served_Timestamp` |
  |---|---|---:|---:|---|---|
  | FUERZA PATRIA PBA A. P. - ALIANZA | AR03608428782462959617 | 409 | 79.965.000 | 2025-10-26 | 2025-10-31T10:57 |
  | Partido Frente Grande Buenos Aires - Fuerza Patria PBA | AR09160339148358287361 | 23 | 12.345.000 | 2025-08-31 | 2025-09-05T10:57 |
  | FUERZA PATRIA | AR09174036795497644033 | 23 | 2.115.000 | 2025-10-19 | 2025-10-25T15:51 |
  | Unión por la Patria La Plata | AR12743114125521977345 | 38 (12 en 2025) | 2.370.000 (semanal) | 2025-08-17 | 2025-08-18T17:38 |
  | Unión por la Patria de la Provincia de Buenos Aires | AR03749993292540936193 | 24 | 4.980.000 | 2023-08-06 | 2023-08-11T02:09 |
  | Unión por la Patria de la Provincia de Buenos Aires, Argentina | AR08762597809217077249 | 36 | 14.145.000 | 2023-10-22 | 2023-10-27T02:59 |

  Los `Spend_ARS` de `advertiser_stats` son los del archivo oficial (enteros, no un rango). El gasto semanal de Fuerza Patria PBA se concentra en octubre 2025 (semanas del 05 al 26). El reporte de AR sigue activo en general: hay filas semanales hasta **2026-11-22** (19 anunciantes esa semana), pero no de esas coaliciones.
- El dataset **no incluye el texto del anuncio**. No se puede afirmar, desde el CSV, que un creativo “mencione a Kicillof”. La UI lo tiene que decir con claridad y el vínculo abre la ficha oficial.
- El dataset de Transparency Center **no sirve para Argentina** (solo EEE/Turquía).

### Pedro Sánchez (España)

- El reporte político de esta copia **no tiene España**: 0 creativos y 0 anunciantes con región ES/EU/EEA. Encaja con el cierre del informe de la UE en septiembre 2025 y con que España no está en la lista de Election Ads.
- La ruta oficial para España es el dataset del **Ads Transparency Center** (anuncios mostrados en el EEE, no solo políticos). Una consulta filtrada por `region_stats.region_code = 'ES'` y nombres como PSOE / Pedro Sánchez **requiere un proyecto de GCP**; no se ejecutó. **No se inventa** que esos anunciantes aparezcan.
- Además, desde septiembre 2025 la publicidad política en la UE está restringida en Google. Pueden quedar anuncios históricos en el ATC y, si aplica, excepciones institucionales. Eso no se verificó anuncio por anuncio.

## Costo

Capa gratuita de BigQuery: **1 TB de procesamiento por mes** y por cuenta de facturación, según el marketplace de ambos datasets.

- **Reporte político (CSV oficial):** cada corrida descarga **316.434.593 bytes** (301,8 MiB) del ZIP. El `creative-stats.csv` descomprimido pesa **2.961.143.776 bytes**. Se puede filtrar en streaming, sin BigQuery. Costo de consulta: **USD 0**.
- **ATC por BigQuery (EST):** no hay un dry-run (hace falta el proyecto). El dump JSON en GCS de `creative_stats` mide **624,84 GiB**. Si el tamaño lógico facturable se pareciera al JSON, un `SELECT` de tabla completa se comería buena parte del 1 TB mensual (EST: en el orden de 0,6 TiB). El tamaño columnar real puede ser menor. Un filtro por nombre o región **puede igual escanear toda la tabla** si no está particionada o agrupada por esos campos. **Hay que correr `bq query --dry_run` en el proyecto, cuando exista, y no inventar el byte count de facturación.**
- El recolector, cuando tenga proyecto, debería hacer dry-run primero y abortar si el estimado supera un tope (propuesta: `PULSO_GOOGLE_ADS_MAX_BYTES`, default 50 GiB, a confirmar con el dry-run).

## Credenciales y aprobaciones que faltan

1. **Aplicar `deploy/google_ads.sql`** en pulso-demo (Leandro tiene que dar el ok). Hasta entonces no se escribe en la base.
2. **Kicillof / reporte político:** ninguna credencial. El ZIP es público.
3. **Sánchez / ATC:** un **proyecto de GCP** (alcance: BigQuery Job User sobre ese proyecto; el dataset público ya es consultable). El sandbox oficial no pide tarjeta, dentro de la capa gratuita. Para un cron, más adelante, una cuenta de servicio con ese rol. **No crear el proyecto ni la cuenta hasta que se apruebe.**
4. **No cablear el job al cron** ni setear env en Render hasta probar en una rama y ver capturas.
5. Confirmar la lista de anunciantes de Kicillof (por defecto solo IDs/patrones de coaliciones de la provincia, no el UP nacional de 2023).

## Cómo corre (propuesta, apagado)

- Adaptador: `python -m pulso.google_ads --candidate axel-kicillof --dry-run`.
- Apagado por defecto (`PULSO_GOOGLE_ADS_ENABLED`). No está en `deploy_run` ni en el cron.
- Dry-run local: `--from-csv tests/fixtures/google_political_ads_creatives.csv` o `--from-json` (ATC de ejemplo).
- Variables opcionales: `PULSO_GOOGLE_ADS_ENABLED`, `PULSO_GOOGLE_ADS_DRY_RUN`, `GOOGLE_CLOUD_PROJECT` / `GOOGLE_APPLICATION_CREDENTIALS` (solo ATC), `PULSO_GOOGLE_ADS_MAX_BYTES`.

## Campos útiles en la UI

Del reporte político (Argentina): fechas de difusión, tipo (TEXT/IMAGE/VIDEO), rangos de impresiones (en la copia aparecen intervalos más finos que los cinco baldes del README), rangos de gasto en ARS, targeting de edad/género/geo, vínculo `https://adstransparency.google.com/advertiser/{id}/creative/{id}?political=&region=AR`.

Del ATC (España, cuando se pueda consultar): fechas por región, rangos de impresiones, formato, tema, quién pagó, vínculo a la ficha. Sin gasto.

## Google Trends (Investigación aparte)

La viabilidad del interés de búsqueda en Comparación está en `deploy/GOOGLE_TRENDS.md`. La API oficial sigue en alpha y pide aprobación más un proyecto de GCP. El dataset público de BigQuery no permite términos a elección. No se implementó ni se inventaron series.
