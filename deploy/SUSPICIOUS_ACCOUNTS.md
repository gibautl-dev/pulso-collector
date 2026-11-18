# Cuentas sospechosas

Detección local, estilo Cyabra, **sin denunciar**. El detector marca cuentas con
puntaje, motivos y evidencia para que una persona revise y, si corresponde,
denuncie a mano en X o YouTube. Nunca hay denuncia en lote ni automática, y el
código no actúa sobre las redes.

La migración `deploy/suspicious_accounts.sql` es una propuesta: **no está
aplicada**. No habilitar el cron (`PULSO_SUSPICIOUS_ENABLED=true`) hasta
aplicarla. El detector corre después de la recolección, sin LLM, leyendo solo
menciones ya guardadas.

## Cómo se activa (cuando se apruebe)

1. Revisar y aplicar `deploy/suspicious_accounts.sql` en el SQL Editor de
   Supabase (proyecto pulso-demo). Hacer backup previo. No corre solo.
2. Setear `PULSO_SUSPICIOUS_ENABLED=true` en el cron `pulso-rss` y redesplegar.
3. Hasta entonces, `python -m pulso.suspicious --from-json menciones.json --dry-run`
   corre en local, sin escribir en la base.

## Señales (baratas, sin LLM)

| Señal | Cuándo | Peso |
|---|---|---|
| `self_repeat` | El mismo autor repite un texto (o uno casi idéntico, ratio ≥ 0,88). Mínimo 3; 2 si el texto tiene ≥ 40 caracteres normalizados | 15–35 |
| `coordination` | ≥ 3 autores del mismo candidato y plataforma con el mismo texto (≥ 40 caracteres). Las consignas cortas no cuentan | 25–50 |
| `author_burst` | ≥ 5 publicaciones en 1 hora, o ≥ 8 en 6 horas, del mismo autor | 20 |
| `group_burst` | ≥ 5 cuentas ya débiles (nuevas, mala relación de seguidos o muchos dígitos) publican en 60 minutos | 15 |
| `new_account` | `author_created_at` de X: < 30 días (+25) o < 90 días (+15). En YouTube hoy no hay fecha de canal | 15–25 |
| `follow_ratio` | Pocos seguidores (< 80) y muchos seguidos (≥ 150), relación ≥ 8 a 1 | 10–20 |
| `digit_name` | Handle o nombre con ≥ 4 dígitos (12 si hay ≥ 6). En YouTube se mira el @ visible, no el channel id | 10–12 |
| `low_engagement` | ≥ 5 publicaciones y promedio de likes+reposts ≤ 1 | 10 |

Se marca la cuenta si el puntaje llega a 20. Cuentas con ≥ 10.000 seguidores o
verificadas de tipo business/government no reciben las señales baratas
(`new_account`, ratio, dígitos, engagement bajo) para no ensuciar con medios.

Se analizan posts de X y **comentarios** de YouTube (`metrics.video_id`). No se
analizan videos de YouTube ni menciones `own`/`reference`. El upsert conserva
el estado de revisión humano (`pending`, `reviewed_suspicious`, `discarded`,
`reported_manual`).

## Propuesta de vista web (no implementada)

Ruta: `/c/[slug]/sospechosas`. Ítem nuevo en la nav, junto a Tablero, Menciones
y Salud de fuentes.

Pantalla:

- Filtros: estado, plataforma (X / YouTube), puntaje mínimo, búsqueda por handle.
- Tabla o lista ordenada por puntaje: handle, nombre, plataforma, puntaje,
  señales (chips: “texto repetido”, “cuenta nueva”, “relación de seguidos”…),
  cantidad de menciones, fechas de primera/última aparición y de creación de la
  cuenta si está.
- Al expandir una fila: motivos con peso, extractos coincidentes, IDs y links
  de las menciones, timestamps. Un link al perfil
  (`https://x.com/{handle}` o el canal de YouTube) para **denunciar a mano** en
  esa red. El botón de Pulso no denuncia: solo abre el perfil.
- Acciones de revisión, explícitas y de a una cuenta: marcar *revisada
  sospechosa*, *descartada* o *denunciada a mano*, con una nota opcional.
  No hay “denunciar todas” ni acción masiva.
- Estados en español en la UI: pendiente, revisada sospechosa, descartada,
  denunciada a mano. En la base se guardan en inglés
  (`pending`, `reviewed_suspicious`, `discarded`, `reported_manual`).

Permisos: `authenticated` lee por `candidate_members`. Actualizar el estado es
una excepción documentada al modelo de solo lectura de la web: el grant es
solo sobre `status`, `status_note`, `status_updated_at` y `status_updated_by`,
y un trigger rechaza cambios a puntaje, señales u otras columnas. `anon` no
ve nada. El recolector escribe puntaje y evidencia y no pisa el estado humano.

## Limitaciones

- YouTube: los comentarios no traen fecha de creación del canal, seguidores,
  seguidos ni foto. El handle suele ser el channel id; el `@` visible queda en
  `author` cuando existe. La señal `digit_name` usa ese `@`, no el channel id. No se pueden aplicar `new_account`, `follow_ratio` ni
  “sin foto” sin una consulta extra a la API de YouTube (no se hace acá).
- X: el recolector no pide `profile_image_url`, así que “sin foto” tampoco está
  disponible. `author_created_at`, seguidores y seguidos sí vienen en las
  menciones ya guardadas. No se hacen lecturas extra de usuarios.
- El volumen actual es chico (una primera recolección de X y pocos comentarios
  de YouTube). Las señales de repetición, coordinación y ráfaga de un autor
  necesitan más menciones para aparecer. El umbral y los pesos se pueden
  ajustar cuando haya historia.
- Casi-duplicados: se comparan huellas en un mismo prefijo de 16 caracteres
  (SequenceMatcher ≥ 0,88). No es un modelo semántico; parafraseos fuertes no
  se detectan, a propósito, para no usar LLM.
- No hay cruce entre plataformas ni grafos de retweets/respuestas (X está
  configurado sin retweets ni respuestas).
- Un falso positivo no denuncia a nadie: queda en pendiente hasta que una
  persona lo revise.

## Costo extra

Cero llamadas a X o YouTube y cero tokens de LLM. Solo CPU local sobre filas
ya guardadas, en el mismo cron, con timeout propio (120 s por defecto) y sin
cambiar el código de salida de la recolección. El costo marginal en el plan
Starter de Render es despreciable con el volumen actual.

Si más adelante se quisiera la fecha de creación de canales de YouTube o la
foto de perfil de X, habría que enriquecer autores con lecturas extra
(unidades de YouTube Data API / User Lookup de X, USD 0,010 por usuario inédito
en el día UTC). Eso no forma parte de esta propuesta.
