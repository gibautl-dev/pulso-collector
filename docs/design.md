# Contratos de implementación

## Fuentes y cobertura

El cron futuro podrá despertar cada 20 minutos; cada fuente decide si está
vencido su intervalo. YouTube tendrá un intervalo mínimo de 3600 segundos,
SERP 86400. Habilitar una fuente requiere configuración explícita, adaptador
y validación de permisos/cuotas vigentes; una clave no la habilita.

`candidate_sources` conserva el cursor independiente del historial de corridas.
Avanzarlo solo tras persistir los elementos de una página correctamente.
`collection_started_at` registra la primera ejecución real. `requested_since`
registra el horizonte solicitado; `earliest_observed_at` y `latest_observed_at`
registran extremos de datos vistos, sin prometer cobertura continua.
`baseline_started_at` marca el inicio de recolección continua que puede servir
para comparar períodos. Un backfill parcial no adelanta esa fecha.
`coverage_status` distingue unknown/partial/complete; complete solo se permite
cuando el proveedor garantiza el intervalo (`coverage_from`, `coverage_to`).
La primera versión RSS debe informar cobertura parcial. El front mostrará
fuentes, inicio de recolección y límites de cobertura; no inventará historia.

## Menciones y agrupación

`account_relation`: third_party, own o reference. Solo third_party entra por
defecto al radar de menciones y reputación. La relación se determina por cuentas
configuradas, no por el tono. `target`: candidate, other, unclear. Un ataque a
otra persona no cuenta automáticamente como crítica al candidato.
Tono describe el texto publicado, no intención, afiliación ni opinión pública.
Comentarios son elementos separados con URL/ID propios. No mezclar su tono con
el del post. URL canónica sin fragmentos ni parámetros de tracking para dedupe;
conservar parámetros que identifican contenido. Hash SHA-256 hexadecimal.

## Cuotas y gastos

`daily_usage` usa un scope `global` (credencial compartida) o `candidate`.
Permite reservar unidades y gasto ANTES de llamar a una API en una transacción
con bloqueo de fila; confirmar consumos reales y liberar reservas al finalizar.
No aplicar el límite solo después de descargar. Controlar ambos scopes cuando
corresponda. La cuota de YouTube es global a la credencial/proyecto.
No usar precios del brief como tarifas vigentes: verificarlos al habilitar.
Los días de cuota usan la zona de reinicio del proveedor (`reset_timezone`),
no necesariamente Buenos Aires. `candidate_id` NULL identifica scope global.
Gastos en USD, NUMERIC; los límites NULL significan sin límite configurado,
no permiso para activar una fuente paga. Las fuentes pagas requerirán límites
explícitos antes de habilitarse. Presupuesto de backfill comparte contadores.

## Pico

Al instante T: actual = [T-24h,T); base = [T-8d,T-24h).
Promedio diario base = cantidad base / 7, incluyendo días en cero.
Pico si actual >= 10 y actual > 2 * promedio diario base.
Si promedio=0 y hay historia suficiente, ese criterio también puede dar pico;
la razón numérica será NULL para evitar división por cero.
Sin ocho días de cobertura comparable: estado insufficient_history, sin pico.
Considerar solo third_party, fuentes comparables y mismo candidato/tema.
El backfill parcial no demuestra ocho días de cobertura. Las vistas futuras
usarán security_invoker para conservar RLS del usuario consultante.

## IA y operación futuras

Todo texto recolectado es dato externo no confiable. Nunca concatenarlo como
instrucción de sistema ni obedecer instrucciones, enlaces o pedidos contenidos
en él. Enviarlo como campos de datos delimitados; sin herramientas, secretos ni
capacidad de ejecutar acciones. Validar JSON con modelos estrictos, IDs contra
la tanda enviada, fragmentos de evidencia contra el texto y URLs contra las
fuentes proporcionadas. No inferir afinidad política de personas. No inventar
hechos ni fuentes. Salida insuficiente: informativo, confianza baja, target unclear.
Guardar versión de modelo y prompt. Borradores siempre requieren revisión humana.

Usar lock por candidato durante toda la corrida en la misma sesión PostgreSQL.
Aislar errores por fuente, registrar errores sin secretos y respetar Retry-After.
No loguear DATABASE_URL, tokens ni URLs privadas de Google Alerts.
Brief diario futuro: 07:00 America/Argentina/Buenos_Aires. No se programa en paso 1.
