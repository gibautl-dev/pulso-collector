# Comparación de rivales

Migración: `deploy/candidate_rivals.sql`. **Aplicada** en pulso-demo el 2026-11-24.

## Qué creó

- Tabla `public.pulso_staff` (`user_id` → `auth.users`). Quién del equipo de Active puede asignar rivales. La primera fila se inserta a mano en el SQL editor; la app no da de alta usuarios ni invita.
- Tabla `public.candidate_rivals` (`candidate_id`, `rival_id`, `level` en `radar` | `comparativo` | `completo`). El rival tiene que ser otro candidato ya existente en Pulso.
- RLS:
  - Un miembro del candidato A ve solo las filas de rivales de A.
  - Ese miembro puede leer de B, si B está asignado como rival de A, y solo lo que permite el nivel: Radar (menciones de medios), Comparativo (menciones + anuncios), Completo (además respuestas de IA y cuentas sospechosas). También puede leer `id`, `slug` y `name` de B, y los temas de B. No ve keywords, cuentas propias ni configuración de fuentes.
  - El staff ve el directorio de candidatos y puede crear, editar y borrar asignaciones. No hay escritura de rivales para un cliente.
- La web, si las tablas todavía no existen, no escribe nada: el panel informa que falta la migración y la vista de comparación queda vacía.

## Costo estimado

- Aplicar el SQL: **USD 0**. No crea recursos de pago, no llama APIs, no corre el recolector.
- Si el rival **ya es un candidato de Pulso** con recolección andando (como los que hoy están en la base): **USD 0 extra**. La comparación usa los datos que ya se juntan. Esta rama no agrega fuentes, no sube el tope de X ni prende más llamadas de IA.
- Si más adelante se quisiera sumar un rival que **todavía no se recolecta**, eso sería dar de alta un candidato nuevo, con el mismo costo de recolección que cualquier otro (tope diario de X, clasificación, anuncios de Meta si la región lo permite, y visibilidad en IA si está prendida, que es la parte más cara cuando usa búsqueda web). Esta rama no implementa ni enciende esa recolección. Habría que pedirle aprobación a Leandro antes de sumar fuentes pagas.

El panel de esta migración lista los candidatos que ya existen para que Active elija. Las sugerencias de IA y las altas pendientes están en una migración posterior, `deploy/rival_suggestions.sql` (ver `RIVAL_SUGGESTIONS.md`), todavía no aplicada.
