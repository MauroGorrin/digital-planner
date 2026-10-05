# Planner de Contenido (digital-planner)

Web para que una agencia y sus clientes planifiquen, revisen y aprueben contenido de redes
sociales: calendario compartido, fichas con adjuntos/comentarios, flujo de aprobación con estados,
Google Calendar y webhooks salientes a Make.

## Comandos

| Tarea | Comando |
|---|---|
| Instalar | `npm install` |
| Servidor de desarrollo | `npm run dev` — http://localhost:3000 |
| Build de producción | `npm run build` |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Pruebas unitarias | `npm run test` · un archivo: `npx vitest run tests/unit/webhooks/dispatch.test.ts` |
| Pruebas unitarias (watch) | `npm run test:watch` |
| Cobertura | `npm run test:coverage` |
| Pruebas de integración (Supabase local) | `npm run test:integration` |
| Detener Supabase local | `npm run db:test:stop` |

**Gate:** `npm run typecheck && npm run lint && npm run test && npm run test:integration` debe
pasar antes de marcar cualquier tarea como terminada.

Node fijado en `22.x` (`package.json` → `engines.node`; ver también `.github/workflows/ci.yml`).
Versiones de dependencias viven en `package-lock.json` — léelo, nunca las adivines.

## Stack

Next.js 15 (App Router, Server Actions; `cookies()`, `params` y `searchParams` son asíncronos, y `createClient()` de `lib/supabase/server.ts` también — siempre `await createClient()`) · TypeScript 5.5 (strict) · Tailwind CSS 3.4 · Supabase
(Postgres + Auth + Storage + Realtime, con Row Level Security) · Vitest 5 + jsdom + Testing Library
para pruebas · GitHub Actions para CI · Vercel para hosting.

## Arquitectura

**Camino de una request de aprobación.** Cliente hace clic "Aprobar" en
`components/ContentPieceDetail.tsx` → Server Action `approveContentPiece` en `app/actions.ts` →
`supabase.rpc('approve_content_piece', ...)` (función `SECURITY DEFINER` en
`supabase/migrations/0001_init.sql`, que valida permisos, escribe `status_history` y `approvals`,
y crea notificaciones) → `app/actions.ts` llama después a `lib/webhooks/dispatch.ts` (firma HMAC y
envía a Make) y, si aplica, a `lib/google-calendar/sync.ts` (crea/actualiza el evento).

**La autorización real vive en Postgres, no en la UI.** Cada función de transición de estado
(`submit_for_review`, `approve_content_piece`, `request_changes`, `mark_scheduled`,
`mark_published`, `cancel_content_piece`, `reschedule_content_piece`) es `SECURITY DEFINER` y
valida el rol/pertenencia del llamador con `is_agency()` / `has_client_access()` antes de escribir.
RLS además aísla cada tabla por cliente **y por agencia**: desde
`0010_aislamiento_por_agencia.sql`, `has_client_access(marca)` responde "soy personal de agencia DE
ESTA marca, o contacto de ella", y `mi_agencia()` es con lo que se compara todo lo que cuelga de una
agencia y no de una marca. Nunca dupliques esa lógica de permisos en el cliente
(Server Component o Server Action) como si fuera la fuente de verdad — es una comodidad de UI, no
el control.

**Límites.**

| Capa | Puede importar de | Nunca debe |
|---|---|---|
| `app/**` (rutas, Server Actions) | `components`, `lib` | Construir SQL a mano — siempre vía `supabase.from()`/`supabase.rpc()` |
| `components/**` | `lib`, otros componentes | Llamar `SUPABASE_SERVICE_ROLE_KEY` — esa clave es solo servidor |
| `lib/webhooks/`, `lib/google-calendar/` | `lib/supabase/server.ts` (`createServiceClient`) | Ejecutarse en un componente cliente (`"use client"`) |
| `lib/supabase/server.ts` | nada interno | Exponerse a un módulo con `"use client"` |

**Dónde vive cada cosa.**

