# Pulso web (v1)

App web de **Pulso by Active Marketing**: tablero de escucha y reputación del
candidato, feed de menciones, detalle con la explicación de la IA y salud de
fuentes. Next.js 16 (App Router, TypeScript) + Tailwind 4 + `@supabase/ssr`.

## Seguridad

- **Sin acceso público.** El `proxy.ts` refresca la sesión y manda a `/login` a
  quien no esté autenticado; cada página vuelve a validar el JWT con
  `supabase.auth.getClaims()` (nunca `getSession()` en el servidor).
- **Login solo por invitación**: link mágico por email con
  `shouldCreateUser: false`. La respuesta es la misma exista o no la cuenta.
- **Datos vía RLS**: la app usa solo la *publishable key* y la sesión del
  usuario. Nunca la service role (la app se niega a arrancar si detecta una
  `sb_secret_`/service_role). Permisos en `../deploy/web_permissions.sql`
  (**no ejecutado todavía**): membresía `candidate_members`, solo SELECT,
  columnas sensibles fuera, `anon` sin nada.
- Cabeceras: `X-Frame-Options: DENY`, `noindex`, `nosniff`, etc.
- Los links a notas salen con `rel="noopener noreferrer nofollow"`.

## Pantallas

| Ruta | Qué muestra |
| --- | --- |
| `/login` | Ingreso por link mágico |
| `/c/[slug]` | Tablero: KPIs, volumen diario por tono, tono **solo con target = candidato**, temas, medios, críticas y acusaciones destacadas (7/14/30 días) |
| `/c/[slug]/menciones` | Feed con filtros (tono, sobre quién, tema, fuente, relevancia, fechas) y búsqueda; cada ítem enlaza a la fuente |
| `/c/[slug]/menciones/[id]` | Detalle: razón de la IA, confianza, modelo, versión de prompt |
| `/c/[slug]/fuentes` | Estado por fuente y últimas `source_runs` |

Las fechas se muestran en hora de Argentina. Solo `account_relation = third_party`
entra al tablero. Las críticas con `target = other` no cuentan en contra.

## Desarrollo local

```bash
cp .env.example .env.local   # completar URL y publishable key
npm ci
npm run dev                  # http://localhost:3000 (pide login)
```

Sin usuarios ni permisos aplicados, se puede probar con datos exportados:

```bash
PULSO_DATA_SOURCE=fixture PULSO_FIXTURE_PATH=/ruta/fixture.json npm run dev
```

El modo fixture saltea el login, **solo atiende `localhost`** y se niega a
correr si detecta Render/Vercel/etc. El JSON **no** va al repo (datos de cliente).

## Chequeos

```bash
npm run check        # typecheck + lint + tests (vitest)
PULSO_LIVE_TEST=1 npx vitest run tests/live-anon.test.ts   # humo contra Supabase real, sin sesión
npm run screenshots -- http://localhost:3100 http://localhost:3101 ./screens
```

`tests/permissions.sql.test.ts` aplica `schema.sql` + `deploy/web_permissions.sql`
en un Postgres embebido (PGlite) y verifica qué puede leer un miembro, un
usuario sin membresía y `anon`.

## Despliegue

Ver `../deploy/WEB_RENDER.md`.
