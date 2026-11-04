# Propuesta de despliegue de la web (no aplicada)

## Recomendación: Render Web Service, plan Starter

- Mismo workspace que el cron `pulso-rss`. Servicio Node, `rootDir: web`.
- Build: `npm ci && npm run build` · Start: `npm run start` (Next usa `$PORT`).
- Health check: `/login`.
- Región: Virginia (us-east), igual que el cron. Supabase está en sa-east-1;
  Render no tiene región en Sudamérica.

| Plan | Precio (render.com/pricing, 04/11/2026) | Para Pulso |
| --- | --- | --- |
| Free | USD 0 · 512 MB | Se duerme tras ~15 min sin tráfico; la primera carga tarda ~1 min. Sirve para probar, no para una demo de venta. |
| Starter | USD 7/mes · 512 MB · <1 CPU, prorrateado por segundo | Recomendado: siempre encendido, TLS y dominio propio. |
| Standard | USD 25/mes · 2 GB · 1 CPU | Solo si crece el uso. |

Workspace Hobby: USD 0 + compute (5 GB de ancho de banda incluidos).
Total estimado con el cron actual: ~USD 7–9/mes.

Alternativa: Vercel. El plan Hobby es solo para uso no comercial, así que
para un cliente correspondería Pro (pago por usuario). Render mantiene todo
en un lugar.

## Variables de entorno

| Variable | Valor | Secreta |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://bkjugpesqbplnaeotadh.supabase.co` | No |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` (Supabase → Settings → API Keys) | No (pública por diseño) |
| `PULSO_SITE_URL` | URL pública, p. ej. `https://pulso-web.onrender.com` | No |
| `NODE_VERSION` | `24` | No |

Las `NEXT_PUBLIC_*` tienen que estar al momento del build. **No** setear
`PULSO_DATA_SOURCE` ni ninguna service role/secret key.

## Supabase Auth (dashboard, antes de invitar a nadie)

1. Authentication → Sign In / Providers: **desactivar "Allow new users to sign up"**
   (hoy está activado). Aun así, sin membresía no se ve ningún dato.
2. URL Configuration: Site URL = `PULSO_SITE_URL`; Redirect URLs:
   `PULSO_SITE_URL/auth/confirm` (y `http://localhost:3000/auth/confirm` para desarrollo).
3. Email templates:
   - Magic Link: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
   - Invite user: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`
4. Ejecutar `deploy/web_permissions.sql` en el SQL editor.
5. Invitar usuarios (Authentication → Users → Invite) y darles acceso con el
   `insert into candidate_members …` del final del script.
6. El SMTP integrado de Supabase tiene un límite bajo de emails por hora; para
   más de un puñado de usuarios, configurar SMTP propio.

## Repo

`gibautl-dev/pulso-collector` es **público**. El código de la web no tiene
secretos y el fixture de datos no se commitea, pero conviene volverlo privado
(la rama del clasificador incluye títulos y etiquetas de menciones reales).
Render puede desplegar un repo privado una vez vinculada la cuenta de GitHub.
