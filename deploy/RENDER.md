# Preparación de Pulso en Render — sin despliegue ejecutado

Base: proyecto con URLs configurables, resolución de Google News y fallback ante
403 del editor. Este paquete solo cambia archivos necesarios para desplegar.
No aplica SQL, crea repositorios, crea servicios ni carga secretos.

## Cambios y motivo

| Archivo | Cambio | Motivo |
|---|---|---|
| Dockerfile | Python 3.12 slim-bookworm, sin buffer de stdout, sin bytecode | Base de distribución explícita y logs inmediatos |
| requirements-render.txt | Dependencias directas/transitivas fijadas con SHA-256 | Evitar resolver versiones diferentes en cada build |
| Dockerfile | Instala con --require-hashes; copia solo paquete pulso; UID/GID 65534 | Imagen sin secretos ni herramientas de build del proyecto; ejecución no root |
| Dockerfile | PGOPTIONS con statement_timeout=30000 y lock_timeout=5000 | Limitar consultas a 30 s y espera de locks SQL a 5 s |
| pulso/deploy_run.py | Supervisor de proceso con deadline de 900 s | Máximo 15 min por corrida, incluido DNS/HTTP/Postgres; deja margen al cron |
| pulso/deploy_run.py | SIGTERM/SIGINT al grupo hijo, SIGKILL tras 10 s | Detener el recolector y liberar conexión/locks al terminar el proceso |
| pulso/deploy_run.py | Logs JSON de inicio, fin, duración y exit code | Detectar corridas caídas incluso si no pudieron escribir source_runs |
| render.yaml | Cron Docker cada 20 min, secretos sin valores, auto-deploy off | Configuración revisable, sin credenciales en Git |
| render.yaml | PULSO_DRY_RUN=true inicialmente | Validar sin escribir menciones al crear el servicio en el futuro |
| deploy/collector_permissions.sql | Rol de backend y políticas RLS específicas | El esquema original solo habilita front/service_role; el usuario custom necesita permisos |
| tests/test_deploy_run.py | Prueba de timeout y propagación de errores | Verificar el supervisor sin tocar servicios reales |

HTTP conserva timeout de 20 s por operación, tres intentos en errores transitorios
y límite de 5 MB por respuesta. Postgres conserva connect_timeout=15 s.
El timeout global cubre una corrida con muchos feeds/reintentos. Exit codes:
0 correcto o lock ocupado; 1 fallos/resultado parcial; 2 configuración/supervisor;
124 timeout global; 143 cancelación. Los logs de fuentes siguen siendo JSON.
Si hay timeout, las transacciones ya confirmadas permanecen; la transacción en
curso se revierte al cerrarse la conexión. No existe una fila source_runs para
una fuente que murió antes de guardar; revisar también el log del supervisor.

La imagen base queda fijada a rama/distribución, no a digest inmutable: obtiene
parches al reconstruir. Para congelar bytes de la base, registrar un digest real
después del primer build revisado. No se inventa un digest en estos archivos.

## Variables de Render

Formato recomendado: separar contraseña del DSN. Libpq/psycopg lee PGPASSWORD
si DATABASE_URL no incluye contraseña; no se agregan parsers de contraseñas.

```text
DATABASE_URL=postgresql://pulso_collector.PROJECT_REF@POOLER_HOST:5432/postgres?sslmode=require
PGPASSWORD=CONTRASEÑA_REAL_SIN_CODIFICAR
```

Copiar POOLER_HOST del panel Supabase > Connect > Session pooler para el proyecto
sa-east-1. Tendrá formato `aws-INDICE-sa-east-1.pooler.supabase.com`: el índice
no se puede deducir de la región, no asumir aws-0. PROJECT_REF es el identificador
real del proyecto, no su nombre. El usuario del pooler es
`pulso_collector.PROJECT_REF`, aunque el rol SQL es `pulso_collector`.
Usar puerto 5432 de **sesión**; 6543 transaccional no conserva advisory locks.

