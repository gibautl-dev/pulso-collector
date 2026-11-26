# Feeds oficiales y de verificación

Rama `feat/official-and-factcheck-feeds`. **Todavía no aplicado** en
pulso-demo ni en Render: hace falta aprobación para el SQL y un
redespliegue de `pulso-rss`. La web no cambia.

Backup de solo lectura (fuera del repo):
`/workspace/pulso/backup_candidate_sources_pre_official_feeds_2026-11-26.json`.

## Qué cambia (cuando se aplique)

SQL: `deploy/rss_official_and_factcheck_feeds.sql` (idempotente, sin
cambio de esquema). Rollback: restaurar `settings` desde el backup.

- **Kicillof:** se saca `https://chequeado.com/feed/` (robots.txt
  `Disallow: /feed/` para el UA genérico; además ese feed solo trae notas
  institucionales). Se suma `https://www.gba.gob.ar/rss.xml`.
  `own_domains` ya tiene `gba.gob.ar`, así que las gacetillas oficiales
  quedan con `account_relation=own`. Crawl-delay de 10 s en ese host.
- **Milei:** se saca el mismo feed de Chequeado. Se suma
  `https://www.casarosada.gob.ar/informacion/discursos?format=feed`.
  Solo las URLs bajo `/informacion/discursos` se marcan como propias
  (`settings.own_url_prefixes`). No se agrega `casarosada.gob.ar` a
  `own_domains`, para no atribuir al presidente las conferencias del
  vocero. El RSS de discursos trae título, fecha y URL; no el texto
  completo (no se baja el HTML).
- **Sánchez:** se suman `https://maldita.es/feed` y
  `https://www.newtral.es/zona-verificacion/feed/`. El feed general de
  Newtral se mantiene. Crawl-delay de 2 s en `newtral.es`. El feed de
  Maldita es grande (~4,6 MB; el tope del recolector es 5 MB).

Chequeado (`/nota/feed/` o los tags por candidato) queda fuera hasta
tener autorización escrita de reuso. El detector ya trata
`chequeado.com` como verificador, por si entra por otra fuente permitida.

## Recolector

- User-Agent honesto (`PulsoCollector/0.3 (+https://pulso-web-re4x.onrender.com)`).
  No se imita `UniversalFeedParser`.
- `own_url_prefixes` en `pulso/sources/rss_media.py`: un prefijo de path
  no marca otras secciones del mismo host.
- Entre pedidos al mismo host se respeta el Crawl-delay conocido
  (`gba.gob.ar` 10 s, `newtral.es` 2 s), ampliable en
  `settings.crawl_delays`.
- No se scrapea HTML de artículos ni de discursos.

## Contradicciones (`inconsistency-v2`)

Las menciones de Maldita, Newtral y Chequeado (por host o nombre del
medio) entran como `flag`, aunque el titular no traiga pistas del tipo
«marcha atrás». Si el título atribuye una cita, esa cita se guarda en la
pieza. Un medio común con el mismo titular sigue siendo `attributed`.

## Cómo aplicar (cuando lo apruebe Leandro)

1. Confirmar que el backup sigue siendo el estado actual (o repetir el
   SELECT del SQL).
2. Aplicar `deploy/rss_official_and_factcheck_feeds.sql` en pulso-demo.
3. Redesplegar **solo** `pulso-rss` con este commit (hace falta el
   código de `own_url_prefixes` y el Crawl-delay). `pulso-web` no
   requiere redespliegue: las menciones siguen siendo `rss_media`.
