# Pulso — recolector, pasos 1 a 3

Python 3.12+, PostgreSQL de Supabase y adaptadores RSS, Google News y Google
Alerts. Las demás fuentes y la IA siguen apagadas y sin implementar.
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
6. Ejecutar desde la carpeta raíz del proyecto:

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