| Variable | Obligatoria | Valor recomendado / formato |
|---|---|---|
| DATABASE_URL | Sí | URI de arriba, sin contraseña, sslmode=require; secreto/config privada de servidor |
| PGPASSWORD | Sí con URI sin contraseña | Contraseña cruda del rol pulso_collector, cargada solo en Environment del servicio |
| PULSO_CANDIDATE | Sí para el CMD del contenedor | Slug exacto que ya existe en candidates, por ejemplo candidato-demo |
| PULSO_URL_SECURITY_MODE | No; declarada | strict; allowlist para excepciones exactas justificadas; off solo en entorno/feeds confiables |
| PULSO_URL_ALLOWED_HOSTS | No | Vacío normalmente; en allowlist, hosts separados por coma sin esquema ni path, p. ej. news.google.com,medio.example |
| PULSO_HTTP_TRUST_ENV | No; declarada | false en Render sin proxy; true si se configura proxy/certificado del entorno |
| PULSO_RUN_TIMEOUT_SECONDS | No; declarada | 900; admite enteros 1..1100, antes de los 20 min de cron |
| PULSO_DRY_RUN | No; declarada | true para primera prueba; false para producción con escritura |
| PGOPTIONS | No; imagen define | -c statement_timeout=30000 -c lock_timeout=5000; libpq lo consume, se puede sobreescribir en Environment |
| PYTHONUNBUFFERED | No; imagen define | 1, para logs inmediatos |
| PYTHONDONTWRITEBYTECODE | No; imagen define | 1, evita escribir bytecode como usuario sin privilegios |
| HTTP_PROXY / HTTPS_PROXY / ALL_PROXY | Solo si hay proxy | URI del proxy; secreto si lleva credenciales; requiere PULSO_HTTP_TRUST_ENV=true |
| NO_PROXY | Solo si hay proxy | Lista de hosts excluidos del proxy, según la red del servidor |
| SSL_CERT_FILE / SSL_CERT_DIR | Solo si hay CA privada para HTTP | Ruta a certificado/directorio montado en servidor, con trust_env=true; TLS no se desactiva |

Alternativa compatible: contraseña percent-encoded dentro de DATABASE_URL y no
configurar PGPASSWORD. No usar ambas con valores distintos. Render no sustituye
`${PGPASSWORD}` escrito dentro de una URI: el DSN recomendado simplemente omite
la contraseña y libpq toma la variable separada. No pasar secretos en comandos,
Docker ARG/ENV del repo, render.yaml, capturas o logs.

Variables del .env.example **no usadas por este recolector**: SUPABASE_URL,
SUPABASE_SERVICE_ROLE_KEY, PULSO_TIMEZONE, PULSO_LOG_LEVEL, X_BEARER_TOKEN,
YOUTUBE_API_KEY, META_ACCESS_TOKEN, META_IG_USER_ID, SERPAPI_KEY, LLM_API_KEY,
LLM_BASE_URL, LLM_MODEL. No cargarlas en Render para esta etapa. El código actual
no implementa nivel de logs por PULSO_LOG_LEVEL. Cron es UTC y corre a :00/:20/:40;
para una frecuencia cada 20 minutos no cambia el resultado por zona horaria.
PIP_DISABLE_PIP_VERSION_CHECK=1 es solo una opción de la imagen para instalación.

## Permisos y contraseña del usuario

1. Confirmar que el schema.sql inicial ya fue aplicado. No repetirlo.
2. Revisar `deploy/collector_permissions.sql` y ejecutarlo como administrador.
   El script crea el rol si falta y concede solo SELECT/INSERT/UPDATE de las
   tablas usadas. No concede DELETE, BYPASSRLS, permisos de front o administración.
   Es un backend confiable con acceso a todos los candidatos; no usar en navegador.
   Si el rol ya existía, revisar que no tenga membresías/privilegios adicionales:

```sql
select rolname,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb
from pg_roles where rolname='pulso_collector';
select pg_get_userbyid(roleid) as inherited_role
from pg_auth_members where member=(select oid from pg_roles where rolname='pulso_collector');
```

3. Si ya tiene contraseña válida, conservarla. Si falta, conectar con psql como
   administrador (sin contraseña en argumentos/historial; permitir prompt) y usar:

```text
\password pulso_collector
```

   Este comando pide la nueva contraseña dos veces, sin guardarla en un archivo
   SQL del repo. Guardarla en tu gestor de contraseñas y en PGPASSWORD de Render.
   No confundirla con la contraseña del rol postgres ni con una API key.
4. Si Supabase tiene restricciones de red, permitir la salida del servicio según
   las IP de egreso reales que muestre Render para la región elegida. Probar TCP
   al host del pooler y puerto 5432. Un proxy HTTP no transporta esta conexión.

## Pasos de conexión — ejecutar solo cuando se autorice desplegar

**Ahora detenerse después de preparar/revisar archivos y repo. Crear el Blueprint
aprovisiona recursos y puede activar cron y facturación; no se hizo en esta tarea.**

1. Aplicar los archivos de este ZIP sobre el proyecto actual, conservando el fix
   403. Subir el proyecto completo a un repo privado con esta carpeta como raíz.
   Verificar que no se versionaron .env ni credenciales. El ZIP es incremental,
   no contiene todo el proyecto. render.yaml y Dockerfile van en la raíz del repo.
2. Preparar Supabase, rol y candidato/feeds con los pasos anteriores. La propiedad
   de dominios (por ejemplo gba.gob.ar) sigue en candidate_sources.settings.
