# Fuentes nuevas (Alerts, RSS, GDELT, Wikipedia)

Rama de origen `feat/new-sources`. Radio Nacional, GDELT y Wikipedia:
**aplicados en pulso-demo el 2026-11-25** (hora de Argentina). InfoCielo y
Qué Digital se sumaron ese día y se volvieron a sacar (403 desde la IP de
Render; las notas siguen llegando por Google News). Google Alerts **no** se
activó (sigue apagado, ver `deploy/GOOGLE_ALERTS.md`). Costo de las APIs: 0.

Backups de `rss_media` (fuera del repo):
`backup_candidate_sources_pre_new_rss_2026-11-25.json` (antes de sumar los
tres feeds) y `backup_candidate_sources_pre_disable_blocked_rss_2026-11-25.json`
(antes de sacar InfoCielo y Qué Digital).

## Qué se aplicó, y en qué orden

1. Backup de `candidate_sources.settings` de `rss_media` para `axel-kicillof`
   y `milei` (consulta en `deploy/rss_add_feeds_nacional_infocielo_quedigital.sql`).
2. Aplicar ese SQL: suma Radio Nacional, InfoCielo y Qué Digital, sin
   reactivar los dos feeds que se sacaron por Cloudflare.
3. Aplicar `deploy/gdelt_enable.sql` (no cambia el esquema; prende GDELT).
4. Aplicar `deploy/wikipedia_pageviews.sql` (tablas nuevas + semilla de
   artículos). Después, en el cron, `PULSO_WIKIPEDIA_ENABLED=true`.
5. Aplicar `deploy/rss_disable_infocielo_quedigital.sql`: saca InfoCielo y
   Qué Digital; Radio Nacional se queda. Sánchez no se toca.
6. Google Alerts: **pendiente**. Crear las alertas a mano y pegar los feeds,
   según `deploy/GOOGLE_ALERTS.md`. No hace falta migración.

El cron necesita `PULSO_WIKIPEDIA_ENABLED=true` y redespliegue (web + pulso-rss).

## GDELT DOC 2.0

- Adaptador: `pulso/sources/gdelt.py`. Un pedido cada 8 segundos (con sello
  compartido entre procesos del cron), User-Agent honesto, `sourcecountry:AR`
  en Argentina y `sourcecountry:ES` en Sánchez. Un 429, un 5xx o un error
  de red/timeout se registran como falla blanda (warning, `soft_failure`) y
  no hacen salir al cron con código 1; el próximo tick reintenta. Un error
  de configuración o de respuesta inválida sigue siendo duro.
- Dedupe por URL canónica entre sí y, al guardar, contra menciones ya
  existentes de cualquier fuente (`save_result`).
- Atribución en la interfaz: “Proyecto GDELT” con enlace a
  https://www.gdeltproject.org/ (en Salud de fuentes y en el tablero, cuando
  hay menciones de esta fuente).
- Términos: uso comercial permitido con cita y enlace
  (https://www.gdeltproject.org/about.html).

## Wikipedia (interés)

- Job: `python -m pulso.wikipedia`. También corre para rivales descubiertos
  en la DB (p. ej. Milei), sin prender anuncios ni crisis para esos slugs.
  API
  `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/...`
  con agentes `user` (visitas de personas). User-Agent identificable.
- Artículo configurable por candidato en `wikipedia_pageview_settings`.
- En el Tablero: tarjeta chica “Interés en Wikipedia”, con el último día
  con dato, la variación frente a la semana anterior y un ⓘ de atribución
  a Wikimedia, sin texto técnico ni de costos.

## RSS nuevos

URLs oficiales verificadas el 2026-11-25:

- https://www.radionacional.com.ar/feed/ — vigente para Kicillof y Milei.
- https://www.infocielo.com/rss — sacado el 2026-11-25 (403 desde Render).
- https://quedigital.com.ar/feed — sacado el 2026-11-25 (403 desde Render).

Sánchez no se tocó. Plan de backup en cada SQL.