| Concepto | Fuente única de verdad |
|---|---|
| Esquema de base de datos, RLS, funciones de transición | `supabase/migrations/0001_init.sql` — nunca editar una migración ya aplicada; agrega una nueva |
| Bucket de adjuntos y sus políticas | `supabase/migrations/0002_storage.sql` |
| Tipos y catálogos (`ContentStatus`, `WebhookEventType`, labels, colores) | `types/database.ts` |
| Firma HMAC de webhooks (`X-Planner-Signature`) | `lib/webhooks/dispatch.ts` |
| Fecha/hora con zona horaria del cliente | `lib/date-utils.ts`, `lib/tz.ts` |
| Sesión y cliente de Supabase en servidor | `lib/supabase/server.ts` (`createClient` con cookies, `createServiceClient` con service role) |
| Rutas públicas (sin sesión) | `lib/supabase/middleware.ts` — hoy `/login`, `/registro`, `/reportes`, `/api/reportes/pdf` y `/grilla/[slug]/[anio]/[mes]` (solo esa forma exacta; `/grilla` a secas es la app). Agregar una ruta pública se hace ahí y solo ahí |
| Link compartible y PDF del reporte de métricas | `lib/reportes.ts` — firma HMAC-SHA256 (`clientId:anio:mes`) con `REPORT_LINK_SECRET`, sin tabla ni columna nueva. La verifica `app/reportes/[clientId]/[anio]/[mes]/page.tsx` y `app/api/reportes/pdf/route.tsx`, los dos con `createServiceClient()` (sin sesión no hay RLS que aplicar, así que la firma ES el control de acceso — nunca selecciones un campo ahí que `app/metricas/page.tsx` no seleccione ya) |
| Validadores del alta pública | `lib/validacion-registro.ts` — los usan el formulario **y** la Server Action; una sola definición |
| Promoción a administrador de agencia | `crear_mi_agencia()` en `supabase/migrations/0011_alta_de_agencia.sql` — el único camino de `client` a `agency_admin` que no pasa por el service role |

**Camino de un alta pública.** `/registro` (`components/FormularioDeRegistro.tsx`) valida con
`lib/validacion-registro.ts` → Server Action `registrarAgencia` en `app/registro-actions.ts`, que
**vuelve a validar con las mismas funciones** y llama a `supabase.auth.signUp()` → Supabase manda el
correo de confirmación → al confirmar, la persona cae en `/`, que reparte (`app/page.tsx`) y la
manda a `/bienvenida` si le falta agencia → `completarAltaDeAgencia` →
`supabase.rpc('crear_mi_agencia')`, que crea la agencia y fija `role`/`agency_id` **en el mismo
update**. `/bienvenida` es idempotente y se puede volver a ella: un alta confirmada pero sin
promover se termina desde ahí en vez de quedar en un callejón sin salida.

## Reglas de código

1. Las funciones de transición de estado son la única forma de cambiar `content_pieces.status`.
   Nunca hagas `update content_pieces set status = ...` directo desde una Server Action.
2. Alias de ruta `@/` → raíz del repo. Nada de `../../..`.
3. `SUPABASE_SERVICE_ROLE_KEY` solo se lee en `lib/supabase/server.ts` (`createServiceClient`) y
   solo en código de servidor (webhooks, Google Calendar). Nunca en un componente `"use client"`.
4. Toda prueba unitaria que toque `lib/webhooks/dispatch.ts` o `lib/google-calendar/sync.ts` debe
   mockear `@/lib/supabase/server` y `global.fetch` — nunca golpear una red real.
5. Las pruebas de integración (`tests/integration/**`) sí usan Postgres real (Supabase local vía
   Docker) — nunca las mockees ni las reemplaces por un doble en memoria; ver
   `.claude/rules/tests.md`.
6. No agregues una dependencia nueva sin una razón en el mensaje de commit. Revisa primero si ya
   existe algo en `lib/` o en las dependencias ya instaladas.
7. `blueprints/digital-planner/` es el bundle de diseño de este cambio, no código de la app —
   ningún comando de lint/typecheck/test debe escanearlo (ya está excluido en cada config).

## Entorno

| Variable | Requerida | Usada por | Origen |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | sí | `lib/supabase/*` | Panel de Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | sí | `lib/supabase/*` | Panel de Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | sí | `lib/supabase/server.ts` (`createServiceClient`) | Panel de Supabase → Settings → API (nunca al navegador) |
| `NEXT_PUBLIC_APP_URL` | sí | notificaciones, webhooks, eventos de calendario | fijo en local: `http://localhost:3000` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | opcional (solo si se usa Google Calendar) | `app/api/google-calendar/*`, `lib/google-calendar/sync.ts` | Google Cloud Console |
| `NEXT_PUBLIC_CAPTCHA_PROVIDER` / `NEXT_PUBLIC_CAPTCHA_SITE_KEY` | opcional (captcha del alta y del inicio de sesión) | `lib/captcha.ts`, `components/Captcha.tsx`, `app/registro-actions.ts`, `app/login/page.tsx` | Cloudflare Turnstile o hCaptcha |
| `REPORT_LINK_SECRET` | opcional (link compartible y PDF del reporte de métricas, y link de la grilla) | `lib/reportes.ts` (firma HMAC-SHA256 de `/reportes/[clientId]/[anio]/[mes]` y `/api/reportes/pdf`) y `lib/grilla-compartir.ts` (firma de `/grilla/[slug]/[anio]/[mes]`, con prefijo `grilla:`) | Generarla con `openssl rand -hex 32`; sin ella, `/metricas` funciona igual pero sin los botones de compartir |

