# Despliegue de la web en Render

## Servicio

- Mismo workspace que el cron `pulso-rss`. Servicio Node, `rootDir: web`
  (en la práctica el build es `cd web && npm ci && npm run build` porque
  el alta por API no aceptó `rootDir`).
- Start: `cd web && npm run start` (Next usa `$PORT`).
- Health check sugerido: `/login`.
- Región: Virginia (us-east), igual que el cron. Supabase está en sa-east-1;
  Render no tiene región en Sudamérica.
- Plan: Starter (USD 7/mes). Auto-deploy off: un push a `main` no publica
  solo; hay que disparar el deploy a mano. No tocar el cron `pulso-rss`.

| Plan | Precio (render.com/pricing, 04/11/2026) | Para Pulso |
| --- | --- | --- |
| Free | USD 0 · 512 MB | Se duerme tras ~15 min sin tráfico; la primera carga tarda ~1 min. Sirve para probar, no para una demo de venta. |
| Starter | USD 7/mes · 512 MB · <1 CPU, prorrateado por segundo | Recomendado: siempre encendido, TLS y dominio propio. |
| Standard | USD 25/mes · 2 GB · 1 CPU | Solo si crece el uso. |

Workspace Hobby: USD 0 + compute (5 GB de ancho de banda incluidos).
Total estimado con el cron actual: ~USD 7–9/mes.

Servicio actual: `pulso-web` (`srv-dbllfgt9fdbs73c2o570`),
URL `https://pulso-web-re4x.onrender.com`.

## Variables de entorno

| Variable | Valor | Secreta |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://bkjugpesqbplnaeotadh.supabase.co` | No |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` (Supabase → Settings → API Keys) | No (pública por diseño) |
| `PULSO_SITE_URL` | URL pública, `https://pulso-web-re4x.onrender.com` | No |
| `NODE_VERSION` | `24` | No |

Las `NEXT_PUBLIC_*` tienen que estar al momento del build. **No** setear
`PULSO_DATA_SOURCE` ni ninguna service role/secret key.

## Supabase Auth

Configurado en el panel:

1. Authentication → Sign In / Providers: **"Allow new users to sign up"
   desactivado**. Aun así, sin membresía no se ve ningún dato (la app
   muestra un mensaje pidiendo acceso).
2. URL Configuration: Site URL = `PULSO_SITE_URL`
   (`https://pulso-web-re4x.onrender.com`). Redirect URLs:
   `https://pulso-web-re4x.onrender.com/auth/confirm` y
   `http://localhost:3000/auth/confirm` (desarrollo).

### Plantillas de email (las de fábrica)

Se usan las plantillas **por defecto** de Supabase (`{{ .ConfirmationURL }}`).
No se pueden editar sin SMTP propio. Ese link pasa por `/auth/v1/verify` y
después redirige a la app:

- **Magic link** (desde `/login`, con PKCE de `@supabase/ssr`): vuelve a
  `PULSO_SITE_URL/auth/confirm?code=…`. La app canjea el código con
  `exchangeCodeForSession`. `emailRedirectTo` apunta a ese mismo path.
- **Invitación** (Authentication → Users → Invite, flujo implícito): los
  tokens vienen en el `#hash` (`access_token` y `refresh_token`), que el
  servidor no puede leer. Supabase puede devolver a la **Site URL** (`/`)
  o a `/auth/confirm` si hay `redirect_to`. En ambos casos un componente
  cliente lee el hash, llama a `setSession` y manda al tablero. Los errores
  del hash (`error_description`) se muestran en español.

### Alternativa con SMTP propio (`token_hash`)

Si más adelante se configura SMTP propio y se editan las plantillas, la
app también acepta este formato en `/auth/confirm`:

- Magic Link: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
- Invite user: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`

### Invitar usuarios

1. Authentication → Users → Invite. El SMTP integrado de Supabase manda
   **pocos emails por hora** y **solo a direcciones del equipo de la
   organización** en el proyecto. Para invitados externos hace falta SMTP
   propio.
2. Dar acceso al candidato (después de que acepte la invitación):

```sql
insert into public.candidate_members (candidate_id, user_id)
select c.id, u.id from public.candidates c, auth.users u
where c.slug = 'axel-kicillof' and u.email = 'leandrog@activemkt.com'
on conflict do nothing;
```

3. Permisos: `deploy/web_permissions.sql` (ya aplicado).

## Repo

`gibautl-dev/pulso-collector` es **público**. El código de la web no tiene
secretos y el fixture de datos no se commitea, pero conviene volverlo privado
(la rama del clasificador incluye títulos y etiquetas de menciones reales).
No hacerlo todavía: el vínculo Render–GitHub está roto y un repo privado
rompería los deploys.
