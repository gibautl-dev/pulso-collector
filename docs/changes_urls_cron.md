# Cambios acotados: proxy, Google News y cron

## 1. Política de URLs configurable

`PULSO_URL_SECURITY_MODE=strict` conserva el chequeo DNS/IP público.
`allowlist` permite omitirlo solo para hosts exactos en
`PULSO_URL_ALLOWED_HOSTS=news.google.com,medio.example`.
`off` omite DNS/IP para todos los destinos. Se mantienen HTTP(S), rechazo de
credenciales y puertos 80/443. La política se aplica a cada salto, incluidos
los del editor al resolver Google News. Usar off solo con feeds y entorno confiables.

`PULSO_HTTP_TRUST_ENV=true` habilita el proxy HTTP(S) del entorno, además de
certificados configurados en SSL_CERT_FILE/SSL_CERT_DIR. Configurar HTTPS_PROXY,
HTTP_PROXY o ALL_PROXY y NO_PROXY en el servidor; no incluir sus credenciales
al versionar archivos. No desactiva TLS. La conexión Postgres no usa esos proxies.

## 2. Google News antes de guardar

Se soportan redirects HTTP, codificación antigua con URL embebida y el formato
moderno con firma/timestamp y RPC de Google. Este RPC no es una API estable.
Se sigue el destino del editor antes de normalizar, hashear y atribuir el dominio.
Si el editor bloquea el acceso o Google cambia el protocolo, no se guarda el
link opaco: se registra fallo parcial y no se conserva caché HTTP del feed,
para reintentar. Puede haber más requests por noticia; no se garantiza resolución
universal. No se descarga texto del artículo para la mención.

La atribución usa `own_domains`/`reference_domains` de cada fuente. Para el caso
bonaerense, ejecutar SOLO si el contenido de gba.gob.ar debe contarse como propio
del candidato en cuestión (reemplazar el slug):

```sql
update public.candidate_sources
set settings=jsonb_set(settings,'{own_domains}',
  coalesce(settings->'own_domains','[]'::jsonb) || '["gba.gob.ar"]'::jsonb)
where candidate_id=(select id from public.candidates where slug='SLUG_REAL')
  and source in ('google_news','rss_media','google_alerts');
```

No se infiere propiedad política por ser un sitio gubernamental. Se incluyen
subdominios del dominio configurado. Reejecutar con `--refresh` para reprocesar
las entradas que aún estén en el feed: una mención Google News previa se corrige
al reencontrar su ID. No hay barrido ni borrado retroactivo de duplicados viejos
que ya existan como filas distintas. Variantes de URL y sindicación también
pueden requerir dedupe editorial posterior.

## 3. Cron con salida a Postgres

Se mantiene psycopg, transacciones y advisory lock por candidato. No se cambia
a REST porque escribir menciones, cursores y ejecuciones atómicamente requeriría
una función RPC y una nueva estrategia de locks.

Subir esta carpeta como raíz de un repositorio privado. Crear un Blueprint de
Render usando `render.yaml`; completar `DATABASE_URL` y `PULSO_CANDIDATE` en el
panel. Render construye `Dockerfile` y ejecuta el contenedor con cron
`*/20 * * * *`. La imagen no incluye .env ni secretos. Configurar los feeds y
aplicar el esquema existente antes del primer run. Usar conexión Supabase directa
con IPv6 disponible o pooler de sesión para IPv4, con sslmode=require o superior;
no pooler transaccional. La red debe permitir salida a su host/puerto Postgres.

También sirve como cron de un servidor con Docker: ejecutar la imagen cada
20 minutos inyectando las variables en tiempo de ejecución. No se ha desplegado
ningún servicio ni creado recursos externos. El cron cubre las tres fuentes RSS
actuales; las otras fuentes siguen apagadas. Si una corrida tarda más de 20 minutos,
el lock impide recolección simultánea para el mismo candidato.

## Verificación

`python -m unittest discover -s tests -v`

Las pruebas de resolución usan respuestas simuladas, incluidos RPC moderno,
redirects y fallo de resolución. Sin credenciales/red de producción no se
validó Google News en vivo, Render ni Supabase real.