**Sobre el captcha:** se enciende **solo si las dos variables están puestas** (`turnstile` o
`hcaptcha` como proveedor). Sin ellas `/registro` y `/login` funcionan igual, sin widget — a
propósito: la app no puede depender de una clave que hoy nadie ha contratado, y la Supabase local de
las pruebas lo tiene apagado (las pruebas de integración inician sesión con `signInWithPassword`, que
con el captcha encendido rebotaría). **Las dos mitades van juntas:** estas variables solo dibujan el
widget y mandan el token; quien lo *verifica* es el proyecto de Supabase, con el mismo proveedor y su
clave **secreta** en el panel (Authentication → Settings → Bot and Abuse Protection).

**Qué llamadas cubre, y por qué importa.** Encendido en el panel, GoTrue exige `captcha_token` en
`/signup`, `/token?grant_type=password` (y `web3`), `/otp`, `/magiclink`, `/recover`, `/resend`,
`/sso` y las opciones de passkey; **no** en `refresh_token`, `pkce` ni `id_token`, ni en llamadas con
la clave de servicio. Fuente: `verifyCaptcha` e `isIgnoreCaptchaRoute` en
`internal/api/middleware.go` y las rutas de `internal/api/api.go` de `supabase/auth`, y comprobado
contra la Supabase local (gotrue v2.196.0) encendiéndolo a mano: `signUp`, `signInWithPassword`,
`resetPasswordForEmail` y `signInWithOtp` sin token devuelven
`400 captcha_failed … (no captcha_token found)`; `refreshSession` y `updateUser` con sesión pasan.
En esta app las llamadas afectadas son **dos**: `signUp` en `app/registro-actions.ts` y
`signInWithPassword` en `app/login/page.tsx`, y las dos mandan el token. No hay recuperación de
contraseña, OTP ni enlace mágico; **si agregas uno, tiene que mandar el token igual** o quedará roto
el día que el captcha esté encendido. `crearUsuario` usa `auth.admin.createUser` con la clave de
servicio y queda exento.

**El orden para encenderlo en producción, y no otro:**
1. Desplegar con `NEXT_PUBLIC_CAPTCHA_PROVIDER` y `NEXT_PUBLIC_CAPTCHA_SITE_KEY` puestas en Vercel.
   El widget aparece en `/login` y `/registro` y el token viaja, aunque Supabase todavía no lo mire.
2. Comprobar que **el inicio de sesión sigue funcionando** en producción con esa versión.
3. **Solo entonces** activar el captcha en el panel de Supabase con la clave **secreta** del mismo
   proveedor.

Al revés —panel primero— **deja fuera a todo el mundo, dueño incluido**: cualquier
`signInWithPassword` sin token rebota con `captcha_failed`, y no hay forma de entrar a la app para
arreglarlo (se apaga desde el panel). Las sesiones ya abiertas sobreviven, porque renovar el token no
pide captcha.

`.env.example` está commiteado y se mantiene sincronizado. `.env*` con valores reales nunca se
commitea. `.env.test.local` (generado por `scripts/write-supabase-test-env.mjs` para
`npm run test:integration`) tampoco se commitea — ya está cubierto por el patrón `.env*.local`
existente en `.gitignore`.

## Reglas

| Archivo | Aplica a |
|---|---|
| `.claude/rules/tests.md` | `tests/**`, `vitest.config.ts`, `vitest.setup.ts`, `scripts/write-supabase-test-env.mjs` |

## No negociable

1. Nunca cambies `content_pieces.status` fuera de las funciones `SECURITY DEFINER` de
   `supabase/migrations/0001_init.sql` — es donde vive `status_history` y las notificaciones.
2. Nunca expongas `SUPABASE_SERVICE_ROLE_KEY` a un componente cliente ni a un log.
3. Nunca edites una migración ya aplicada (`0001_init.sql`, `0002_storage.sql`) — agrega una nueva.
4. Nunca mockees la base de datos en `tests/integration/**` ni la Supabase local en
   `tests/unit/**` reemplacen los mocks por llamadas reales.