3. En Render: New > Blueprint, conectar proveedor Git, repo privado y rama;
   seleccionar render.yaml. Revisar que sea un Cron Job Docker llamado pulso-rss,
   schedule `*/20 * * * *`, y recursos/costo antes de crear. No duplicar con otro
   Cron Job manual. Elegir región disponible teniendo en cuenta latencia a sa-east-1;
   el host de base debe seguir siendo el copiado de Supabase.
4. Completar los placeholders DATABASE_URL, PGPASSWORD y PULSO_CANDIDATE en Render.
   sync:false evita escribir sus valores en YAML. Dejar PULSO_DRY_RUN=true durante
   la primera validación. Cargar secretos con el panel Environment, no con Git.
   No importar íntegro un .env que tenga claves de otros servicios.
5. Cuando se autorice crear/desplegar, revisar el Build: la instalación debe
   verificar hashes. En Runs > Trigger Run lanzar una prueba cuando ninguna otra
   corrida esté activa. El CMD ejecuta el supervisor y el recolector; no usar un
   comando Docker alternativo que evite el timeout. Los runs programados que se
   disparen mientras dry-run esté activo también serán sin escritura.
6. Revisar logs: cron_started, filas dry_run por fuente, feeds_ok>0, sin errores,
   cron_finished con exit_code=0. Una búsqueda legítima puede devolver cero
   menciones. El dry-run requiere conexión y permisos de lectura/lock, pero no
   demuestra permisos de escritura.
7. Para prueba con escritura, cambiar PULSO_DRY_RUN a false en render.yaml, subir
   el commit, sincronizar Blueprint y desplegar explícitamente; mantener coherente
   el valor en el panel. autoDeployTrigger=off evita deploy automático por cada
   push, pero no es un interruptor del cron ya activo. Confirmar que la nueva
   configuración se aplicó y disparar una corrida manual sin otra en ejecución.
8. Verificar filas y cursores con las consultas de abajo. Esperar las próximas
   ejecuciones de 20 minutos y confirmar nuevos timestamps aunque items_new sea 0.
   No hace falta cambiar el cron ni crear una automatización de ChatGPT.
9. Ante fallo persistente, suspender el Cron Job desde Render; autoDeploy off no
   lo suspende. Revisar permisos, pooler/usuario, DSN y DNS/proxy; no imprimir DSN.

## Verificación en Supabase (SQL Editor como administrador)

Reemplazar SLUG_REAL en cada consulta:

```sql
select m.source,m.title,m.url,m.account_relation,m.published_at,m.collected_at
from public.mentions m join public.candidates c on c.id=m.candidate_id
where c.slug='SLUG_REAL' order by m.collected_at desc limit 25;

select r.source,r.started_at,r.finished_at,r.status,r.items_found,r.items_new,r.error
from public.source_runs r join public.candidates c on c.id=r.candidate_id
where c.slug='SLUG_REAL' order by r.started_at desc limit 25;

select s.source,s.enabled,s.last_attempt_at,s.last_success_at,s.next_run_at
from public.candidate_sources s join public.candidates c on c.id=s.candidate_id
where c.slug='SLUG_REAL' order by s.source;
```

Esperado: source_runs recientes con ok/partial documentado, tiempos crecientes y
menciones con URL del editor. Repetir no debe duplicar URL/ID. No pegar cursores
completos en capturas: pueden contener URLs privadas de Alerts. Con todos los
feeds sin novedades puede haber items_new=0; eso no prueba una falla.

## Logs y costos

Render > servicio > Runs: estado y log de cada ejecución. Builds: errores de
imagen/dependencias. En el workspace, revisar Billing y consumo del servicio;
controlar duración y plan contratado. Hay 72 horarios diarios: en 30 días son
2160 ejecuciones. Compute aproximado = 2160 × duración media en segundos ×
tarifa por segundo del plan, sujeto al mínimo mensual vigente; no multiplicar
por 720 horas de servidor continuo. La documentación consultada indica cobro
por segundo activo y mínimo USD 1/mes por cron; confirmar tarifa en el panel
antes de crearlo. En Supabase revisar Billing/Usage y conexiones/recursos de base.
RSS/Google News no activan APIs pagas ni IA en este código.

## Validación y límites de esta entrega

Ejecutar `python -m unittest discover -s tests -v`. Se verificaron dependencias
con hashes en un entorno Python 3.12 limpio y tests locales del supervisor y
recolector. No se construyó Docker aquí (no hay motor Docker), no se ejecutó el
SQL en Supabase ni se validó un Blueprint contra una cuenta Render. Revisar
esas tres cosas antes de considerar el despliegue probado de punta a punta.

Fuentes consultadas (2026-11-03):
- https://render.com/docs/cronjobs
- https://render.com/docs/blueprint-spec
- https://render.com/docs/configure-environment-variables
- https://supabase.com/docs/guides/database/connecting-to-postgres
