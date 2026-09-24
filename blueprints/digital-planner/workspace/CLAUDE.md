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

Next.js 14 (App Router, Server Actions) · TypeScript 5.5 (strict) · Tailwind CSS 3.4 · Supabase
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
RLS además aísla cada tabla por cliente. Nunca dupliques esa lógica de permisos en el cliente
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