5. Nunca marques una tarea terminada con el gate de comandos en rojo.
6. Nunca commitees `.env`, `.env.local` ni ningún archivo con secretos reales.
7. **El registro público está abierto en local y cerrado en producción, y esos dos sitios son
   independientes.**
   - `supabase/config.toml` configura **solo la Supabase local** (`supabase start` /
     `supabase db reset`), que es donde corren `npm run test:integration` y el desarrollo. Ahí
     `enable_signup = true` desde `0011_alta_de_agencia.sql`, porque `/registro` y sus pruebas
     necesitan que `/auth/v1/signup` responda.
   - **Producción vive en el panel de Supabase** (Authentication → Sign In / Providers) y **nada de
     este repositorio la cambia**. Sigue cerrada. Abrirla es una decisión del dueño, posterior a su
     propia auditoría de aislamiento; no la tomes por él ni se la propongas como un paso pendiente.
     Mientras el panel diga `false`, `/registro` se dibuja y el alta devuelve error: ese es el
     estado esperado, no un bug.
   - Lo que hace que abrirlo deje de ser la vulnerabilidad de `0007`: el alta pública **no reparte
     permisos**. `handle_new_user()` crea todo perfil como `'client'` sin agencia y no lee el rol de
     `raw_user_meta_data` (no la toques). La promoción a `agency_admin` pasa por
     `crear_mi_agencia()` (`0011_alta_de_agencia.sql`), que vuelve a comprobar en la base las tres
     precondiciones — ser `client`, no tener `agency_id`, y **no ser contacto de ninguna marca** —
     y crea una agencia **vacía**, no acceso a la de nadie más.
   - La confirmación de correo está **encendida en producción y tiene que seguir así**: es lo único
     que prueba que la dirección es de quien se registra. En local está apagada porque
     `[local_smtp]` no está levantado y no habría enlace que entregar.
8. Nunca cambies `profiles.role`, `profiles.agency_id`, `clients.agency_id`,
   `content_pieces.status`, `ideas.status`, el `client_id` de una pieza o de una idea, ni el
   `agency_id` de una conexión de Google o de un webhook con un `update` desde la app.
   `0010_aislamiento_por_agencia.sql` (que sustituye al bloque de `0009_agencias.sql`, que a su vez
   sustituía al de `0007_endurecimiento_privilegios.sql`) le quitó a `authenticated` el permiso
   sobre esas columnas, así que el intento falla con `42501`: el único camino son las funciones
   `SECURITY DEFINER` y el cliente de servicio.

9. Nunca autorices una fila con `is_agency()` o `is_agency_admin()` a secas. Las dos responden "soy
   personal de agencia", una pregunta sin marca y por lo tanto sin aislamiento. Acompáñalas siempre
   de `has_client_access(<fila>.client_id)` si la fila cuelga de una marca, o de una comparación
   contra `mi_agencia()` si cuelga de una agencia. El porqué de cada sitio existente está en
   `docs/superpowers/auditoria-aislamiento-0010.md`; si agregas uno nuevo, agrégale su fila.

## Si agregas una columna a `profiles`, `clients`, `content_pieces`, `ideas`, `google_calendar_connections` o `webhook_configs`

El bloque de privilegios de columna — hoy en `0010_aislamiento_por_agencia.sql`, antes en `0009` y
antes en `0007` — revoca el permiso de tabla y lo vuelve a otorgar **columna por columna**,
excluyendo las protegidas. Eso tiene un costo que conviene conocer antes de toparse con él: **una
columna nueva nace sin permiso para `authenticated`, y la app no podrá escribirla** hasta que el
bloque se vuelva a ejecutar. La lista se calcula dinámicamente desde `pg_attribute`, así que
re-aplicarlo es todo el arreglo.

**Re-aplica `0010_aislamiento_por_agencia.sql`, no `0009` ni `0007`.** Cada uno reejecuta el mismo
bloque con el conjunto protegido ampliado, así que **volver a pegar uno anterior deshace las
protecciones nuevas en silencio**: `0009` no conoce `google_calendar_connections.agency_id` ni
`webhook_configs.agency_id`, y `0007` tampoco conoce `profiles.agency_id` ni `clients.agency_id`. Si
agregas una columna que haya que proteger, agrégala a la lista de `0010`.

Si una escritura nueva falla con `42501` justo después de que agregaste una columna, esta es la
causa y no un problema de RLS.
