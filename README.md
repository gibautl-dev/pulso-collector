# Pulso — recolector, pasos 1 a 3

Python 3.12+, PostgreSQL de Supabase y adaptadores RSS, Google News, Google
Alerts, YouTube, X, GDELT DOC 2.0 y visitas de Wikipedia. En pulso-demo, el
2026-11-25 se aplicaron Radio Nacional, GDELT y las tablas de Wikipedia
(ver `deploy/NEW_SOURCES.md`). InfoCielo y Qué Digital se habilitaron y
después se sacaron del RSS (403 desde Render; siguen llegando por Google
News). Un 429 de GDELT no tumba el cron. Wikipedia también corre para
rivales de la DB (p. ej. Milei). El cron prende Wikipedia con
`PULSO_WIKIPEDIA_ENABLED=true`. Google Alerts sigue apagado (ver
`deploy/GOOGLE_ALERTS.md`). GDELT y Wikipedia no tienen costo de API.
No incluye front, cron, clasificación, agrupación, vistas ni backfill multifuente.

## Probar contra Supabase real

1. Crear un proyecto Supabase nuevo y ejecutar `schema.sql` una sola vez en SQL
   Editor. No volver a ejecutarlo si ya fue aplicado. No hay cambios respecto
   al esquema del paso 1.
2. Obtener la conexión PostgreSQL desde el panel del proyecto. Usar conexión
   directa si la red permite IPv6 o el pooler de **sesión** si se necesita IPv4.
   No usar pooler de transacción: el lock requiere conservar la sesión.
3. Instalar y completar `.env` local (solo servidor):

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -e .
cp .env.example .env
```

Completar `DATABASE_URL` con usuario, contraseña, host, puerto y base del panel,
y `sslmode=require` o superior. Codificar caracteres especiales de la contraseña
como componentes de URL. No hace falta clave de API de Supabase para psycopg.
No pegar secretos en chats, frontend, commits o logs.

4. Editar `setup_candidate.sql`: nombre real, variantes, exclusiones y feeds
   RSS vigentes de medios del distrito. Ejecutarlo en SQL Editor. Si solo se
   quiere probar Google News, se puede omitir el UPDATE de RSS y usar
   `--source google_news`. No ejecutar el ejemplo con el dominio REEMPLAZAR.
5. Google Alerts es opcional: crear alertas manualmente, seleccionar RSS, pegar
   las URLs en `candidates.alert_feeds` y habilitar `google_alerts` con las
   consultas comentadas al final de `setup_candidate.sql`.
6. YouTube queda implementado pero apagado. Cuando haya `YOUTUBE_API_KEY` en el
   servidor, aplicar `deploy/youtube_enable.sql` (no se corre solo) y redesplegar
   el cron. Respeta un intervalo mínimo de 1 hora. Ver “Activar YouTube”.
7. X queda implementado pero apagado. Cuando haya `X_BEARER_TOKEN` en el
   servidor, aplicar `deploy/x_enable.sql` (no se corre solo) y redesplegar
   el cron. Respeta un intervalo de 1 hora. Ver “Activar X”.
8. Ejecutar desde la carpeta raíz del proyecto:

```bash
# Consulta real de Google News; no escribe menciones, cursores ni ejecuciones.
python -m pulso.collect_rss --candidate candidato-demo --source google_news --dry-run
# Guarda las fuentes habilitadas y configuradas.
python -m pulso.collect_rss --candidate candidato-demo --days 7
# Releer los feeds para verificar dedupe sin depender de la caché HTTP.
python -m pulso.collect_rss --candidate candidato-demo --days 7 --refresh
```

Los logs JSON muestran encontrados/nuevos, feeds correctos y entradas omitidas.
Una fuente fallida no detiene las demás; código de salida 1 si hubo fallos.
`--source` no activa fuentes deshabilitadas. El comando es manual y no aplica
`next_run_at`: el scheduler futuro implementará intervalos. Siempre relee la
ventana completa para capturar artículos agregados fuera de orden. `--refresh`
también sirve al ampliar `--days`, evitando respuestas 304 de caché anterior.
Los feeds solo devuelven historia disponible: siete días no garantizados.

## Revisar los resultados en SQL Editor

```sql
select m.source,m.title,m.url,m.published_at,m.account_relation
from public.mentions m join public.candidates c on c.id=m.candidate_id
where c.slug='candidato-demo' order by m.published_at desc limit 30;

