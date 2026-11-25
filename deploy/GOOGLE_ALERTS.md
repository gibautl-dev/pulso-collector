# Google Alerts para Pulso

El adaptador ya existe (`pulso/sources/google_alerts.py`): lee los RSS de
`candidates.alert_feeds` cuando `candidate_sources` tiene `google_alerts`
habilitado. **No hace falta código nuevo.** Hay que crear las alertas a mano
y pegar las URLs. Nadie más que el dueño de la cuenta de Google debe iniciar
sesión. No se inventa ni se pide una contraseña.

## Cómo crear cada alerta

1. Entrar a [https://www.google.com/alerts](https://www.google.com/alerts) con
   la cuenta de Active Marketing (la que use Leandro).
2. Pegar la consulta exacta de la lista de abajo (con comillas).
3. Abrir **Mostrar opciones** y dejar:
   - **Con qué frecuencia:** a medida que se publiquen (As-it-happens).
   - **Fuentes:** automático.
   - **Idioma:** español.
   - **Región:** Argentina (Kicillof y Milei) o España (Sánchez).
   - **Cuántos:** todos los resultados.
   - **Entregar a:** **RSS feed** (no el correo).
4. Crear la alerta. Aparece un icono de RSS: copiar esa URL
   (`https://www.google.com/alerts/feeds/...`). Es un enlace privado; no
   publicarlo ni pegarlo en el chat.
5. Cuando estén las URLs, se cargan en la base (una sola transacción, después
   de revisarlas) con el SQL del final. Hasta entonces la fuente sigue apagada.

## Lista exacta de alertas

Las consultas siguen las keywords ya cargadas para cada candidato. Los
arrobos de X no se usan acá: Google Alerts busca en la web, no en X.

### Axel Kicillof (región: Argentina)

| # | Consulta (pegar tal cual) |
|---|---------------------------|
| 1 | `"Axel Kicillof"` |
| 2 | `"Kicillof"` |

Dos alertas, no una sola con OR: el formulario de Alerts es más predecible
con una frase por feed. El recolector acepta varios feeds por candidato.

### Javier Milei (región: Argentina)

| # | Consulta (pegar tal cual) |
|---|---------------------------|
| 1 | `"Javier Milei"` |
| 2 | `"Milei"` |

### Pedro Sánchez (región: España)

Ojo: “Sánchez” solo trae mucho ruido (futbolistas y homónimos). Se usan las
exclusiones que ya tiene el candidato, con el operador `-`.

| # | Consulta (pegar tal cual) |
|---|---------------------------|
| 1 | `"Pedro Sánchez"` |
| 2 | `"Sánchez" -"Alexis Sánchez" -"Hugo Sánchez" -"Arantxa Sánchez" -"Sánchez Vicario" -"Manu Sánchez" -"Curro Sánchez" -"Ona Sanchez" -"Sánchez Pizjuán" -"Sánchez-Pizjuán"` |

Si la segunda de Sánchez trae demasiado ruido, se puede dejar solo la primera
y avisar. El recolector también vuelve a filtrar con las exclusiones al leer
el feed.

## Dónde pegar las URLs

No editar `alert_feeds` a mano en producción sin backup. Primero, en el SQL
Editor:

```sql
select slug, alert_feeds
  from public.candidates
 where slug in ('axel-kicillof', 'milei', 'pedro-sanchez');
```

Guardar el resultado. Después, reemplazando cada `URL_...` por el feed
copiado (sin mostrar esas URLs en el chat):

```sql
begin;

update public.candidates
   set alert_feeds = array[
     'URL_KICILLOF_AXEL',
     'URL_KICILLOF_APELLIDO'
   ]
 where slug = 'axel-kicillof';

update public.candidates
   set alert_feeds = array[
     'URL_MILEI_JAVIER',
     'URL_MILEI_APELLIDO'
   ]
 where slug = 'milei';

update public.candidates
   set alert_feeds = array[
     'URL_SANCHEZ_PEDRO',
     'URL_SANCHEZ_APELLIDO'
   ]
 where slug = 'pedro-sanchez';

update public.candidate_sources cs
   set enabled = true,
       updated_at = now()
  from public.candidates c
 where cs.candidate_id = c.id
   and c.slug in ('axel-kicillof', 'milei', 'pedro-sanchez')
   and cs.source = 'google_alerts';

commit;
```

`source_catalog` ya tiene `google_alerts` (apagada por defecto). El trigger
crea la fila en `candidate_sources`; este UPDATE solo la enciende cuando hay
feeds. Para apagarla: `enabled = false` en esas filas, sin borrar los feeds.

El recolector ya está cableado: en la próxima corrida, si la fuente está
habilitada y hay URLs, lee esos RSS. Costo: 0 (el feed es gratuito).