select r.source,r.status,r.items_found,r.items_new,r.error
from public.source_runs r join public.candidates c on c.id=r.candidate_id
where c.slug='candidato-demo' order by r.started_at desc limit 20;
```

Repetir con `--refresh` sobre feeds sin cambios debe dar `items_new=0`. Si entran
noticias entre corridas, pueden aparecer nuevos legítimos.



## Cuentas sospechosas (propuesta, no aplicada)

Detector local de cuentas con señales baratas (textos repetidos, ráfagas,
cuentas nuevas y señales opcionales de calidad) para revisión humana. **No
denuncia ni actúa sobre las redes.** La migración
`deploy/suspicious_accounts.sql` no está aplicada; el paso en el cron queda
apagado (`PULSO_SUSPICIOUS_ENABLED=false`). Detalle, limitaciones y propuesta
de vista web: `deploy/SUSPICIOUS_ACCOUNTS.md`.

Corrida local de solo lectura:

```bash
python -m pulso.suspicious --from-json menciones.json --dry-run
```

## Activar YouTube

El adaptador usa YouTube Data API v3 (`search.list`, `videos.list` y, si
`collect_comments` está en true, `commentThreads.list` de los videos nuevos con
más vistas). No hace falta cambiar el schema ni los roles: la cuota se guarda
en `candidate_sources.cursor`. Pasos, en este orden:

1. Crear una API key de YouTube Data API v3 y cargarla como `YOUTUBE_API_KEY`
   en el entorno del cron. Nunca commitear la clave.
2. Desplegar una imagen que incluya el adaptador de YouTube.
3. Ejecutar `deploy/youtube_enable.sql` en el SQL Editor (ajusta el slug si
   hace falta). Eso prende la fila, deja el intervalo en al menos 3600 s y
   carga techos seguros de cuota.

Tope por defecto: 20 búsquedas por día por candidato y 3000 unidades (de un
máximo gratuito de 10.000). Cada `search.list` cuesta 100; `videos.list` y
`commentThreads.list` cuestan 1. Con una corrida por hora, el uso típico es
unas 2120 unidades/día (20×100 de búsquedas, ~20 de `videos.list` y hasta
100 de comentarios). Ante `quotaExceeded` hay backoff hasta el reset de
cuota (medianoche en hora del Pacífico).

## Activar X

El adaptador usa X API v2 `GET /2/tweets/search/recent` con un bearer token.
No hace falta cambiar el schema ni los roles: `source_catalog` ya tiene la
fila `x`, y la cuota se guarda en `candidate_sources.cursor`. Pasos, en este
orden:

1. Crear una app en la [consola de X](https://console.x.com), cargar créditos
   de pago por uso y guardar el bearer token como `X_BEARER_TOKEN` en el
   entorno del cron. Nunca commitear el token.
2. Desplegar una imagen que incluya el adaptador de X.
3. Ejecutar `deploy/x_enable.sql` en el SQL Editor (ajusta el slug si hace
   falta). Eso prende la fila, deja el intervalo en al menos 3600 s y carga
   techos de 300 posts por día, 10 pedidos por día y 25 posts por corrida.
   Por defecto solo se piden posts originales en español (`lang:es -is:retweet
   -is:reply`).

El precio oficial de lectura es USD 0.005 por post y USD 0.010 por usuario
incluido en la expansión `author_id` ([pricing](https://docs.x.com/x-api/getting-started/pricing)).
Las lecturas se deduplican dentro del día UTC. Ante un 429 o un token
faltante la corrida queda `partial` y no cambia el código de salida del cron.

## Verificación

```bash
python -m unittest discover -s tests -v
# OPT-IN: usa DATABASE_URL real; crea y elimina un candidato temporal.
python -m tests.integration_db
```

La prueba de integración verifica trigger de fuentes, dedupe por URL e ID,
y rollback del lote si una mención pertenece a otro candidato. Requiere la
base y permisos de escritura reales. No se ejecutó contra tu Supabase durante
la generación del código. Las pruebas locales usan feeds de ejemplo simulados.

## Archivos

- `config.py`: entorno y TLS; la carga de candidato/configuración vive en `db.py`.
- `models.py`: candidato, configuración, mención y resultado de fuente.
- `db.py`: consultas parametrizadas, lock y transacción por fuente.
- `urls.py`: normalización, hash, extracción de redirect de Alerts.
- `sources/base.py`: interfaz async común.
- `sources/rss_media.py`: RSS de medios y Google News, caché HTTP y reintentos.
- `sources/google_alerts.py`: RSS configurado de Google Alerts.
- `sources/youtube.py`: YouTube Data API v3, con tope de cuota en el cursor.
- `sources/x.py`: X API v2 recent search, con tope diario en el cursor.
- `sources/gdelt.py`: GDELT DOC 2.0, un pedido cada 5 segundos, con atribución.
- `wikipedia/`: visitas diarias a la ficha en es.wikipedia (API de Wikimedia).
- `collect_rss.py`: comando manual para probar pasos 2–3.

## Límites y decisiones

Se filtra por variantes de nombre, sin acentos ni diferencias de mayúsculas,
con límites de palabra, y después por exclusiones. Se usan título y resumen
RSS; no se descarga el artículo completo. Sin fecha publicada/actualizada válida,
se omite la entrada en vez de inventar una fecha. Feeds XML malformados se
registran como fallidos, conservando el cursor anterior.

La URL se normaliza sin UTM, fragmentos ni identificadores publicitarios,
preservando parámetros funcionales y su orden. Google News usa enlaces opacos:
no se resuelven al artículo original en esta versión. Por eso puede haber dos
menciones de la misma noticia entre Google News y el RSS del medio. No se
promete dedupe semántico. Los enlaces de Google Alerts sí se desenvuelven.

Los duplicados conservan el texto y clasificación de la primera observación;
solo se fusionan métricas recibidas. Los IDs nativos y URLs se comparan por
candidato; el ID nativo también por fuente. Si se modifica un texto de origen,
la actualización/reclasificación queda pendiente de un paso posterior.

Para estas fuentes web, configurar `own_domains` y `reference_domains` por
fuente para marcar contenido propio/de referencia. No se infiere la relación
por afinidad ni se usan `own_accounts` sociales para dominios web. El resto es
third_party. El front futuro debe filtrar esas relaciones para su radar.

RLS: anónimo sin acceso, dueño autenticado solo lectura de datos de producto.
Asignar `owner_user_id` al UUID real de Supabase Auth para habilitar esa lectura.
NULL implica solo servidor. Configuración, URLs privadas de Alerts, cursores y
cuotas no se exponen al front. Nunca usar service role en el navegador.

La validación rechaza URLs con credenciales y destinos no públicos, valida cada
redirect, limita tamaño descomprimido a 5 MB y no usa proxies del entorno.
Los feeds son configuración exclusiva del administrador. Para admitir URLs de
usuarios no confiables hace falta aislamiento de red/egress: el chequeo DNS
previo por sí solo no evita todas las carreras de DNS rebinding.
Errores de feeds omiten URLs/tokens en los logs. RSS se trata como dato externo,
se extrae texto del HTML y no se ejecutan instrucciones ni se llama a IA.

Ver `docs/design.md` para contratos de picos, cuotas, IA y siguientes pasos.
