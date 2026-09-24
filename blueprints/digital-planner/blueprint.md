# Planner de Contenido — Blueprint de cambio (brownfield)

> Generado por The Architect el 2026-09-24
> Forma: saas-webapp (existente) · `knowledge/shapes/saas-webapp.md`
> Track de runtime: ts-node (existente, npm) · `knowledge/runtime-tracks/ts-node.md`
> Modo de emisión: bundle
> Versión del blueprint: 1
> Versiones verificadas por última vez: 2026-09-24 — ver §11 para la procedencia por paquete

**Tipo de cambio:** brownfield, aditivo. Cierra brechas de higiene de ingeniería (pruebas, CI,
tooling de agente, preparación de despliegue) sobre una aplicación Next.js + Supabase completamente
funcional. **No se propone reescribir ni reestructurar código de aplicación que ya funciona.**

---

## 1. Resumen del proyecto y no-objetivos

### Current state (estado actual — verificado leyendo el repo real, no asumido)

Repositorio clonado en `C:/Users/Usuario/AppData/Local/Temp/claude/C--Users-Usuario/a0fb3815-2c97-4e2f-92fd-8e91c8a8a1b5/scratchpad/digital-planner`
(GitHub: `MauroGorrin/digital-planner`), rama `claude/keen-carson-d36rdn`, un commit (`af06711`).

**Aplicación web responsive** para que una agencia de marketing y sus clientes planifiquen, revisen
y aprueben contenido para redes sociales: calendario visual compartido, fichas de contenido con
adjuntos y comentarios, flujo de aprobación con estados, integración con Google Calendar, y
webhooks salientes hacia Make. Las 6 entregas de la especificación original están implementadas y
funcionando:

1. Login + roles (`agency_admin`, `agency_member`, `client`) vía Supabase Auth + tabla `profiles`.
2. Gestión de clientes (`app/clientes/*`, `client_assignments`, `client_contacts`).
3. Calendario mensual + semanal (`components/CalendarBoard.tsx`, drag&drop nativo, sin librería de
   calendario de terceros).
4. Ficha de contenido con adjuntos (bucket privado `attachments` en Supabase Storage) y
   comentarios en hilo.
5. Flujo de aprobación con 7 estados: `borrador → pendiente_revision → (aprobado |
   cambios_solicitados) → programado → publicado`, más `cancelado` en cualquier punto salvo
   publicado. Las transiciones viven en funciones `SECURITY DEFINER` de Postgres
   (`submit_for_review`, `approve_content_piece`, `request_changes`, `mark_scheduled`,
   `mark_published`, `cancel_content_piece`, `reschedule_content_piece`), cada una escribe en
   `status_history` (append-only) y crea notificaciones.
6. Integración con Google Calendar preparada (`app/api/google-calendar/*`,
   `lib/google-calendar/sync.ts` — upsert vía `calendar_event_links` para evitar duplicados) y
   webhooks de Make preparados (`lib/webhooks/dispatch.ts` — firmados con HMAC-SHA256, header
   `X-Planner-Signature`, registrados en `webhook_deliveries`).

**Modelo de datos:** 16 tablas Postgres (`profiles`, `clients`, `client_assignments`,
`client_contacts`, `content_pieces`, `attachments`, `comments`, `status_history`, `approvals`,
`google_calendar_connections`, `client_calendar_mappings`, `calendar_event_links`,
`webhook_configs`, `webhook_deliveries`, `notifications`, `notification_settings`), todas
protegidas con Row Level Security, definidas en `supabase/migrations/0001_init.sql`
(esquema+RLS+funciones) y `0002_storage.sql` (bucket privado `attachments` + políticas de
storage). RLS aísla los datos de cada cliente **a nivel de base de datos**, no solo en la UI — este
es un no-negociable de este blueprint (ver §5, "Interfaces held constant").

**Árbol de archivos actual** (confirmado leyendo el repo): `app/` (rutas + Server Actions
`actions.ts`/`admin-actions.ts`), `components/` (19 componentes), `lib/supabase/`
(client/server/middleware), `lib/webhooks/dispatch.ts`, `lib/google-calendar/sync.ts`,
`lib/date-utils.ts`, `lib/tz.ts`, `middleware.ts`, `supabase/migrations/`, `types/database.ts`.

**Brechas verificadas ausentes** (esto es exactamente lo que este blueprint cierra):

| Brecha | Confirmado por |
|---|---|
| Sin test runner, sin archivos de prueba en todo el repo | `find` sobre el árbol completo — cero coincidencias de `*.test.*`/`*.spec.*` |
| Sin pipeline de CI (`.github/workflows` no existe) | `ls -la` en la raíz del repo |
| Sin `CLAUDE.md` / `AGENTS.md` / `.claude/` en el repo | `ls -la` en la raíz del repo |
| Sin target de despliegue declarado, sin `vercel.json`, sin versión de Node documentada para producción | `ls -la` + lectura de `package.json` (sin campo `engines`) |
| Sin `supabase/config.toml` (config de Supabase CLI para desarrollo local ausente) | `ls supabase/` — solo `migrations/` |
| **`next lint` nunca fue configurado** — sin `eslint` en `package-lock.json`, sin `.eslintrc*` en ningún lado del repo, aunque `package.json` ya declara `"lint": "next lint"` | `grep` sobre `package-lock.json` y búsqueda de archivos `*eslintrc*` — cero coincidencias en ambos casos |

Esta última fila es un hallazgo de este blueprint, no parte de la lista de brechas que se recibió:
en Next.js 14.2.35, `next lint` sin ninguna configuración de ESLint presente **imprime un prompt
interactivo** ("No ESLint configuration detected...") pidiendo elegir Strict/Base/Cancel. Un
`npm run lint` así, ejecutado sin TTY (CI, o cualquier gate automatizado), se queda colgado
esperando una respuesta que nunca llega. Como `npm run lint` es invocado por prácticamente todos
los comandos `Verify` de este blueprint y por el pipeline de CI que este mismo blueprint agrega,
esta brecha se cierra explícitamente en el Paso 2 (§9) — de lo contrario, cada gate de este
blueprint heredaría un cuelgue silencioso.

### Target state (estado objetivo — lo que produce el build order de este blueprint)

El mismo código de aplicación, **sin tocar** — nunca se propone reescribir código que ya funciona —
más:

1. Una suite de pruebas con Vitest cubriendo la lógica pura de mayor riesgo: firma HMAC de
   webhooks (`lib/webhooks/dispatch.ts`), manejo de fecha/hora consistente con zona horaria
   (`lib/date-utils.ts`, `lib/tz.ts`), lógica de upsert-sin-duplicado de Google Calendar
   (`lib/google-calendar/sync.ts`, HTTP mockeado), y una prueba de **integración** que corre las
   funciones reales `SECURITY DEFINER` de transición de estado contra una instancia local de
   Supabase (vía Supabase CLI + Docker) — esta es la compuerta de la capa de datos.
2. `supabase/config.toml` agregado para que `supabase start` funcione en local y en CI.
3. CI con GitHub Actions (`.github/workflows/ci.yml`): lint (`next lint`) + typecheck
   (`tsc --noEmit`) + `vitest run` + build en cada push/PR, Node 22.
4. `CLAUDE.md` + `AGENTS.md` + `.claude/settings.json` + una skill en `.claude/skills/` que
   documenta la máquina de estados de aprobación y el catálogo de eventos de webhook como
   referencia repetible para futuras sesiones de agente.
5. Verificación de build de producción + config de despliegue en Vercel: confirmar que
   `next build` funciona, documentar las variables de entorno requeridas para Vercel (a partir de
   `.env.example`), fijar Node 22 como la versión de Node del proyecto en Vercel.
6. Salto de runtime: `@types/node` → `^22.x`, y en cada lugar donde se declara la versión de Node
   (CI, ajustes de Vercel, `engines` en `package.json`) se apunta a **Node 22**, decidido PORQUE
   Vercel deshabilita Node 20 para despliegues nuevos el **2026-10-01** (7 días desde hoy,
   confirmado en vivo por `stack-researcher` contra
   https://vercel.com/changelog/node-js-20-is-being-deprecated) — este es un plazo externo real,
   citado aquí como la razón, no un salto de versión arbitrario. Track A (Node 22) fue **confirmado
   por el usuario** tras mostrarle este plazo.

**El corolario del hallazgo de ESLint** también entra en el estado objetivo: `npm run lint`
funciona de forma no interactiva en local y en CI (Paso 2, §9).

### Usuarios

| Persona | Qué viene a hacer | Frecuencia |
|---|---|---|
| Administrador de agencia | Gestiona clientes, equipo, webhooks, Google Calendar; aprueba nada (eso es del cliente) | Diaria |
| Miembro de equipo de agencia | Crea/edita piezas, ve el calendario de todos los clientes | Diaria |
| Contacto de cliente (`client`) | Ve solo su marca, aprueba o solicita cambios, comenta | Semanal |

*(Sin cambios — este blueprint no toca la superficie de usuario. Documentado aquí solo como
contexto que el builder necesita para entender qué está protegiendo la prueba de integración del
Paso 6.)*

### Objetivos — alcance de este cambio

1. El proyecto tiene una suite de pruebas ejecutable que cubre la lógica de mayor riesgo (firma de
   webhooks, fecha/hora, upsert de calendario) y la capa de datos (funciones `SECURITY DEFINER`).
2. `npm run lint`, `npm run typecheck`, `npm run test` y `npm run test:integration` corren de forma
   no interactiva y en verde, en local y en CI.
3. Cada push/PR dispara CI en GitHub Actions con Node 22.
4. El repo tiene tooling de agente (`CLAUDE.md`, `AGENTS.md`, `.claude/`) que documenta la máquina
   de estados y el catálogo de webhooks para sesiones futuras.
5. `npm run build` está verificado, y la documentación de despliegue en Vercel (variables de
   entorno + versión de Node) está lista antes del plazo de deprecación de Node 20 en Vercel
   (2026-10-01).

### No-objetivos — explícitamente fuera de alcance para este cambio

| No se construye | Por qué no ahora | Revisar cuando |
|---|---|---|
| Pruebas E2E de navegador (Playwright) | Diferido — la prueba de integración de Vitest contra Postgres real más CI ya cubre la lógica de mayor riesgo (transiciones de estado, comportamiento adyacente a RLS a nivel de función) a un costo mucho menor. | Si alguna vez una regresión llega a producción sin haber sido detectada por la suite actual. |
| Envío real de correo transaccional (SMTP o disparado por Make) | Fuera de alcance — depende de un proveedor que el usuario aún no eligió; los payloads de webhook ya llevan todo lo que un paso externo de correo necesitaría (según el README existente). | Cuando se elija un proveedor de correo. |
| Cualquier rediseño de UI/UX o funcionalidad de producto nueva | Este blueprint cierra brechas de higiene de ingeniería únicamente, no una funcionalidad nueva. | Cuando se abra un blueprint de producto separado. |
| Subir la versión mayor de Next.js/React/Supabase | Fuera de alcance — solo el tooling nuevo (Vitest, Testing Library, etc.) recibe pines de versión frescos; el stack de la aplicación existente se reporta tal cual está instalado, sin re-pinearlo. | Cuando exista una razón de producto o de seguridad para subir de mayor, en un blueprint separado. |
| Nombres/columnas de las 16 tablas, firmas de las 7 funciones `SECURITY DEFINER`, valores de `content_status`, valores de `webhook_event_type`, header `X-Planner-Signature`, mecanismo de dedup de `calendar_event_links`, cada ruta pública bajo `app/`, cada Server Action en `app/actions.ts`/`app/admin-actions.ts`, cada variable de entorno en `.env.example` | Estas son las interfaces congeladas de este blueprint — ver §5, "Interfaces held constant". Cambiarlas es trabajo de otro blueprint. | Nunca dentro de este blueprint. |

**El builder no debe implementar nada de esta tabla**, aunque parezca una adición pequeña mientras
trabaja en un paso adyacente. Si un paso pareciera requerir un no-objetivo, eso es un defecto de
este blueprint — detente y repórtalo en vez de expandir el alcance.

### Métricas de éxito

| Métrica | Objetivo | Cómo se mide |
|---|---|---|
| `npm run test && npm run test:integration` en verde | Exit 0, 0 fallos, 0 omitidas | El comando mismo, corrido desde la raíz del proyecto |
| CI verde en cada push/PR | 100% de los runs del workflow `CI` en verde tras el merge del Paso 10 | Pestaña "Actions" de GitHub |
| `npm run build` exitoso con Node 22 | Exit 0, antes del 2026-10-01 | El comando mismo + `package.json` `engines.node` |

---

## 2. Stack tecnológico

**Track de runtime: ts-node (existente).** Esta tabla nombra *elecciones*, no versiones — cada pin
vive en §11 y en ningún otro lugar.

| Capa | Elección | Por qué esta, sobre qué otra |
|---|---|---|
| Lenguaje / runtime | TypeScript 5.5 (strict) sobre Node 22 | Ya instalado; Node 22 reemplaza a Node 20 por el plazo de deprecación de Vercel (§1) — no se evaluó otra alternativa, es una obligación externa con fecha |
| Framework | Next.js 14.2.35 (App Router, Server Actions) | Ya instalado y funcionando; este blueprint no sube de mayor (no-objetivo) |
| Estilos | Tailwind CSS 3.4 (config JS, no CSS-first) | Ya instalado; no aplica el conflicto de `stack-compatibility.md` entre linter-que-parsea-CSS y motor CSS-first, porque Tailwind v3 no usa `@theme` |
| Base de datos | Supabase Postgres 15, con RLS | Ya instalado; aislamiento por cliente a nivel de base de datos, no solo UI |
| Acceso a datos | `@supabase/supabase-js` + `@supabase/ssr` | Ya instalados; sin ORM — el esquema vive en SQL puro en `supabase/migrations/` |
| Auth | Supabase Auth (`profiles` extiende `auth.users`) | Ya instalado; RLS lee el JWT de la sesión directamente |
| Trabajo en segundo plano | Ninguno (Server Actions síncronas + funciones Postgres) | Sin cambios — no en alcance |
| Pagos | NOT APPLICABLE | Este producto no cobra directamente; fuera de alcance de este cambio |
| Almacenamiento de archivos | Supabase Storage (bucket privado `attachments`) | Ya instalado |
| Email / notificaciones | Notificaciones in-app vía Supabase Realtime; el envío de correo real es un no-objetivo | Sin cambios |
| Testing (NUEVO en este blueprint) | Vitest 5 + jsdom + Testing Library (unitario) · Vitest + Supabase CLI local vía Docker (integración) | Alineado con el track `ts-node` (`knowledge/capabilities/testing.md`); Vitest es el runner que el track recomienda y el único que se instala en este cambio |
| CI (NUEVO en este blueprint) | GitHub Actions | El repo ya vive en GitHub (`MauroGorrin/digital-planner`); cero fricción de plataforma |
| Hosting | Vercel | Ya es el target implícito (Next.js + `.env.example` con convenciones de Vercel); este blueprint lo hace explícito (§12) |
| Gestor de paquetes | npm (existente, `package-lock.json` `lockfileVersion: 3`) | El repo ya usa npm — no se introduce pnpm ni ningún otro gestor en un cambio brownfield aditivo |

### Verificación de compatibilidad

Revisado contra `knowledge/stack-compatibility.md` — ninguna combinación conocida como mala
aplica. La fila más cercana ("linter que parsea CSS + motor CSS-first con at-rules propios") NO
aplica: este repo usa Tailwind CSS **v3** con `tailwind.config.ts` (config en JS, no CSS-first
`@theme`), y el lint es ESLint (`next lint`), no Biome — el conflicto documentado es específico de
Biome + Tailwind v4. La fila de "dos sistemas de identidad" tampoco aplica: un solo proveedor de
auth (Supabase Auth). Ninguna otra fila del known-bad table es relevante para un cambio que solo
agrega tooling de pruebas/CI/despliegue.

---

## 3. Estructura de directorios

### Current state

```
digital-planner/
  app/                       # rutas (App Router) y Server Actions
    actions.ts                 # Server Actions de piezas de contenido (transiciones, webhooks, calendario)
    admin-actions.ts           # Server Actions de administración (clientes, equipo, webhooks config)
    ajustes/page.tsx
    api/
      auth/signout/route.ts
      export/csv/route.ts
      google-calendar/{connect,callback,disconnect}/route.ts
    calendario/page.tsx
    clientes/{page.tsx,nuevo/page.tsx,[id]/page.tsx}
    pendientes/page.tsx
    piezas/{nueva/page.tsx,[id]/page.tsx,[id]/editar/page.tsx}
    login/page.tsx
    layout.tsx
    page.tsx
    globals.css
  components/                # 19 componentes compartidos (calendario, ficha, formularios, notificaciones)
  lib/
    auth.ts
    date-utils.ts
    tz.ts
    supabase/{client.ts,server.ts,middleware.ts}
    webhooks/dispatch.ts
    google-calendar/sync.ts
  supabase/
    migrations/{0001_init.sql,0002_storage.sql}
  types/database.ts
  middleware.ts
  next.config.mjs
  tailwind.config.ts
  postcss.config.js
  tsconfig.json
  package.json
  package-lock.json
  .env.example
  .gitignore
  README.md
```

### Target state (Delta)

Todo lo de arriba, **sin cambios de contenido salvo los 4 archivos editados que se listan abajo**,
más los archivos nuevos que agrega este blueprint:

```
digital-planner/
  .eslintrc.json              # NUEVO — Paso 2 — next/core-web-vitals + ignora blueprints/**
  vitest.config.ts            # NUEVO — emitido por Bootstrap (§19.6) — jsdom, alias "@", excluye blueprints/**
  vitest.setup.ts             # NUEVO — emitido por Bootstrap (§19.6) — jest-dom + cargador de .env.test.local
  scripts/
    write-supabase-test-env.mjs   # NUEVO — Paso 6 — lee `supabase status -o json`, escribe .env.test.local
  tests/
    unit/
      smoke.test.tsx              # NUEVO — Paso 3
      webhooks/dispatch.test.ts   # NUEVO — Paso 4
      lib/
        date-utils.test.ts        # NUEVO — Paso 5
        tz.test.ts                 # NUEVO — Paso 5
        google-calendar-sync.test.ts   # NUEVO — Paso 7
    integration/
      state-transitions.test.ts   # NUEVO — Paso 6
  supabase/
    config.toml                 # NUEVO — emitido por Bootstrap (§19.6)
  .github/
    workflows/ci.yml            # NUEVO — emitido por Bootstrap (§19.6)
  CLAUDE.md                    # NUEVO — emitido por Bootstrap (§19)
  AGENTS.md                    # NUEVO — emitido por Bootstrap (§19)
  .claude/
    settings.json               # NUEVO — emitido por Bootstrap (§19)
    skills/approval-flow-webhooks/SKILL.md   # NUEVO — emitido por Bootstrap (§19)
    rules/tests.md              # NUEVO — emitido por Bootstrap (§19)
  package.json                 # EDITADO — Pasos 1, 2, 3, 6: scripts + devDependencies
  package-lock.json            # EDITADO — regenerado por cada npm install
  tsconfig.json                # EDITADO — Paso 1: exclude += "blueprints"
  README.md                    # EDITADO — Pasos 8, 10: secciones CI y Despliegue en Vercel
  blueprints/digital-planner/  # este bundle — nunca escaneado por lint/typecheck/test (ver §19.6)
```

**Reglas de límite**
- Nada bajo `app/**` importa directamente de otra ruta que no sea a través de `components/` o
  `lib/` — regla existente, sin cambios.
- `lib/supabase/server.ts` es el único lugar que lee `SUPABASE_SERVICE_ROLE_KEY` — regla
  existente, sin cambios.
- **Nuevo en este blueprint:** ningún archivo bajo `tests/unit/**` puede hacer una llamada de red
  real ni tocar Postgres real — debe mockear `@/lib/supabase/server` y `global.fetch`. Solo
  `tests/integration/**` toca Postgres real (Supabase local vía Docker). Ver
  `.claude/rules/tests.md`.

Este blueprint no declara ninguna convención de import/resolución nueva (alias de path, condición
de export, forma de especificador) — el proyecto ya usa `"paths": { "@/*": ["./*"] }` en
`tsconfig.json` sin cambios, y `vitest.config.ts` espeja ese mismo alias (§19.6). Por eso §19.6
marca la matriz de convención de resolución como `NOT APPLICABLE` — no hay una convención nueva que
reconciliar entre contextos.

Cada archivo nuevo listado arriba tiene exactamente uno de dos orígenes, nombrado explícitamente:
un paso de §9 lo autora (listado en el **Do** de ese paso), o está emitido en `workspace/` (§19.6)
y llega a la raíz del proyecto por la copia guardada de Bootstrap (§10), antes de que corra el
Paso 1. `vitest.config.ts`, `vitest.setup.ts`, `supabase/config.toml`, `.github/workflows/ci.yml`,
`CLAUDE.md`, `AGENTS.md`, `.claude/settings.json`, `.claude/skills/approval-flow-webhooks/SKILL.md`
y `.claude/rules/tests.md` son todos del segundo tipo — ningún paso de §9 los crea.

---

## 4. Modelo de datos

### Delta

**NOT APPLICABLE — este blueprint no agrega, modifica ni elimina ninguna tabla, columna, enum,
índice o función.** Las 16 tablas, los 4 enums (`user_role`, `platform_type`, `content_format`,
`content_status`, `approval_decision`, `webhook_event_type` — 6 en total, ver nota abajo) y las 7
funciones `SECURITY DEFINER` existentes se usan tal cual están, verificadas leyendo
`supabase/migrations/0001_init.sql` y `0002_storage.sql` directamente. El Paso 6 (§9) escribe filas
reales a través de este esquema existente dentro de una prueba de integración y las borra en
`afterAll` — nunca migra el esquema.

*(Nota de conteo: el archivo declara 6 `create type`, no 4 — `user_role`, `platform_type`,
`content_format`, `content_status`, `approval_decision`, `webhook_event_type` — contado
directamente de `grep -n "^create type" supabase/migrations/0001_init.sql`.)*

### Entidades relevantes para las pruebas de este blueprint (referencia, sin cambios)

**`content_pieces`** — una pieza de contenido para una marca, con su estado de aprobación.

| Campo | Tipo | Restricciones | Notas |
|---|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` | |
| `client_id` | `uuid` | FK → `clients.id`, `not null`, `on delete cascade` | |
| `status` | `content_status` | `not null default 'borrador'` | solo cambia vía las funciones `SECURITY DEFINER` |
| `scheduled_at` | `timestamptz` | `not null` | fecha/hora programada, siempre en UTC en la base; `lib/tz.ts` la traduce a la zona del cliente |

**`status_history`** — bitácora append-only de cada transición de estado.

| Campo | Tipo | Restricciones | Notas |
|---|---|---|---|
| `content_piece_id` | `uuid` | FK, `not null`, `on delete cascade` | |
| `from_status` | `content_status` | nullable | `null` en la primera transición |
| `to_status` | `content_status` | `not null` | |
| `changed_by` | `uuid` | FK → `profiles.id` | |

El Paso 6 (§9) es la prueba que ejercita estas dos tablas junto con `approvals`, `client_contacts`
y las funciones `submit_for_review` / `approve_content_piece` contra Postgres real.

### Migraciones

Sin cambios al mecanismo existente: SQL puro en `supabase/migrations/`, aplicado en orden con
`supabase db reset` (local/CI) o pegado manualmente en el SQL Editor de Supabase (producción, según
el README existente). Este blueprint no agrega ninguna migración nueva.

---

## 5. Diseño de API

### Delta

**NOT APPLICABLE — este blueprint no agrega, modifica ni elimina ninguna ruta pública, Server
Action, ni el contrato de ningún endpoint existente.** El Paso 6 (§9) llama funciones RPC
existentes (`submit_for_review`, `approve_content_piece`) desde una prueba, con las mismas firmas
que `app/actions.ts` ya usa en producción — no crea una superficie nueva.

### Interfaces held constant (congeladas por este blueprint)

| Interfaz | Detalle | Por qué se congela |
|---|---|---|
| Las 16 tablas y sus columnas | `supabase/migrations/0001_init.sql` | Este es un cambio de tooling, no de esquema |
| Firmas de las 7 funciones `SECURITY DEFINER` | `submit_for_review(uuid)`, `approve_content_piece(uuid, text default null)`, `request_changes(uuid, text)`, `mark_scheduled(uuid)`, `mark_published(uuid)`, `cancel_content_piece(uuid, text)`, `reschedule_content_piece(uuid, timestamptz)` | La prueba de integración del Paso 6 las llama tal cual; cambiar una firma rompería esa prueba y la app |
| Valores del enum `content_status` | `borrador`, `pendiente_revision`, `cambios_solicitados`, `aprobado`, `programado`, `publicado`, `cancelado` (7) | Documentados verbatim en la skill del Paso 9 |
| Valores del enum `webhook_event_type` | `pieza_creada_revision`, `pieza_aprobada`, `cambios_solicitados`, `comentario_agregado`, `fecha_cambiada`, `pieza_programada`, `pieza_publicada` (7) | Documentados verbatim en la skill del Paso 9 |
| Header de firma de webhook | `X-Planner-Signature` (HMAC-SHA256 hex sobre el JSON exacto del body) | El Paso 4 (§9) prueba exactamente este contrato |
| Mecanismo de dedup de calendario | `calendar_event_links` — un row por `content_piece_id` (constraint `unique`); `PATCH` si existe, `POST` si no | El Paso 7 (§9) prueba exactamente este contrato |
| Cada ruta pública bajo `app/` | Sin cambios — ver el árbol en §3 | Este blueprint no toca `app/**` |
| Cada Server Action en `app/actions.ts` / `app/admin-actions.ts` | Sin cambios | Este blueprint no toca esos archivos |
| Cada nombre de variable en `.env.example` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (7) | El Paso 10 (§9) las documenta para Vercel, no las cambia |

Cada fila de esta tabla se refleja también en §1, "No-objetivos".

---

## 6. Arquitectura frontend

**Sin cambios.** Este blueprint no toca ninguna ruta, componente ni la estrategia de renderizado.
Referencia informativa para quien construya, sin obligación de acción:

| Ruta | Página | Fuente de datos | Auth |
|---|---|---|---|
| `/calendario` | `app/calendario/page.tsx` | Server Component, query directa a Supabase | usuario autenticado |
| `/piezas/[id]` | `app/piezas/[id]/page.tsx` | Server Component | usuario autenticado, RLS filtra por cliente |
| `/clientes` | `app/clientes/page.tsx` | Server Component | `agency_admin` / `agency_member` |

Delta: `NOT APPLICABLE — sin cambios de frontend (ver §1, No-objetivos).`

---

## 7. Sistema de diseño

**NOT APPLICABLE — este blueprint no incluye ningún cambio de UI/UX** (ver §1, No-objetivos). El
sistema de diseño existente de la aplicación no se toca.

---

## 8. Autenticación y autorización

**Sin cambios.** Referencia informativa — el Paso 6 (§9) depende de entender esto para escribir la
prueba de integración correctamente.

### Proveedor

Supabase Auth. `profiles` extiende `auth.users` 1:1 (`profiles.id references auth.users(id)`), con
`role` (`agency_admin` | `agency_member` | `client`) poblado automáticamente por el trigger
`handle_new_user()` al crear el usuario.

### Roles y permisos (existente, sin cambios)

| Rol | Puede | No puede |
|---|---|---|
| `agency_admin` | Todo lo de `agency_member`, más invitar equipo/contactos, configurar webhooks y Google Calendar | — |
| `agency_member` | Crear/editar/duplicar/eliminar piezas, ver el calendario de todos los clientes, comentar | Aprobar o solicitar cambios, configurar webhooks |
| `client` | Ver el calendario de su propia marca, aprobar / solicitar cambios, comentar | Ver otras marcas, crear/editar piezas, gestión de equipo |

### Aislamiento multi-tenant

Row Level Security en Postgres, más una capa manual de autorización *dentro* de cada función
`SECURITY DEFINER` (que corre con permisos del dueño de la tabla y por lo tanto no está sujeta a
RLS por sí sola — ver `is_agency()`, `has_client_access()` en `supabase/migrations/0001_init.sql`
líneas 230–250). El Paso 6 (§9) es la primera prueba automatizada de este proyecto que ejercita esa
doble capa contra Postgres real.

Delta: `NOT APPLICABLE — sin cambios de auth (ver §1, No-objetivos).`

---

## 9. ORDEN DE CONSTRUCCIÓN

Esta es la sección por la que existe todo el blueprint. 10 pasos, agrupados en 2 epics de 5 pasos
cada uno (`ceil(10÷9)=2`, `floor(10÷5)=2` — exactamente 2 es el único número legal para 10 pasos).

**§9.1 Paridad y cutover:** `NOT APPLICABLE — cambio aditivo (suite de pruebas, CI, tooling de
agente, preparación de despliegue). Ningún componente en ejecución, dependencia ni interfaz está
siendo reemplazado — §1 (No-objetivos) y §5 (Interfaces held constant) congelan toda la superficie
de la aplicación. No hay nada que cortar sobre (cutover).`

### Mapa de pasos

| # | Paso | Depende de | Toca | Gate |
|---|---|---|---|---|
| 1 | Node 22 + script de typecheck | — | `package.json`, `package-lock.json`, `tsconfig.json` | `npm run typecheck` |
| 2 | Config de ESLint (arregla `next lint`) | 1 | `package.json`, `package-lock.json`, `.eslintrc.json` | `npm run lint` |
| 3 | Toolchain Vitest + jsdom + Testing Library | 2 | `package.json`, `package-lock.json`, `tests/unit/smoke.test.tsx` | `npm run test` |
| 4 | Pruebas unitarias — firma HMAC de webhooks | 3 | `tests/unit/webhooks/dispatch.test.ts` | `npx vitest run tests/unit/webhooks/dispatch.test.ts` |
| 5 | Pruebas unitarias — fecha/hora con zona horaria | 3 | `tests/unit/lib/date-utils.test.ts`, `tests/unit/lib/tz.test.ts` | `npx vitest run tests/unit/lib/*.test.ts` |
| 6 | Integración — Supabase local + transiciones de estado (**gate de capa de datos**) | 3 | `package.json`, `package-lock.json`, `scripts/write-supabase-test-env.mjs`, `tests/integration/state-transitions.test.ts` | `npm run test:integration` |
| 7 | Pruebas unitarias — sync de Google Calendar | 3 | `tests/unit/lib/google-calendar-sync.test.ts` | `npx vitest run tests/unit/lib/google-calendar-sync.test.ts` |
| 8 | Verificar el pipeline de CI localmente | 2, 4, 5, 6, 7 | `README.md` | `npm run lint && npx tsc --noEmit && npm run test && npm run test:integration && npm run build` |
| 9 | Verificar el workspace de agente | — | ninguno (valida lo emitido por Bootstrap) | ver Verify del paso |
| 10 | Build de producción + preparación de Vercel | 8 | `README.md` | `npm run build` + smoke a `/login` |

*(Ordenamiento: fundación de tooling → pruebas unitarias en paralelo → gate de capa de datos →
verificación de CI → verificación de workspace de agente → build de producción. Los Pasos 4, 5, 6 y
7 dependen únicamente del Paso 3 y no comparten archivos entre sí — pueden ejecutarse en paralelo,
ver `tasks.json`.)*

---

#### Paso 1 — Node 22 + script de typecheck

**Do**

Sube `@types/node` de `^20.14.2` a `^22` (`npm install -D @types/node@^22`). Agrega
`"engines": { "node": "22.x" }` a `package.json` — esto es lo que la plataforma de build de Vercel
lee para elegir la versión mayor de Node (§12), y documenta el mismo requisito que
`actions/setup-node` impone en CI (Paso 8). Agrega el script `"typecheck": "tsc --noEmit"` —
el proyecto no tenía ninguno; todos los pasos siguientes y el gate global (§20.1) lo usan. Agrega
`"blueprints"`, `"vitest.config.ts"` y `"vitest.setup.ts"` al array `exclude` de `tsconfig.json`
(hoy solo `["node_modules"]`).

Las tres exclusiones tienen razones distintas y ambas fueron confirmadas ejecutando este paso en
vivo (2026-09-24):

- `"blueprints"` — el bundle en `blueprints/digital-planner/workspace/` trae archivos `.ts` que el
  `include: ["**/*.ts", ...]` por defecto de `tsc` tipificaría como una segunda copia redundante.
- `"vitest.config.ts"` y `"vitest.setup.ts"` — Bootstrap (§10) los deposita en la raíz **antes**
  que este paso, pero los paquetes que importan (`@vitejs/plugin-react`, `vitest/config`,
  `@testing-library/jest-dom`) no se instalan hasta el Paso 3. Sin esta exclusión,
  `npm run typecheck` falla aquí con `TS2307: Cannot find module` sobre archivos que este paso no
  escribió — un gate roto por el orden del build, no por el trabajo del paso. Excluirlos es además
  lo correcto de forma permanente: son configuración de herramienta que Vite transpila por su
  cuenta, no código de aplicación, y el `tsc --noEmit` de la app no debe depender de
  devDependencies de pruebas.

**Done when**
- [ ] WHEN `package.json` is inspected THE SYSTEM SHALL declare `"@types/node"` matching `^22`
      under `devDependencies`.
- [ ] WHEN `package.json` is inspected THE SYSTEM SHALL declare `"engines": { "node": "22.x" }`.
- [ ] WHEN `package.json` is inspected THE SYSTEM SHALL declare a `"typecheck"` script equal to
      `"tsc --noEmit"`.
- [ ] WHEN `tsconfig.json`'s `exclude` array is inspected THE SYSTEM SHALL contain `"blueprints"`,
      `"vitest.config.ts"` and `"vitest.setup.ts"`.
- [ ] WHEN `npm run typecheck` runs THE SYSTEM SHALL exit 0 against the existing, untouched
      application code.

**Verify**
```bash
node -e "const p=require('./package.json'); if(!/\^22/.test(p.devDependencies['@types/node'])) process.exit(1)"
# expect: exit 0

node -e "const p=require('./package.json'); if(p.engines?.node !== '22.x') process.exit(1)"
# expect: exit 0

node -e "const p=require('./package.json'); if(p.scripts?.typecheck !== 'tsc --noEmit') process.exit(1)"
# expect: exit 0

node -e "const t=require('./tsconfig.json'); for(const x of ['blueprints','vitest.config.ts','vitest.setup.ts']) if(!t.exclude.includes(x)) process.exit(1)"
# expect: exit 0

npm run typecheck
# expect: exit 0
```

**Checkpoint**
```bash
git add -A && git commit -m "step 1: bump Node target to 22, add typecheck script"
git tag step-01-node22-target
# rollback target if step 2 goes wrong: git reset --hard step-01-node22-target
```

---

#### Paso 2 — Configurar ESLint (arregla `next lint`)

**Do**

Instala `eslint@^8.57.0` y `eslint-config-next@14.2.35` como devDependencies (ambos pines
`UNVERIFIED` este sesión — ver §11). Crea `.eslintrc.json` en la raíz:
`{"extends": "next/core-web-vitals", "ignorePatterns": ["blueprints/**", ".next/**",
"node_modules/**"]}`. Corre `npm run lint`. `next/core-web-vitals` solo falla el comando en
hallazgos de nivel `error` (los `warn` no lo hacen). Si aparece algún `error` en código existente
de `app/`, `components/` o `lib/`, corrígelo como un cambio mínimo y no conductual (un `key`
faltante, un import sin usar) — nunca reestructures un componente ni cambies lo que renderiza; eso
violaría el no-objetivo de "sin rediseño de UI/UX" (§1).

**Done when**
- [ ] WHEN `npm run lint` runs THE SYSTEM SHALL exit 0.
- [ ] WHEN `.eslintrc.json` is inspected THE SYSTEM SHALL declare `"ignorePatterns"` including
      `"blueprints/**"`.
- [ ] WHEN `.eslintrc.json` is inspected THE SYSTEM SHALL declare
      `"extends": "next/core-web-vitals"`.
- [ ] WHEN `package.json` is inspected THE SYSTEM SHALL declare `eslint-config-next` at exactly
      `14.2.35` under `devDependencies`.

**Verify**
```bash
npm run lint
# expect: exit 0 — no more interactive prompt, no error-level findings

node -e "const c=require('./.eslintrc.json'); if(!c.ignorePatterns.includes('blueprints/**')) process.exit(1)"
# expect: exit 0

node -e "const c=require('./.eslintrc.json'); if(c.extends !== 'next/core-web-vitals') process.exit(1)"
# expect: exit 0

node -e "const p=require('./package.json'); if(p.devDependencies['eslint-config-next'] !== '14.2.35') process.exit(1)"
# expect: exit 0
```

**Checkpoint**
```bash
git add -A && git commit -m "step 2: configure ESLint (next/core-web-vitals)"
git tag step-02-eslint-config
# rollback target if step 3 goes wrong: git reset --hard step-02-eslint-config
```

---

#### Paso 3 — Toolchain Vitest + jsdom + Testing Library

**Do**

Instala `vitest@^5.0.1 @vitejs/plugin-react@^6.1.1 vite@^8.3.1 @testing-library/react@^16.3.3
@testing-library/jest-dom@^7.0.1 jsdom@^30.1.1 @vitest/coverage-v8@5.0.1`. Agrega los scripts
`"test": "vitest run tests/unit"`, `"test:watch": "vitest tests/unit"`,
`"test:coverage": "vitest run tests/unit --coverage"`. `vitest.config.ts` y `vitest.setup.ts` ya
existen en la raíz del proyecto (copiados por Bootstrap desde `workspace/` de este bundle — §19.6)
— no los recrees. Escribe `tests/unit/smoke.test.tsx` con exactamente dos pruebas: una aserción
aritmética trivial, y una segunda que renderiza un elemento mínimo con `render()` de
`@testing-library/react`, lo consulta con `screen.getByText`, y lo afirma con `toBeInTheDocument()`
de `@testing-library/jest-dom` — esto prueba que todo el toolchain está conectado, no solo
instalado.

Agrega `/coverage` a `.gitignore` (bajo el bloque `# production`). Es la única edición a
`.gitignore` de todo este blueprint (§10): `test:coverage` escribe un reporte HTML completo ahí,
ningún patrón existente lo atrapa, y el `git add -A` del Checkpoint de abajo lo commitearía entero.

Crea `tests/vitest.d.ts` con una sola línea, `import '@testing-library/jest-dom/vitest';`. Es la
contraparte obligatoria de la exclusión que hace el Paso 1: al sacar `vitest.setup.ts` del programa
de TypeScript, también sale la augmentación de tipos de los matchers, y `npm run typecheck` falla
con `Property 'toBeInTheDocument' does not exist on type 'Assertion<...>'` en cuanto alguna prueba
la usa. Este archivo la devuelve sin volver a meter la config de Vitest al typecheck. Hallazgo del
gate de aceptación de este epic, ejecutado en vivo (2026-09-24).

**Done when**
- [ ] WHEN `npm run test` runs THE SYSTEM SHALL report exactly 1 passed test file and 2 passed
      tests, 0 failed, 0 skipped.
- [ ] WHEN `git check-ignore -q coverage` runs after `npm run test:coverage` has written the
      report THE SYSTEM SHALL exit 0, proving the generated coverage output is excluded from
      version control.
- [ ] WHEN the second smoke assertion renders a component with `@testing-library/react`'s
      `render()` THE SYSTEM SHALL find it via `screen.getByText` and assert it with
      `@testing-library/jest-dom`'s `toBeInTheDocument()`, proving the full toolchain (Vitest,
      `@vitejs/plugin-react`, jsdom, Testing Library, jest-dom matchers) is wired together, not
      just jsdom alone.
- [ ] WHEN `npm run test:coverage` runs THE SYSTEM SHALL exit 0 and write `coverage/index.html`.
- [ ] WHEN `package.json`'s `devDependencies` are inspected THE SYSTEM SHALL declare `vitest`
      matching `^5.0.1` and `@vitest/coverage-v8` at exactly `5.0.1`.

**Verify**
```bash
npm run test
# expect: "Test Files  1 passed (1)", "Tests  2 passed (2)", 0 failed, 0 skipped

npm run test:coverage
# expect: exit 0
test -f coverage/index.html
# expect: exit 0

git check-ignore -q coverage
# expect: exit 0 — the generated report is gitignored, not committed

node -e "const p=require('./package.json'); if(!/\^5\.0\.1/.test(p.devDependencies.vitest)) process.exit(1)"
# expect: exit 0
node -e "const p=require('./package.json'); if(p.devDependencies['@vitest/coverage-v8'] !== '5.0.1') process.exit(1)"
# expect: exit 0
```

**Checkpoint**
```bash
git add -A && git commit -m "step 3: add Vitest + jsdom + Testing Library toolchain"
git tag step-03-vitest-toolchain
# rollback target if step 4 goes wrong: git reset --hard step-03-vitest-toolchain
```

---

#### Paso 4 — Pruebas unitarias: firma HMAC de webhooks (`lib/webhooks/dispatch.ts`)

**Do**

Crea `tests/unit/webhooks/dispatch.test.ts`. Mockea `createServiceClient` de
`@/lib/supabase/server` (`vi.mock`) para devolver un cliente encadenable falso cuyo
`.from('webhook_configs').select().eq('active', true)` resuelve a un fixture —
`{ id: 'wh-1', url: 'https://example.com/hook', secret: 'test-secret-please-ignore', active: true,
events: ['pieza_aprobada'] }` — y cuyo `.from('webhook_deliveries').insert(...)` es un `vi.fn()`
afirmable. Mockea `global.fetch` con `vi.fn()`. Construye el payload con la
`buildWebhookPayload('pieza_aprobada', ...)` real (sin mockear) y pásalo a la
`dispatchWebhookEvent` real. Calcula la firma esperada dentro de la prueba con
`crypto.createHmac('sha256', 'test-secret-please-ignore')` sobre `JSON.stringify(payload)` — la
misma serialización que `dispatchWebhookEvent` hace internamente.

**Done when**
- [ ] WHEN `dispatchWebhookEvent` is called with a payload built by
      `buildWebhookPayload('pieza_aprobada', ...)` and one mocked active webhook config matching
      that event THE SYSTEM SHALL call `fetch` exactly once with header `X-Planner-Signature`
      equal to the HMAC-SHA256 hex digest of the exact JSON body, computed independently in the
      test using the same webhook secret.
- [ ] WHEN the same call is made THE SYSTEM SHALL call `fetch` with header `X-Planner-Event` equal
      to `pieza_aprobada` and header `Content-Type` equal to `application/json`.
- [ ] WHEN the mocked `fetch` resolves with `status: 200` THE SYSTEM SHALL insert one mocked
      `webhook_deliveries` row with `response_status: 200` and `error: null`.
- [ ] WHEN a mocked webhook config's `events` array does not include the dispatched event type
      THE SYSTEM SHALL NOT call `fetch` for that config.
- [ ] WHEN the mocked `fetch` rejects with a network error THE SYSTEM SHALL insert a
      `webhook_deliveries` row with `response_status: null` and `error` equal to the thrown
      error's message, and SHALL NOT throw out of `dispatchWebhookEvent`.

**Verify**
```bash
npx vitest run tests/unit/webhooks/dispatch.test.ts
# expect: 5 passed, 0 failed, 0 skipped
```

**Checkpoint**
```bash
git add -A && git commit -m "step 4: unit tests for webhook HMAC signing"
git tag step-04-webhook-hmac-tests
# rollback target if step 5 goes wrong: git reset --hard step-04-webhook-hmac-tests
```

---

#### Paso 5 — Pruebas unitarias: fecha/hora con zona horaria (`lib/date-utils.ts`, `lib/tz.ts`)

**Do**

Crea `tests/unit/lib/date-utils.test.ts` y `tests/unit/lib/tz.test.ts`. Ambos son pruebas de
funciones puras, sin mocks necesarios. En `tz.test.ts`, elige un instante ISO fijo y dos zonas
horarias IANA con offsets UTC distintos en ese instante (ej. `'America/Mexico_City'` y
`'Europe/Madrid'`) para que la aserción de "offsets distintos producen `HH:mm` distintos" no sea
verdadera por coincidencia.

**Done when**
- [ ] WHEN `getMonthGridRange` is called for a month whose first day is not a Monday THE SYSTEM
      SHALL return a `start` that is a Monday on or before the 1st and an `end` that is a Sunday
      on or after the month's last day.
- [ ] WHEN `getDaysBetween(start, end)` is called THE SYSTEM SHALL return an array whose length
      equals the inclusive day count between `start` and `end`.
- [ ] WHEN `formatMonthTitle` is called with a `Date` in March THE SYSTEM SHALL return a
      capitalized Spanish month name and year matching `/^Marzo \d{4}$/`.
- [ ] WHEN `formatTimeInTz` is called with a fixed ISO instant and `'America/Mexico_City'` THE
      SYSTEM SHALL return that timezone's wall-clock `HH:mm`, not UTC's.
- [ ] WHEN `combineDateKeepTime` is called with an original ISO timestamp, a new calendar date
      string, and a timezone, and the result is re-formatted with `formatDateTimeInTz` in that
      same timezone THE SYSTEM SHALL round-trip to the same `HH:mm` as the original — proving no
      timezone drift across the combine operation.
- [ ] WHEN `formatTimeInTz` is called with the same ISO instant under two IANA timezones with
      different UTC offsets at that instant THE SYSTEM SHALL return two different `HH:mm`
      strings.

**Verify**
```bash
npx vitest run tests/unit/lib/date-utils.test.ts
# expect: 3 passed, 0 failed, 0 skipped
npx vitest run tests/unit/lib/tz.test.ts
# expect: 3 passed, 0 failed, 0 skipped
```

**Checkpoint**
```bash
git add -A && git commit -m "step 5: unit tests for date/tz handling"
git tag step-05-date-tz-tests
# rollback target if step 6 goes wrong: git reset --hard step-05-date-tz-tests
```

---

#### Paso 6 — Integración: Supabase local + transiciones de estado (gate de capa de datos)

**Do**

Instala `supabase@2.117.0` como devDependency. Agrega los scripts
`"test:integration": "npx supabase start && npx supabase db reset && node scripts/write-supabase-test-env.mjs && vitest run tests/integration --environment node"`
y `"db:test:stop": "npx supabase stop"`.

Escribe `scripts/write-supabase-test-env.mjs`: corre `npx supabase status -o json`, lo parsea, y
escribe `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` y
`NEXT_PUBLIC_APP_URL=http://localhost:3000` en la ruta que reciba como **primer argumento de línea
de comandos** (`process.argv[2]`), con `.env.test.local` como valor por defecto si no se pasa
ninguno. Este parámetro existe porque el Paso 10 reutiliza el mismo script pasándole `.env.local`
en vez de aceptar una segunda copia del mismo lector de `supabase status`. Si los nombres de campo
del JSON de tu versión instalada del CLI difieren de `API_URL` / `ANON_KEY` / `SERVICE_ROLE_KEY`,
corre `npx supabase status -o json` una vez a mano y ajusta los nombres de propiedad en el
script — nunca caigas de vuelta a una credencial hardcodeada.

Escribe `tests/integration/state-transitions.test.ts` usando `@supabase/supabase-js` (ya es
dependencia de runtime — no se necesita un paquete nuevo para el cliente):
1. Un cliente con service role crea dos usuarios de prueba vía
   `auth.admin.createUser({ email, password, email_confirm: true })` — uno para el admin de
   agencia, uno para el contacto de cliente. `handle_new_user()` crea sus `profiles`
   automáticamente; actualiza el `role` del admin a `'agency_admin'` con el mismo cliente de
   service role.
2. El cliente de service role inserta una fila en `clients`, una en `client_contacts` (ligando el
   usuario contacto a ese cliente), y una en `content_pieces` (`status` por defecto `'borrador'`).
3. Inicia sesión como el admin con un cliente de clave anónima
   (`auth.signInWithPassword`) y llama `.rpc('submit_for_review', { p_content_piece_id })`.
4. Inicia sesión como el contacto de cliente y llama
   `.rpc('approve_content_piece', { p_content_piece_id, p_note: 'Se ve bien' })`.
5. Como caso negativo, inicia sesión como un tercer usuario de prueba que es contacto de un
   cliente **distinto** y llama `approve_content_piece` sobre la misma pieza — espera un error.
6. En `afterAll`, borra la fila de `clients` (cascada a `content_pieces`, `client_contacts`,
   `status_history`, `approvals`) y borra los tres usuarios de prueba vía
   `auth.admin.deleteUser`.

**Done when**
- [ ] WHEN `npm run test:integration` runs against a freshly reset local Supabase THE SYSTEM SHALL
      apply both `supabase/migrations/0001_init.sql` and `supabase/migrations/0002_storage.sql`
      with zero errors via `supabase db reset`.
- [ ] WHEN the test signs in as the seeded `agency_admin` test user and calls
      `.rpc('submit_for_review', { p_content_piece_id })` on a `borrador` piece THE SYSTEM SHALL
      leave exactly one new `status_history` row with `to_status = 'pendiente_revision'` and
      update `content_pieces.status` to `pendiente_revision`.
- [ ] WHEN the test signs in as the seeded client-contact test user (linked via
      `client_contacts`) and calls `.rpc('approve_content_piece', { p_content_piece_id, p_note })`
      on that same piece THE SYSTEM SHALL leave exactly one new `status_history` row with
      `to_status = 'aprobado'`, insert exactly one `approvals` row with `decision = 'aprobado'`,
      and update `content_pieces.status` to `aprobado`.
- [ ] WHEN a signed-in test user who is NOT a client contact of that client calls
      `.rpc('approve_content_piece', ...)` on the same piece THE SYSTEM SHALL return an error and
      leave `content_pieces.status` unchanged.
- [ ] WHEN the test suite finishes THE SYSTEM SHALL delete every row and test user it created, in
      an `afterAll`, so `npm run test:integration` is safe to re-run against the same local
      instance.

**Verify**
```bash
npx supabase start
# expect: exit 0 — local Postgres/GoTrue/PostgREST stack up

npx supabase db reset
# expect: exit 0 — 0001_init.sql and 0002_storage.sql applied with no error

node scripts/write-supabase-test-env.mjs
# expect: exit 0, writes .env.test.local

npx vitest run tests/integration --environment node
# expect: 5 passed, 0 failed, 0 skipped — this is the data-layer gate

node -e "const p=require('./package.json'); if(p.devDependencies.supabase !== '2.117.0') process.exit(1)"
# expect: exit 0
```

**Checkpoint**
```bash
git add -A && git commit -m "step 6: local Supabase integration harness + state-transition test"
git tag step-06-integration-state-transitions
# rollback target if step 7 goes wrong: git reset --hard step-06-integration-state-transitions
```

---

#### Paso 7 — Pruebas unitarias: sync de Google Calendar (`lib/google-calendar/sync.ts`)

**Do**

Crea `tests/unit/lib/google-calendar-sync.test.ts`. Mockea `createServiceClient` de
`@/lib/supabase/server` para devolver fixtures de `client_calendar_mappings`,
`google_calendar_connections` y `calendar_event_links` según el escenario. Mockea `global.fetch`
tanto para el endpoint de token OAuth de Google como para la API de Calendar. Usa un
`access_token` mockeado no expirado por defecto; sobreescríbelo a uno expirado para la aserción del
flujo de refresh.

**Done when**
- [ ] WHEN `syncPieceToGoogleCalendar` is called for a piece whose client has no mocked row in
      `client_calendar_mappings` THE SYSTEM SHALL return
      `{ skipped: 'sin_calendario_configurado' }` and SHALL NOT call `fetch`.
- [ ] WHEN a mocked mapping and a valid non-expired `access_token` exist and NO mocked row exists
      yet in `calendar_event_links` for that piece THE SYSTEM SHALL call `fetch` with method
      `POST` against the events-insert URL, then insert a new mocked `calendar_event_links` row
      with the returned `google_event_id`.
- [ ] WHEN a mocked mapping exists AND a `calendar_event_links` row already exists for that piece
      (the reschedule case) THE SYSTEM SHALL call `fetch` with method `PATCH` against that
      existing `google_event_id`'s URL, and SHALL NOT insert a second `calendar_event_links` row.
- [ ] WHEN the stored `access_token` is expired and a `refresh_token` exists THE SYSTEM SHALL
      first `POST` to the Google OAuth token endpoint to refresh it before calling the Calendar
      API.
- [ ] WHEN the mocked Calendar API responds non-OK THE SYSTEM SHALL return
      `{ error: <response body text> }` and SHALL NOT write to `calendar_event_links`.

**Verify**
```bash
npx vitest run tests/unit/lib/google-calendar-sync.test.ts
# expect: 5 passed, 0 failed, 0 skipped
```

**Checkpoint**
```bash
git add -A && git commit -m "step 7: unit tests for Google Calendar upsert-without-duplicate logic"
git tag step-07-google-calendar-sync-tests
# rollback target if step 8 goes wrong: git reset --hard step-07-google-calendar-sync-tests
```

---

#### Paso 8 — Verificar el pipeline de CI (`.github/workflows/ci.yml`) localmente

**Do**

`.github/workflows/ci.yml` ya existe en la raíz del proyecto (copiado por Bootstrap — §19.6). Este
paso no lo crea. Agrega una sección `## CI` a `README.md` documentando el disparador (push + pull
request) y el nombre del check requerido (`CI / test` en la UI de branch protection de GitHub).
Luego corre, en local, cada comando que el workflow corre, en el mismo orden, para probar que
pasará antes de que el primer push lo ejercite.

**Done when**
- [ ] WHEN `.github/workflows/ci.yml` is inspected THE SYSTEM SHALL declare triggers for both
      `push` and `pull_request`.
- [ ] WHEN `.github/workflows/ci.yml` is inspected THE SYSTEM SHALL pin `actions/checkout@v7` and
      `actions/setup-node@v7` with `node-version: '22'`.
- [ ] WHEN `.github/workflows/ci.yml` is inspected THE SYSTEM SHALL run, in order, `npm run lint`,
      `npx tsc --noEmit`, `npm run test`, `npm run test:integration`, and `npm run build`.
- [ ] WHEN every command from the previous criterion is run locally, in that order, on this
      machine THE SYSTEM SHALL exit 0 on each.

**Verify**
```bash
grep -q "pull_request" .github/workflows/ci.yml
# expect: exit 0
grep -q "^  push:" .github/workflows/ci.yml
# expect: exit 0
grep -q "actions/checkout@v7" .github/workflows/ci.yml
# expect: exit 0
grep -q "actions/setup-node@v7" .github/workflows/ci.yml
# expect: exit 0
grep -q "node-version: '22'" .github/workflows/ci.yml
# expect: exit 0
grep -q "npm run lint" .github/workflows/ci.yml && grep -q "tsc --noEmit" .github/workflows/ci.yml && grep -q "npm run test" .github/workflows/ci.yml && grep -q "npm run test:integration" .github/workflows/ci.yml && grep -q "npm run build" .github/workflows/ci.yml
# expect: exit 0 — all five commands present

npm run lint && npx tsc --noEmit && npm run test && npm run test:integration && npm run build
# expect: exit 0 — the exact sequence CI runs, mirrored locally
```

**Checkpoint**
```bash
git add -A && git commit -m "step 8: verify CI pipeline locally, document CI in README"
git tag step-08-ci-pipeline
# rollback target if step 9 goes wrong: git reset --hard step-08-ci-pipeline
```

---

#### Paso 9 — Verificar el workspace de agente

**Do**

`CLAUDE.md`, `AGENTS.md`, `.claude/settings.json`,
`.claude/skills/approval-flow-webhooks/SKILL.md` y `.claude/rules/tests.md` ya existen en la raíz
del proyecto (copiados por Bootstrap — §19). Este paso no crea archivos nuevos: confirma que los
cinco están presentes, que `settings.json` es JSON válido, y que la skill documenta todos los
valores literales de `content_status` y `webhook_event_type` (contados directamente de
`types/database.ts`, no adivinados).

**Done when**
- [ ] WHEN `CLAUDE.md`, `AGENTS.md`, `.claude/settings.json`,
      `.claude/skills/approval-flow-webhooks/SKILL.md`, and `.claude/rules/tests.md` are checked
      THE SYSTEM SHALL find all five present at the project root.
- [ ] WHEN `.claude/settings.json` is parsed THE SYSTEM SHALL parse as valid JSON.
- [ ] WHEN `.claude/skills/approval-flow-webhooks/SKILL.md` is inspected THE SYSTEM SHALL mention
      all 7 `content_status` values (`borrador`, `pendiente_revision`, `cambios_solicitados`,
      `aprobado`, `programado`, `publicado`, `cancelado`) and all 7 `webhook_event_type` values
      (`pieza_creada_revision`, `pieza_aprobada`, `cambios_solicitados`, `comentario_agregado`,
      `fecha_cambiada`, `pieza_programada`, `pieza_publicada`).

**Verify**
```bash
test -f CLAUDE.md && test -f AGENTS.md && test -f .claude/settings.json && test -f .claude/skills/approval-flow-webhooks/SKILL.md && test -f .claude/rules/tests.md
# expect: exit 0

node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))"
# expect: exit 0 — valid JSON

for v in borrador pendiente_revision cambios_solicitados aprobado programado publicado cancelado pieza_creada_revision pieza_aprobada comentario_agregado fecha_cambiada pieza_programada pieza_publicada; do grep -q "$v" .claude/skills/approval-flow-webhooks/SKILL.md || exit 1; done
# expect: exit 0 — all 13 distinct literal names documented (cambios_solicitados is shared by both enums)
```

**Checkpoint**
```bash
git add -A && git commit -m "step 9: verify agent workspace" --allow-empty
git tag step-09-agent-workspace
# rollback target if step 10 goes wrong: git reset --hard step-09-agent-workspace
```

---

#### Paso 10 — Build de producción + preparación de despliegue en Vercel (Node 22.x)

**Do**

**Hallazgo del smoke-test de este blueprint (ejecutado en vivo el 2026-09-24), corregido aquí:**
`middleware.ts` construye un cliente de Supabase en **cada** request — incluida `/login` — así que
sin `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` reales el servidor construido
responde 500, no 200, y el chequeo de abajo fallaría en un checkout limpio que no tenga ya un
`.env.local` de producción configurado a mano. La corrección: reutiliza la Supabase **local** que
`E2-T1`/Paso 6 ya sabe levantar, en vez de exigir credenciales de producción para este chequeo.

1. `npx supabase start` — no-op seguro si ya estaba arriba desde una corrida anterior de
   `npm run test:integration` en esta misma sesión; si no, la levanta.
2. `node scripts/write-supabase-test-env.mjs .env.local` — el mismo script del Paso 6, que ya
   acepta una ruta de destino opcional como primer argumento (por defecto `.env.test.local`; aquí
   se le pasa `.env.local` explícitamente). Escribe las credenciales de la Supabase **local** en
   `.env.local`, que Next.js carga automáticamente en `npm run build`/`npm start` (soporte nativo
   de Next.js — mecanismo distinto del cargador casero de `vitest.setup.ts`, que solo aplica a
   Vitest). `.env.local` ya está excluido por el patrón `.env.local`/`.env*.local` existente en
   `.gitignore` — nunca se commitea, ver §10.
3. `npm run build` y confirma exit 0.
4. Arranca el servidor construido con `npm start`, pide `/login` (la única ruta que no requiere
   sesión), y confirma que responde 200 — ahora sirviendo contra la Supabase local real, nunca
   contra una URL de producción inventada.
5. `npx supabase stop` — deja el entorno limpio al terminar.
6. Agrega una sección "## Despliegue en Vercel" a `README.md` listando cada nombre de variable de
   `.env.example` (7 variables, **de producción** — `.env.local` de este paso es solo para el
   smoke-check local, nunca para el despliegue real) y declarando que el ajuste de versión de
   Node.js del proyecto en Vercel debe ser `22.x`.

**Done when**
- [ ] WHEN `npm run build` runs THE SYSTEM SHALL exit 0 and produce `.next/BUILD_ID`.
- [ ] WHEN the built server is started with `npm start`, with `.env.local` populated from a
      running local Supabase instance via `scripts/write-supabase-test-env.mjs .env.local`, and
      queried at `/login` THE SYSTEM SHALL respond with HTTP 200.
- [ ] WHEN README.md's "Despliegue en Vercel" section is inspected THE SYSTEM SHALL list all 7
      variable names from `.env.example` (`NEXT_PUBLIC_SUPABASE_URL`,
      `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`,
      `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`).
- [ ] WHEN README.md's "Despliegue en Vercel" section is inspected THE SYSTEM SHALL state that the
      Vercel project's Node.js Version setting must be `22.x`.
- [ ] WHEN `package.json`'s `engines.node` is inspected THE SYSTEM SHALL still read `22.x`,
      unchanged since step 1.

**Verify**
```bash
npx supabase start
# expect: exit 0 — no-op if already running

node scripts/write-supabase-test-env.mjs .env.local
# expect: exit 0, writes .env.local with local Supabase credentials

npm run build
# expect: exit 0
test -f .next/BUILD_ID
# expect: exit 0

npm start & SERVER_PID=$!; sleep 3; CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login); kill $SERVER_PID; test "$CODE" = 200
# expect: exit 0 — the built server actually serves the public /login route, against local Supabase

npx supabase stop
# expect: exit 0

for v in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY NEXT_PUBLIC_APP_URL GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REDIRECT_URI; do grep -q "$v" README.md || exit 1; done
# expect: exit 0

grep -q "22.x" README.md
# expect: exit 0

node -e "const p=require('./package.json'); if(p.engines.node !== '22.x') process.exit(1)"
# expect: exit 0
```

**Checkpoint**
```bash
git add -A && git commit -m "step 10: production build verification + Vercel deploy readiness"
git tag step-10-production-build-vercel-readiness
```

---

## 10. Configuración del entorno

### Prerrequisitos

| Herramienta | Versión | Verificación |
|---|---|---|
| Node.js | 22.x (`>= 22.22.2` — mínimo real de `jsdom@30`, ver §11) | `node -v` |
| npm | la que trae el Node anterior (repo ya usa `package-lock.json` `lockfileVersion: 3`) | `npm -v` |
| Docker | cualquier versión reciente con el daemon corriendo (para `supabase start`, Paso 6) | `docker info` |
| Git | cualquiera reciente | `git --version` |

### Cuentas a crear primero

Ninguna nueva. El proyecto ya requiere una cuenta de Supabase (existente) y, opcionalmente, una de
Google Cloud (existente, para Google Calendar). Este blueprint no agrega ningún servicio de
terceros nuevo — Supabase local para pruebas corre en Docker, sin cuenta.

### Variables de entorno

| Variable | Propósito | Dónde conseguirla | Requerida desde el paso | Secreta |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Existente — URL del proyecto Supabase | Panel Supabase → Settings → API | ya requerida (app existente) | no |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Existente | Panel Supabase → Settings → API | ya requerida | no |
| `SUPABASE_SERVICE_ROLE_KEY` | Existente | Panel Supabase → Settings → API | ya requerida | sí |
| `NEXT_PUBLIC_APP_URL` | Existente | fijo en local | ya requerida | no |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Existente, opcional | Google Cloud Console | ya requerida si se usa Google Calendar | sí (secret) |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` (valor **local**, en `.env.test.local`) | Apuntan a la Supabase local de Docker durante `npm run test:integration` | generadas por `scripts/write-supabase-test-env.mjs` a partir de `npx supabase status -o json` | Paso 6 | no (son credenciales de una instancia local efímera, nunca de producción) |

`.env.example` ya está commiteado con las 7 variables de producción, sin cambios de contenido. Las
variables locales de prueba viven solo en `.env.test.local`, generado en tiempo de ejecución por el
Paso 6 y nunca commiteado (ver "Archivos que deben estar commiteados" abajo).

**"Requerida desde el paso" no cambia nada aquí** — todas las variables de producción ya eran
requeridas por la aplicación antes de este blueprint; este cambio no agrega ninguna variable de
producto nueva, así que no hay riesgo de que un paso posterior rompa un gate anterior por
validación de entorno (regla 9 de §9).

### Archivos que deben estar commiteados

| Archivo | Por qué está commiteado | Línea de excepción en el ignore |
|---|---|---|
| `.eslintrc.json` | Config de lint nueva, Paso 2 | no coincide con ningún patrón de `.gitignore` — sin excepción necesaria |
| `vitest.config.ts`, `vitest.setup.ts` | Emitidos por Bootstrap, §19.6 | no coinciden con ningún patrón — sin excepción necesaria |
| `supabase/config.toml` | Emitido por Bootstrap, §19.6 | no coincide — sin excepción necesaria |
| `.github/workflows/ci.yml` | Emitido por Bootstrap, §19 | no coincide — sin excepción necesaria |
| `CLAUDE.md`, `AGENTS.md`, `.claude/**` | Emitidos por Bootstrap, §19 | no coinciden — sin excepción necesaria |
| `scripts/write-supabase-test-env.mjs` | Paso 6 | no coincide — sin excepción necesaria |
| `tests/**` (todos los archivos de prueba) | Pasos 3–7 | no coinciden — sin excepción necesaria |
| `README.md` (editado) | Pasos 8, 10 | ya estaba commiteado |

**Verificado leyendo el `.gitignore` real del repo** (`/node_modules`, `/.next/`, `/out`, `/build`,
`.env`, `.env.local`, `.env*.local`, `.DS_Store`, `*.pem`, `npm-debug.log*`, `*.tsbuildinfo`,
`next-env.d.ts`): ninguno de los archivos de esta tabla coincide con ninguno de esos patrones.
`.env.test.local` (generado por el Paso 6, nunca commiteado) SÍ coincide con `.env*.local` —
correctamente, porque es justo el archivo que debe quedar fuera. Lo mismo para `.env.local`
(generado por el Paso 10), que coincide con dos patrones existentes.

**Este blueprint necesita tres líneas nuevas en `.gitignore`, repartidas entre dos pasos.** Ambas
ediciones salieron de ejecutar esos pasos en vivo (2026-09-24), no de leer el repo:

| Línea | La agrega | Por qué |
|---|---|---|
| `/coverage` | Paso 3 | El script `test:coverage` escribe un reporte HTML completo ahí; ningún patrón existente lo atrapa y el `git add -A` del Checkpoint de ese mismo paso lo commitearía entero. |
| `supabase/.temp/` | Paso 6 | `supabase start` genera ahí `start-secrets/**/docker.env` con las llaves de la instancia local. Un archivo `.env` versionado es inaceptable aunque sus valores sean las llaves demo públicas de Supabase local. |
| `supabase/.branches/` | Paso 6 | Mismo origen: estado efímero que el CLI escribe al arrancar. |

Ninguna otra edición al `.gitignore` hace falta en ningún otro paso.

### Bootstrap

```bash
# order matters: repo ya existe (brownfield, commit af06711) → copia de workspace/ → commit de
# los archivos nuevos → instalación baseline
git rev-parse --git-dir >/dev/null 2>&1 || git init -b main
# idempotent: no-op — este repo ya es un clone con al menos un commit

git log -1 >/dev/null 2>&1 || git commit -m "chore: scaffold" --allow-empty
# solo dispara si de verdad no hubiera ningún commit — no es el caso aquí, es defensivo

# 1. Copia workspace/ de este bundle a la raíz del proyecto — sin sobreescribir, seguro de
#    re-correr. Nunca sobreescribe en una segunda corrida: package.json, package-lock.json,
#    tsconfig.json, .eslintrc.json, README.md (todos editados por pasos posteriores; la copia
#    jamás debe revertir su contenido agregado por un paso).
#
#    Se hace con Node y no con `rsync` ni `cp -Rn`, por dos razones encontradas ejecutando este
#    bloque en vivo (2026-09-24): `rsync` no existe en Windows/Git Bash, y `cp -Rn` sale 1 en
#    BSD/macOS cuando omite correctamente un archivo existente (sale 0 en GNU) — es decir, la
#    segunda corrida de Bootstrap abortaría en una plataforma y no en la otra. Node ya es un
#    prerrequisito duro de este proyecto (§10), copia igual en las tres plataformas, nunca
#    sobreescribe, y siempre sale 0.
node -e "const fs=require('fs'),p=require('path');const src='blueprints/digital-planner/workspace';const walk=(d,t)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const s=p.join(d,e.name),x=p.join(t,e.name);if(e.isDirectory()){fs.mkdirSync(x,{recursive:true});walk(s,x);}else if(!fs.existsSync(x)){fs.copyFileSync(s,x);}}};walk(src,'.');"
# skips existing files, exits 0 either way, identical on Windows/macOS/Linux

# 2. Instalación baseline contra el lockfile EXISTENTE, sin modificar — prueba que la app actual
#    sigue instalando y construyendo tal cual, antes de cualquier cambio de tooling. Desde el
#    Paso 1 en adelante, cada paso corre su PROPIO `npm install -D` de forma incremental; esta
#    línea nunca pre-instala el tooling de pruebas.
npm install

# 3. Commitea los archivos recién copiados de workspace/ (CLAUDE.md, AGENTS.md, .claude/,
#    vitest.config.ts, vitest.setup.ts, supabase/config.toml, .github/workflows/ci.yml). Ninguna
#    de estas rutas coincide con ningún patrón del .gitignore existente (ver tabla arriba) — no se
#    necesita ninguna edición ni línea de excepción.
git add -A
git commit -m "chore: apply blueprint workspace (test tooling, CI, agent config)" --allow-empty
```

Cada comando de arriba es seguro de correr dos veces: `git rev-parse`/`git log -1` son chequeos
idempotentes con `||`, la copia en Node nunca sobreescribe y sale con 0 tanto si copió algo como si
no copió nada, `npm install` contra un lockfile ya instalado es un no-op rápido, y el
`git commit --allow-empty` final no falla si no hay nada nuevo que commitear. Ninguno abre un
prompt interactivo.

---

## 11. Dependencias

Cada pin de esta sección viene textual del reporte de `stack-researcher` de esta sesión (2026-09-24)
salvo donde se marca `UNVERIFIED` explícitamente — en ese caso, la razón de la elección se explica
en `Purpose` en vez de implicar una verificación que no ocurrió.

### Runtime (existente, sin re-pinear — reportado tal cual está instalado, por procedencia del
lockfile del repo)

| Paquete | Versión | Fuente | Verificado | Instalado por | Propósito |
|---|---|---|---|---|---|
| next | 14.2.35 | `package-lock.json` del repo (ya instalado) | 2026-09-24 | ya instalado — brownfield | Framework de la app; no se toca (no-objetivo) |
| react | ^18.3.1 | `package-lock.json` del repo | 2026-09-24 | ya instalado | UI |
| react-dom | ^18.3.1 | `package-lock.json` del repo | 2026-09-24 | ya instalado | UI |
| @supabase/ssr | ^0.5.2 | `package-lock.json` del repo | 2026-09-24 | ya instalado | Cliente Supabase con cookies (Server Components) |
| @supabase/supabase-js | ^2.45.4 | `package-lock.json` del repo | 2026-09-24 | ya instalado | Cliente Supabase; reusado por la prueba de integración del Paso 6 |
| date-fns | ^3.6.0 | `package-lock.json` del repo | 2026-09-24 | ya instalado | `lib/date-utils.ts` |
| date-fns-tz | ^3.2.0 | `package-lock.json` del repo | 2026-09-24 | ya instalado | `lib/tz.ts` |

### Development (existente, sin re-pinear salvo `@types/node`)

| Paquete | Versión | Fuente | Verificado | Instalado por | Propósito |
|---|---|---|---|---|---|
| typescript | ^5.5.2 | `package-lock.json` del repo | 2026-09-24 | ya instalado | Lenguaje; `strict: true` ya activo en `tsconfig.json` |
| tailwindcss | ^3.4.4 | `package-lock.json` del repo | 2026-09-24 | ya instalado | Estilos |
| postcss | ^8.5.28 | `package-lock.json` del repo | 2026-09-24 | ya instalado | Pipeline de Tailwind |
| autoprefixer | ^10.4.19 | `package-lock.json` del repo | 2026-09-24 | ya instalado | Pipeline de Tailwind |
| @types/react | ^18.3.3 | `package-lock.json` del repo | 2026-09-24 | ya instalado | Tipos |
| @types/react-dom | ^18.3.0 | `package-lock.json` del repo | 2026-09-24 | ya instalado | Tipos |
| **@types/node** | **^20.14.2 → ^22.x (bump)** | ecosistema existente, bump por el plazo Vercel Node 20 (§1) | 2026-09-24 | **Paso 1** | Tipos de Node coherentes con el runtime objetivo |

### Development — NUEVO en este blueprint (verificado en vivo por `stack-researcher` esta sesión)

| Paquete | Versión | Fuente | Verificado | Instalado por | Propósito |
|---|---|---|---|---|---|
| vitest | ^5.0.1 | `https://registry.npmjs.org/-/package/vitest/dist-tags` | 2026-09-24 | Paso 3 | Test runner |
| @vitejs/plugin-react | ^6.1.1 | `https://registry.npmjs.org/-/package/@vitejs/plugin-react/dist-tags` | 2026-09-24 | Paso 3 | JSX/Fast Refresh para Vitest |
| vite | ^8.3.1 | `https://registry.npmjs.org/-/package/vite/dist-tags` | 2026-09-24 | Paso 3 | Motor que Vitest usa por debajo |
| @testing-library/react | ^16.3.3 | `https://registry.npmjs.org/-/package/@testing-library/react/dist-tags` | 2026-09-24 | Paso 3 | `render()`/`screen` en el smoke test del toolchain |
| @testing-library/jest-dom | ^7.0.1 | `https://registry.npmjs.org/-/package/@testing-library/jest-dom/dist-tags` | 2026-09-24 | Paso 3 | Matchers DOM (`toBeInTheDocument`) cargados en `vitest.setup.ts` |
| jsdom | ^30.1.1 | `https://registry.npmjs.org/-/package/jsdom/dist-tags` | 2026-09-24 | Paso 3 | Entorno DOM de `vitest.config.ts` |
| @vitest/coverage-v8 | 5.0.1 (exacto — peerDependency exige coincidencia exacta con `vitest`) | `https://registry.npmjs.org/-/package/@vitest/coverage-v8/dist-tags` | 2026-09-24 | Paso 3 | `npm run test:coverage` |
| supabase | 2.117.0 (exacto) | confirmado instalado vía `npx supabase --version` en esta máquina | 2026-09-24 | Paso 6 | CLI para `supabase start`/`db reset`/`status`, local y en CI |

**Banderas de precaución, llevadas verbatim:** `@vitest/coverage-v8` tiene una peerDependency
sobre `vitest` que exige coincidencia de versión **exacta**, no un rango — ambos están pineados a
`5.0.1` idéntico. `jsdom@30.x` requiere Node `^22.22.2 || ^24.15.0 || >=26.0.0` (más estrecho que
`vitest@5` por sí solo) — esta es la razón concreta por la que §10 declara el prerrequisito como
`>= 22.22.2`, no simplemente "Node 22": cualquier Node 22 anterior al patch `22.22.2` haría fallar
la instalación o el arranque de `jsdom` con un error de rango de motor. `actions/checkout@v7` y
`actions/setup-node@v7` (node-version `'22'`) se usan en `.github/workflows/ci.yml` — ver §12.

### Development — NUEVO en este blueprint, `UNVERIFIED` (ver "Versiones sin verificar" en el
resumen de retorno de este blueprint)

| Paquete | Versión | Fuente | Verificado | Instalado por | Propósito |
|---|---|---|---|---|---|
| eslint | ^8.57.0 | `UNVERIFIED — no live-checked this session` — pineado a la última línea 8.x porque `eslint-config-next@14.x` excluye ESLint 9 en su peer range (config de estilo antiguo, no flat-config) | n/a — no verificado en vivo | Paso 2 | Motor de lint que `next lint` invoca |
| eslint-config-next | 14.2.35 | `UNVERIFIED — no live-checked this session` — pineado al mismo valor exacto que la versión ya instalada de `next` (14.2.35), siguiendo la convención documentada de Next.js de hacer coincidir ambas versiones | n/a — no verificado en vivo | Paso 2 | Config de lint específica de Next.js que hace que `next lint` deje de requerir el prompt interactivo |

Estos dos pines quedan honestamente marcados como no verificados en vivo — `stack-researcher` no
los resolvió esta sesión porque el hallazgo de que `next lint` nunca fue configurado surgió al leer
el repo, después de que se fijara la lista de paquetes a investigar. Son seguros por convención
documentada (coincidencia de versión con `next`, línea 8.x de ESLint por el peer range conocido de
`eslint-config-next@14`), pero deben re-verificarse con `stack-researcher` antes de que el Paso 2
corra `npm install`, si ha pasado tiempo desde la fecha de este blueprint.

### CI (acciones de GitHub, pineadas por versión de release, no por semver de npm)

| Acción | Versión | Fuente | Verificado | Instalado por | Propósito |
|---|---|---|---|---|---|
| actions/checkout | v7 | `https://api.github.com/repos/actions/checkout/releases/latest` | 2026-09-24 | emitido en `.github/workflows/ci.yml` (§19.6) | Clona el repo en el runner |
| actions/setup-node | v7 | `https://api.github.com/repos/actions/setup-node/releases/latest` | 2026-09-24 | emitido en `.github/workflows/ci.yml` (§19.6) | Instala Node 22 en el runner |

### Deliberadamente no usado

| Rechazado | En vez de eso | Por qué |
|---|---|---|
| `@playwright/test` (E2E de navegador) | Vitest de integración contra Postgres real (Paso 6) | No-objetivo explícito (§1) — la capa de mayor riesgo es la de datos, no la de UI, y este cambio la cubre a menor costo |
| pnpm | npm | El repo ya usa npm (`package-lock.json` `lockfileVersion: 3`); un cambio brownfield aditivo no reemplaza el gestor de paquetes existente |
| Biome | ESLint (`next/core-web-vitals`) | El repo usa Tailwind v3 + `next lint`, no el track Biome-first; introducir Biome ahora sería un cambio de tooling no solicitado y fuera del alcance aditivo de este blueprint |
| `dotenv` (paquete npm) | Cargador de `.env` casero de 15 líneas en `vitest.setup.ts` (§19.6) | Evita agregar una dependencia nueva solo para leer 3 líneas `CLAVE=valor`; cero riesgo de versión sin verificar |

La CLI de Vercel (`vercel@60.0.0`, verificada por `stack-researcher` el 2026-09-24 contra
`https://registry.npmjs.org/-/package/vercel/dist-tags`) **no aparece en esta tabla** porque no la
instala ningún paso — el despliegue de este proyecto ocurre vía integración Git de Vercel
(dashboard), no vía CLI local. Se documenta como herramienta opcional en §12.

---

## 12. Estrategia de despliegue

### Hosting

**Vercel**, integración Git nativa con `MauroGorrin/digital-planner` (sin cambios respecto al
target implícito ya existente — `.env.example` ya sigue las convenciones de Vercel). Build command:
`npm run build` (detectado automáticamente por el preset de Next.js de Vercel). Output: gestionado
por el preset de Next.js — sin `output: "standalone"` (no está configurado en `next.config.mjs`,
sin cambios). **Versión de Node del proyecto: `22.x`** — se fija en el ajuste "Node.js Version" del
panel de Vercel (Project Settings → General) y se documenta en `package.json` → `engines.node`
(Paso 1), como refuerzo, no como mecanismo primario (Vercel usa el ajuste del dashboard cuando
ambos están presentes).

**Herramienta opcional para despliegues manuales:** `vercel` CLI `60.0.0` (verificada,
`npm install -g vercel@60.0.0`) — no es una dependencia del proyecto, ningún paso la instala; solo
se documenta aquí para quien prefiera desplegar desde la terminal en vez del flujo Git automático.

### Entornos

| Entorno | Rama | URL | Base de datos | Modo de terceros |
|---|---|---|---|---|
| Local | — | `localhost:3000` | proyecto Supabase de desarrollo (existente) / Supabase local Docker (solo pruebas, Paso 6) | claves de prueba de Google (si aplica) |
| Preview | cualquier PR | auto-generada por Vercel | mismo proyecto Supabase de desarrollo (sin cambios — el repo no tenía branching de base de datos antes de este blueprint, y agregarlo es un no-objetivo) | claves de prueba |
| Producción | `main` | dominio configurado en Vercel (existente) | proyecto Supabase de producción (existente) | claves reales |

### CI/CD

`.github/workflows/ci.yml` (§19.6, Paso 8 lo verifica localmente): en cada `push` a `main`/`master`
y en cada `pull_request` — `actions/checkout@v7` → `actions/setup-node@v7` (Node 22, cache npm) →
`npm ci` → `npm run lint` → `npx tsc --noEmit` → `npm run test` → `npm run test:integration`
(Docker, Supabase local) → `npm run build`. Este es el mismo conjunto de comandos que §20.1 usa
como gate global — si un check está en el gate, está en CI, sin excepciones.

El despliegue en sí (Vercel) es un pipeline **separado**, disparado por la integración Git de
Vercel independientemente de GitHub Actions — Vercel corre su propio `npm run build` en cada push,
con las variables de entorno de producción del dashboard (§10).

### Release y rollback

Sin cambios respecto al comportamiento ya existente de Vercel: cada push a `main` dispara un deploy
de producción; un rollback es "Promote to Production" sobre un deployment anterior desde el
dashboard de Vercel (instantáneo, sin rebuild). Este blueprint no agrega ninguna migración de base
de datos, así que no hay una regla nueva de ordenamiento migración-vs-deploy que declarar.

### Dominio, DNS, TLS

Sin cambios — gestionados por Vercel, ya configurados antes de este blueprint.

---

## 13. Estrategia de pruebas

| Capa | Framework | Qué cubre | Dónde | Corre |
|---|---|---|---|---|
| Unitaria | Vitest 5 + jsdom + Testing Library | Lógica pura de mayor riesgo: firma HMAC (Paso 4), fecha/hora con zona horaria (Paso 5), upsert-sin-duplicado de calendario (Paso 7); toolchain smoke (Paso 3) | `tests/unit/**` | cada push/PR (CI) |
| Integración | Vitest (`--environment node`) contra Supabase local real (Docker) | Las 7 funciones `SECURITY DEFINER` de transición de estado, ejercitadas contra Postgres real — el gate de capa de datos (Paso 6) | `tests/integration/**` | cada push/PR (CI) |
| E2E | Ninguno (diferido) | — | — | — |

### Flujos críticos que cubrir con E2E

`NOT APPLICABLE — diferido explícitamente en §1, No-objetivos. La prueba de integración del Paso 6
más CI ya cubren la lógica de mayor riesgo (transiciones de estado, comportamiento adyacente a
RLS) a un costo mucho menor que Playwright. Revisar si alguna regresión llega a producción sin ser
detectada por la suite actual.`

### Datos de prueba

Para integración: base de datos Supabase local, creada por `supabase start` (Docker) y reseteada
por `supabase db reset` (reaplica `supabase/migrations/*.sql` desde cero en cada corrida de
`npm run test:integration`) — nunca comparte estado con el proyecto Supabase de desarrollo o
producción. Usuarios y filas de prueba se crean dentro del propio test y se borran en `afterAll`
(Paso 6) — nunca se deja un seed persistente. El archivo que provisiona el servicio localmente es
`supabase/config.toml` (§19.6); la variable que apunta a él (`NEXT_PUBLIC_SUPABASE_URL` local,
generada dinámicamente, no hardcodeada) se documenta en §10.

Para unitarias: no hay base de datos real — `@/lib/supabase/server` y `global.fetch` se mockean
siempre (Pasos 4, 5, 7; ver `.claude/rules/tests.md`).

### Qué se deja deliberadamente sin probar

- **Componentes de UI y páginas** (más allá del smoke de toolchain del Paso 3) — no-objetivo
  explícito de rediseño/pruebas de UI en §1; sin E2E ni pruebas de renderizado de componentes de
  producto.
- **Envío real de correo** — no-objetivo explícito (el proyecto ni siquiera lo implementa aún).
- **Intercambio real de tokens OAuth con los servidores de Google** — siempre mockeado en
  `tests/unit/lib/google-calendar-sync.test.ts`; nunca se golpea la API real de Google en ninguna
  prueba de este blueprint.
- **Endpoint HTTP real de Make.com** — siempre mockeado (`global.fetch`) en
  `tests/unit/webhooks/dispatch.test.ts`; el único servicio real que este blueprint prueba de punta
  a punta es la propia Supabase local (Paso 6), porque ahí vive la lógica de autorización de mayor
  riesgo.

---

## 14. Seguridad y secretos

| Concern | Control | Implementado en |
|---|---|---|
| Almacenamiento de secretos | Variables de entorno del dashboard de Vercel (producción); `.env.local` gitignored (local) — sin cambios | Vercel dashboard, `.gitignore` |
| Secreto de webhook (`webhook_configs.secret`) | Solo en la base de datos, protegido por RLS solo-admin — nunca al navegador — sin cambios | `supabase/migrations/0001_init.sql`, `lib/webhooks/dispatch.ts` |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo se lee en `lib/supabase/server.ts` (`createServiceClient`), código de servidor — sin cambios | `lib/supabase/server.ts` |
| Higiene de logs en pruebas nuevas | Las pruebas del Paso 4 usan un secreto de fixture (`'test-secret-please-ignore'`), nunca un secreto real, y ninguna aserción imprime el secreto crudo a stdout | `tests/unit/webhooks/dispatch.test.ts` |
| Credenciales de Supabase local | Nunca hardcodeadas — generadas en tiempo de ejecución por `scripts/write-supabase-test-env.mjs` desde `npx supabase status -o json`, escritas a `.env.test.local`, nunca commiteado | Paso 6, §10 |
| Verificación de webhooks entrantes | NOT APPLICABLE — este proyecto solo envía webhooks salientes (a Make), no recibe ninguno | — |
| Auditoría de dependencias | `npm audit` no es parte del gate de CI en este blueprint (fuera del alcance solicitado); recomendado como práctica manual periódica | fuera de este blueprint |
| Autenticación/Autorización | Sin cambios — ver §8 | `supabase/migrations/0001_init.sql` |

**Reglas duras (sin cambios, reafirmadas):**
- Ningún secreto se commitea, se imprime en un log, ni se embebe en un bundle de cliente.
- `SUPABASE_SERVICE_ROLE_KEY` nunca llega a un componente `"use client"`.
- Las funciones `SECURITY DEFINER` validan el permiso del llamador manualmente, porque RLS no
  aplica dentro de ellas — ver §8.

Este proyecto no maneja datos regulados de salud/financieros directamente; maneja datos personales
de contactos de clientes de una agencia (nombre, correo) bajo el control del propio usuario de la
agencia — sin cambios de postura respecto al estado antes de este blueprint.

---

## 15. Accesibilidad

**NOT APPLICABLE — este blueprint no incluye ningún cambio de UI/UX** (ver §1, No-objetivos). La
postura de accesibilidad de la aplicación existente no se toca ni se audita en este cambio. No hay
gate automatizado de accesibilidad en §20.1 por la misma razón — la única herramienta de
navegador que lo haría posible (Playwright + axe) es un no-objetivo explícito de este blueprint.

---

## 16. Observabilidad y costo

### Instrumentación

| Señal | Herramienta | Qué captura | Quién lo mira |
|---|---|---|---|
| Errores de build/deploy | Logs de build de Vercel (existente) | Fallos de `npm run build` en cada push | Quien despliega |
| Logs de función serverless | Logs de runtime de Vercel (existente) | Errores no manejados en Server Actions / route handlers | Quien despliega |
| Resultado de CI | GitHub Actions (nuevo, Paso 8) | Pass/fail de lint, typecheck, unitarias, integración, build en cada push/PR | Todo el equipo, vía el check de PR |

Este blueprint no agrega una herramienta de observabilidad de producción nueva (Sentry, Datadog,
etc.) — está fuera del alcance solicitado. El resultado de CI es la única señal de observabilidad
nueva que agrega, y su "quién lo mira" es el propio flujo de PR de GitHub.

### Métricas que importan para este cambio

| Métrica | Objetivo | Alerta en |
|---|---|---|
| % de runs de CI en verde tras el merge del Paso 10 | 100% | Cualquier run rojo — visible en la pestaña Actions |
| Tiempo de `npm run test:integration` en CI | bajo ~3 minutos (incluye `supabase start` en Docker) | si supera ~8 minutos, revisar si el runner de Docker está lento |

### Health check

Sin cambios — no existe un endpoint de health check dedicado en la aplicación antes de este
blueprint, y agregar uno está fuera de alcance (sería una funcionalidad de producto nueva). El
smoke check del Paso 10 (`curl` a `/login`) cumple el rol de "el servidor construido responde" para
efectos de este blueprint, no es un health check de producción.

### Modelo de costo

| Servicio | Free tier | Costo a la escala actual | Costo a 10× | Riesgo a vigilar |
|---|---|---|---|---|
| GitHub Actions (repo público o privado con minutos incluidos) | 2,000 min/mes en plan gratuito de repos privados | ~5-8 min por run × runs/mes — dentro del free tier a este volumen | Si el equipo crece y hay muchos PRs/día, podría acercarse al límite | El job de integración con Docker es el más lento — si el costo se vuelve un problema, es el primer candidato a mover a "solo en `main`", no a eliminar |
| Vercel (hosting, sin cambios) | según el plan ya contratado | sin cambios por este blueprint | sin cambios | fuera de alcance |
| Supabase (proyecto de producción, sin cambios) | según el plan ya contratado | sin cambios | sin cambios | fuera de alcance |

**Costo mensual adicional estimado de este blueprint: $0** a la escala actual (GitHub Actions
dentro del free tier). La palanca más barata si algún día deja de estarlo: correr
`npm run test:integration` solo en `main`, no en cada PR, y dejar `npm run test` (unitarias,
segundos) en cada PR.

---

## 17. Enrutamiento de modelos

**NOT APPLICABLE — este proyecto no llama a ningún LLM en tiempo de ejecución.**

---

## 18. Skills a usar durante la construcción

| Skill | Pasos de build | Por qué | Instalación |
|---|---|---|---|
| `pdf` | ninguno en este blueprint | No aplica — este cambio no procesa PDFs | `/plugin marketplace add anthropics/skills` luego `/plugin install document-skills@anthropic-agent-skills` |

Este blueprint es tooling/CI/pruebas puro sobre una app ya construida — no hay diseño visual
(`ui-ux-pro-max`), extracción de contenido web (`agent-browser`), ni E2E de navegador
(`playwright-cli`, explícitamente diferido, §1) en su alcance. Ninguna skill de las registradas en
`knowledge/skills-registry.md` aplica a los 10 pasos de §9; se deja esta sección con la tabla vacía
de propósito en vez de forzar una skill irrelevante.

---

## 19. Workspace de agente

Ver §3 para el árbol completo. Todos los archivos de esta sección son reales bajo
`blueprints/digital-planner/workspace/` en este bundle, copiados a la raíz del proyecto por la
copia guardada de §10 antes de que corra el Paso 1.

**Nota brownfield:** este repo no tenía `CLAUDE.md` ni `AGENTS.md` antes de este blueprint (brecha
confirmada, §1) — así que §19.1 y §19.2 no son un merge sobre un archivo existente, son una
adición limpia.

### 19.1 `CLAUDE.md`

Ver el archivo completo en `workspace/CLAUDE.md` de este bundle (copiado textual abajo por
completitud del blueprint; el archivo real es la fuente de verdad).

```markdown
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
```

(88 líneas — bajo el tope de 200.)

### 19.2 `AGENTS.md`

```markdown
# digital-planner — instrucciones para agentes

Planificador de contenido para agencia + clientes: calendario compartido, aprobación con estados,
Google Calendar y webhooks a Make. Next.js 14 + Supabase (Postgres/Auth/Storage/RLS).

## Comandos

| Tarea | Comando |
|---|---|
| Instalar | `npm install` |
| Dev | `npm run dev` |
| Build | `npm run build` |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Pruebas unitarias | `npm run test` |
| Pruebas de integración | `npm run test:integration` |

## No negociable

1. Nunca cambies `content_pieces.status` fuera de las funciones `SECURITY DEFINER` en
   `supabase/migrations/0001_init.sql`.
2. Nunca expongas `SUPABASE_SERVICE_ROLE_KEY` a código cliente.
3. Nunca edites una migración ya aplicada — agrega una nueva.
4. Nunca mockees Postgres en `tests/integration/**`.
5. Nunca marques una tarea terminada con el gate en rojo.

Arquitectura completa, límites entre capas y tokens de diseño: ver `CLAUDE.md` en este directorio.
```

### 19.3 `.claude/settings.json`

Ver el archivo completo en `workspace/.claude/settings.json`. Cada comando `Verify` de §9 y cada
línea del gate global de §20.1 tiene una entrada correspondiente en `permissions.allow`:
`npm install`, `npm ci`, `npm run dev`, `npm run build`, `npm run typecheck`, `npm run lint`,
`npm run test` (y sus variantes `test:watch`/`test:coverage`/`test:integration`),
`npm run db:test:stop`, `npm start`, `npx tsc --noEmit`, `npx vitest`, `npx supabase`, el script de
Node del Paso 6, cada `node -e` de verificación, y los comandos de `git` que usa cada Checkpoint.
Denegado explícitamente: lectura de `.env`/`.env.local`/`.env.*.local`, `git push` (con y sin
`--force`), y los dos comandos de Supabase que tocan un proyecto remoto (`db push`, `link`) — este
blueprint solo usa Supabase **local**.

### 19.4 Skills del proyecto — `.claude/skills/approval-flow-webhooks/SKILL.md`

Ver el archivo completo en `workspace/.claude/skills/approval-flow-webhooks/SKILL.md`. Documenta,
como referencia repetible: el diagrama completo de la máquina de estados de `content_status` (7
valores), quién puede llamar cada una de las 7 funciones `SECURITY DEFINER`, el catálogo completo
de `webhook_event_type` (7 valores) con el momento exacto en que cada uno se dispara, y los pasos
para agregar una transición o un evento nuevo sin romper el patrón existente.

| Skill | Se activa con | Qué automatiza |
|---|---|---|
| `approval-flow-webhooks` | tocar `app/actions.ts`, cualquier función `SECURITY DEFINER`, `lib/webhooks/dispatch.ts`, o escribir una prueba de integración sobre transiciones | Referencia de la máquina de estados + catálogo de webhooks, para no romper el patrón al extenderlo |

### 19.5 `.claude/rules/*.md`

| Archivo | Globs `paths` | Cubre |
|---|---|---|
| `.claude/rules/tests.md` | `tests/**`, `vitest.config.ts`, `vitest.setup.ts`, `scripts/write-supabase-test-env.mjs` | Cuándo mockear vs. cuándo usar Supabase local real, limpieza de `afterAll`, convención de nombres de prueba |

Un solo archivo de reglas es suficiente para el alcance de este cambio (tooling de pruebas/CI/
despliegue) — no hay un área de "pagos", "esquema de datos nuevo" ni "estilos" que justifique un
segundo archivo, porque este blueprint no toca ninguna de esas áreas.

### 19.6 Configuración crítica para Verify e infraestructura local

Toda la infraestructura que los comandos `Verify` de §9 necesitan para correr está emitida aquí,
como archivo real bajo `workspace/` en este bundle.

| Archivo | Ruta en el proyecto | Qué `Verify` lo necesita | Manejo de resolución/env que lleva | Exclusión de la ruta del bundle |
|---|---|---|---|---|
| `vitest.config.ts` | `./vitest.config.ts` | Pasos 3, 4, 5, 7 (`npx vitest run tests/unit/**`) | Alias `"@"` → raíz del repo, espejo del `paths` de `tsconfig.json`; `test.exclude` incluye `**/blueprints/**` | `**/blueprints/**` en `test.exclude` y en `coverage.exclude` |
| `vitest.setup.ts` | `./vitest.setup.ts` | mismos pasos — cargado vía `setupFiles` | Cargador de `.env.test.local` casero (sin dependencia nueva), más `@testing-library/jest-dom` | n/a — no camina el árbol |
| `supabase/config.toml` | `./supabase/config.toml` | Paso 6 (`npx supabase start`, `npx supabase db reset`) | n/a — config del CLI, no lee env vars de Node | n/a — el CLI de Supabase no camina archivos de proyecto fuera de `supabase/` |
| `.github/workflows/ci.yml` | `./.github/workflows/ci.yml` | Paso 8 (verificado localmente, luego ejecutado por GitHub) | `actions/setup-node@v7` con `node-version: '22'` — no necesita loader de env, GitHub inyecta secretos vía UI si algún día se necesitan | n/a — corre fuera del árbol de trabajo del repo |
| `CLAUDE.md`, `AGENTS.md` | raíz del proyecto | Paso 9 | n/a | n/a |
| `.claude/settings.json` | `./.claude/settings.json` | Paso 9 | n/a | n/a |
| `.claude/skills/approval-flow-webhooks/SKILL.md` | `./.claude/skills/approval-flow-webhooks/SKILL.md` | Paso 9 | n/a | n/a |
| `.claude/rules/tests.md` | `./.claude/rules/tests.md` | Paso 9 (existencia) | n/a | n/a |

**Config completa para el stack que este blueprint manda.** `vitest.config.ts` resuelve
`@testing-library/react`, `@testing-library/jest-dom` y `jsdom` sin ninguna condición de export ni
alias especial — los tres son paquetes de resolución plana, ninguno tiene un entry point
bundler-only ni un binario nativo que Vitest no resuelva por defecto. `@vitest/coverage-v8` se
activa vía `test.coverage.provider: 'v8'` en el mismo archivo. Ningún paquete mandado por este
blueprint requiere una línea de config adicional para resolver.

**Cada herramienta que lee variables de entorno tiene un cargador declarado.** `npx supabase`
(CLI) lee sus propias variables de su config TOML y de flags — no necesita un `.env` cargado por
Node. El único código de este blueprint que lee `process.env` fuera del framework de Next.js es
`tests/integration/state-transitions.test.ts` (a través de `@supabase/supabase-js`, construido con
`process.env.NEXT_PUBLIC_SUPABASE_URL` etc.) y `scripts/write-supabase-test-env.mjs` (que
**escribe**, no lee, esas variables). El mecanismo de carga es el cargador casero en
`vitest.setup.ts`, declarado como `setupFiles` en `vitest.config.ts` — un único punto de
declaración, presente en cada invocación de Vitest (`npm run test`, `npm run test:integration`),
así que no hay un segundo call site que pudiera olvidarse de cargarlo.

#### Matriz de convención de resolución

`NOT APPLICABLE — este blueprint no declara ninguna convención de import/link nueva.` El alias
`"@/*" → "./*"` ya existe en `tsconfig.json` antes de este blueprint, y `vitest.config.ts` lo
espeja sin introducir una forma de especificador distinta ni una condición de export nueva — ver
§3.

#### Reconciliación de valores entre artefactos

| Valor compartido | Fuente única — el archivo que lo decide | Valor literal | Cada otro lugar donde aparece | Comparado |
|---|---|---|---|---|
| Versión de Node | `package.json` → `engines.node` (Paso 1) | `22.x` | `.github/workflows/ci.yml` → `node-version: '22'` (§19.6, Bootstrap) · README.md "Despliegue en Vercel" (Paso 10) · Prerrequisitos §10 | sí — los tres se verifican en el `Verify` de los Pasos 1, 8 y 10 respectivamente, y §20.1 los re-verifica juntos |
| Comando de pruebas unitarias | `package.json` → script `"test"` (Paso 3) | `vitest run tests/unit` | `.github/workflows/ci.yml` (invoca `npm run test`, nunca el comando crudo) · `CLAUDE.md` tabla de comandos · cada `Verify` de los Pasos 8, 20.1 | sí — todos invocan el script por nombre (`npm run test`), nunca duplican el comando crudo, así que no hay dos formas del mismo valor que puedan divergir |
| Nombre del check de CI | `.github/workflows/ci.yml` → `jobs.test` | `test` (el job); el workflow se llama `CI` | README.md sección "## CI" (Paso 8, describe el nombre del check como `CI / test`) | sí — Paso 8 lee el YAML real antes de escribir el nombre en README, no lo inventa |
| Puerto de Supabase local (API) | `supabase/config.toml` → `[api] port` | `54321` | generado dinámicamente en `.env.test.local` vía `npx supabase status -o json` (nunca escrito a mano en ningún otro archivo) | sí — como el puerto nunca se copia a mano a un segundo archivo (siempre se lee del propio `supabase status` en tiempo de ejecución), no hay una segunda copia que pueda desincronizarse |

#### Reconciliación de artefactos byte-exactos

`NOT APPLICABLE — este blueprint no autora ningún golden file, fixture de salida esperada, ni
snapshot que un Verify compare byte a byte contra un literal.` Cada aserción de prueba en los
Pasos 4, 5, 6, 7 compara contra un valor **calculado dentro de la misma prueba** (la firma HMAC se
recalcula con el mismo algoritmo, el `HH:mm` esperado se deriva de la misma librería `date-fns-tz`
que el código bajo prueba usa, el conteo de filas se consulta directamente a Postgres después de la
operación) — no contra un literal transcrito de memoria o de una corrida anterior. No hay, por lo
tanto, ninguna reconciliación pendiente contra el runtime pineado en §11: cada valor esperado se
produce con el mismo runtime que produce el valor real, en la misma ejecución.

---

## 20. Compuerta de aceptación, riesgos y bitácora de decisiones

### 20.1 Compuerta de aceptación global

El cambio está **terminado** cuando cada comando de abajo sale con 0 en un checkout limpio, y no
antes. Es el mismo conjunto que corre CI (§12) y el mismo contra el que se mide cada paso de §9.

```bash
npm ci                             # expect: exit 0
npm run typecheck                  # expect: exit 0, zero errors
npm run lint                       # expect: exit 0, zero error-level findings
npm run test                       # expect: exit 0, 0 failed, 0 skipped
npm run test:integration           # expect: exit 0, 0 failed, 0 skipped — the data-layer gate
npm run build                      # expect: exit 0
npx supabase start                 # expect: exit 0 — see Paso 10: /login needs a live Supabase
node scripts/write-supabase-test-env.mjs .env.local
                                    # expect: exit 0 — local credentials, never production ones
npm start & SERVER_PID=$!; sleep 3; CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login); kill $SERVER_PID; test "$CODE" = 200
                                    # expect: exit 0 — proves the built artifact the manifest
                                    #         declares is the one the build actually produced
npx supabase stop                  # expect: exit 0 — cleanup
```

No hay línea de accesibilidad automatizada en este gate — ver §15, `NOT APPLICABLE`, mismo motivo
(sin cambios de UI, herramienta de navegador diferida explícitamente en §1).

Más estas compuertas manuales, cada una revisada una vez antes de considerar el cambio cerrado:

- [ ] Cada paso de §9 tiene su tag de checkpoint en git (`git tag -l 'step-*'` lista las 10:
      `step-01-node22-target` … `step-10-production-build-vercel-readiness`). El repositorio donde
      viven estos tags ya existía antes de este blueprint (commit `af06711`) — el Bootstrap de §10
      lo confirma, no lo crea de cero.
- [ ] Cada archivo de la tabla "Archivos que deben estar commiteados" (§10) está presente en un
      checkout limpio: `git ls-files --error-unmatch <ruta>` sale 0 para cada uno (una invocación
      por ruta), y `git check-ignore -q <ruta>; test $? -eq 1` sale 0 para cada uno (probando que
      ningún patrón del `.gitignore` lo atrapa — nunca `! git check-ignore -q a b`, que saldría 128
      por uso incorrecto con dos rutas, no por la propiedad real).
- [ ] El `.gitignore` fue tocado por exactamente un paso de §9 — el Paso 3, que agrega `/coverage`
      (ver §10). `git check-ignore -q coverage; test $? -eq 0` sale 0, y ningún otro paso lo
      modificó.
- [ ] `npm ci` fue re-corrido una vez sobre un árbol ya bootstrapeado (`git status --porcelain`
      antes y después no cambia nada relevante), y la copia guardada de `workspace/` (§10, `rsync
      --ignore-existing`) fue re-corrida una vez y salió 0 sin revertir ningún archivo editado por
      un paso (`package.json`, `tsconfig.json`, `.eslintrc.json`, `README.md` siguen con su
      contenido post-Paso-10, no con el contenido original de `workspace/`).
- [ ] Cada fila de la tabla "Reconciliación de valores entre artefactos" (§19.6) lee `Comparado:
      sí`.
- [ ] §9.1 es `NOT APPLICABLE` — confirmado, no hay parity/cutover que ejercitar.
- [ ] Cada no-objetivo de §1 sigue sin construirse.
- [ ] Cada variable de entorno de §10 está fijada en producción (Vercel dashboard) y ausente del
      repo.
- [ ] Antes del **2026-10-01**: el ajuste "Node.js Version" del proyecto en Vercel está en `22.x`
      (confirmado a mano en el dashboard — este es el plazo externo real que motiva §1/§11).

**Ninguna advertencia se ignora.** Una advertencia tolerada se vuelve una advertencia permanente, y
la próxima advertencia real se esconde dentro de ella.

### 20.2 Registro de riesgos

| Riesgo | Probabilidad | Impacto | Señal temprana | Mitigación |
|---|---|---|---|---|
| El salto de Node 20→22 revela una diferencia sutil de comportamiento en runtime | Baja | Medio | Un test que pasaba en Node 20 falla en Node 22, o un comportamiento distinto en producción tras el deploy | CI corre en Node 22 antes de cualquier merge (Paso 8); la app existente no tiene código sensible a la versión de Node (uso puro de Next.js/React/SDK de Supabase, sin APIs nativas de Node de bajo nivel) |
| Supabase local (Docker) puede no estar disponible en todos los runners de CI por defecto | Baja | Alto (bloquearía el gate de capa de datos en CI) | El job `test:integration` falla en `supabase start`, no en una aserción | Los runners `ubuntu-latest` de GitHub Actions traen Docker preinstalado — compatibilidad confirmada; si algún día se cambia de runner, esta fila es la primera en revisarse |
| Manejo del secreto HMAC: el secreto del webhook nunca debe aparecer en un bundle de cliente ni en logs | Baja | Alto | Un secreto real apareciendo en un log de CI o en un mensaje de commit | El código existente ya mantiene el secreto solo en servidor/base de datos (según el README); las pruebas nuevas (Paso 4) usan un secreto de fixture, nunca el real, y ninguna aserción lo imprime a stdout |
| `next/core-web-vitals` revela hallazgos de nivel `error` en código nunca antes linteado (Paso 2) | Media | Bajo | `npm run lint` sale distinto de 0 la primera vez que corre en el Paso 2 | El Paso 2 permite corregir esos hallazgos como cambios mínimos no conductuales (key faltante, import sin usar); si el volumen fuera grande, es señal para dividir el Paso 2 en dos antes de continuar |
| Los pines de `eslint`/`eslint-config-next` están marcados `UNVERIFIED` (§11) | Baja | Medio (instalación fallida en el Paso 2) | `npm install -D eslint@^8.57.0 eslint-config-next@14.2.35` falla o resuelve una combinación con conflicto de peer | Re-correr `stack-researcher` sobre estos dos paquetes específicamente antes de ejecutar el Paso 2, si ha pasado tiempo desde la fecha de este blueprint |
| El plazo de deprecación de Node 20 en Vercel (2026-10-01) es en 7 días desde la fecha de este blueprint | Alta (el plazo es fijo) | Alto si no se cumple (nuevos despliegues podrían rechazarse en Vercel) | Cualquier intento de deploy en Vercel con Node 20 fijado después del plazo | Los Pasos 1 y 10 fijan Node 22 en `package.json` y documentan el ajuste del dashboard de Vercel; priorizar completar el Paso 10 antes del 2026-10-01 |

### 20.3 Bitácora de decisiones

| # | Decisión | Alternativa rechazada | Por qué | Se revertiría si |
|---|---|---|---|---|
| 1 | Node 22 como target de runtime | Quedarse en Node 20 | Vercel deshabilita Node 20 para despliegues nuevos el 2026-10-01 (confirmado en vivo por `stack-researcher`) — no es una preferencia, es una obligación externa con fecha | Vercel revirtiera o pospusiera esa deprecación (poco probable, pero sería la única razón) |
| 2 | Vitest sobre Jest para el runner de pruebas | Jest | El track `ts-node` recomienda Vitest por defecto (`knowledge/runtime-tracks/ts-node.md`); comparte motor con Vite/`@vitejs/plugin-react`, arranque más rápido | El equipo ya tuviera una suite grande de Jest en otro repo compartido y quisiera consistencia entre repos |
| 3 | Prueba de integración contra Supabase local real (Docker) en vez de mockear Postgres | Mockear `supabase-js` en la prueba de "integración" también | Las funciones `SECURITY DEFINER` son la lógica de autorización real del producto — un mock de Postgres no las ejercitaría en absoluto, dejando el riesgo más alto del sistema sin cubrir | Si algún día la lógica de autorización se moviera fuera de Postgres a la capa de aplicación |
| 4 | Diferir E2E con Playwright | Agregar Playwright ahora junto con Vitest | Costo de mantenimiento alto para un cambio cuyo objetivo es cerrar brechas de higiene rápido; la combinación integración+CI ya cubre el riesgo más alto a menor costo | Una regresión llega a producción sin haber sido detectada por la suite actual (criterio explícito del no-objetivo en §1) |
| 5 | ESLint (`next/core-web-vitals`) en vez de migrar a Biome | Biome, como recomienda el track `ts-node` para proyectos nuevos | El repo usa Tailwind v3 (config JS) y `next lint` ya definido en `package.json`; migrar el linter es un cambio de tooling no solicitado y fuera del alcance aditivo de este blueprint | Un blueprint futuro decidiera migrar el stack de estilos/lint completo |
| 6 | `eslint`/`eslint-config-next` pineados por convención documentada, marcados `UNVERIFIED` en vez de bloquear la generación de este blueprint | Detener el blueprint entero pidiendo una verificación en vivo de estos dos paquetes | El hallazgo de que `next lint` nunca fue configurado surgió leyendo el repo, después de fijada la lista de paquetes a investigar en esta sesión; un pin por convención documentada y honestamente marcado es preferible a bloquear todo el blueprint por dos paquetes de bajo riesgo | `stack-researcher` verificara estos dos pines y encontrara un conflicto real |
| 7 | Cargador de `.env` casero en `vitest.setup.ts` en vez de agregar `dotenv` como dependencia | `dotenv` | Evita una dependencia nueva sin verificar en vivo para una tarea de 15 líneas; cero superficie de cadena de suministro adicional | El proyecto necesitara parsing de `.env` más sofisticado (variables anidadas, interpolación) en el futuro |
| 8 | El health-check de `/login` del Paso 10 corre contra la Supabase **local** (reutilizando el script del Paso 6 con destino `.env.local`) | Exigir que quien construya ya tenga un `.env.local` de producción configurado a mano antes del Paso 10 | Encontrado ejecutando el smoke-test de este blueprint en vivo: `middleware.ts` construye un cliente de Supabase en cada request y responde 500 sin credenciales reales — el chequeo original habría fallado en cualquier checkout limpio. Reutilizar la Supabase local (ya requerida por el Paso 6) hace el Paso 10 autocontenido, sin depender de un secreto de producción que el blueprint no puede proveer | Si `middleware.ts` alguna vez dejara de requerir Supabase en cada request (cambio de arquitectura fuera de alcance de este blueprint) |

### 20.4 Qué construir después

1. Pruebas E2E con Playwright sobre los flujos críticos (crear pieza → enviar a revisión → aprobar
   → programar → publicar) — disparador: una regresión llega a producción sin ser detectada por la
   suite actual (§1, no-objetivo #1).
2. Envío real de correo transaccional, vía el proveedor que el usuario elija — disparador: el
   usuario elige un proveedor de correo (§1, no-objetivo #2).
3. Observabilidad de producción dedicada (Sentry o similar) más allá de los logs de Vercel —
   disparador: un incidente en producción que los logs de Vercel no permitieron diagnosticar
   rápido.
4. Ejecutar `npm run test:integration` solo en `main` (no en cada PR) si el volumen de PRs hace que
   el minutaje de GitHub Actions se acerque al límite del free tier — disparador: ver §16, modelo
   de costo.

---

*Fin del blueprint. El orden de construcción es §9. Detente cuando §20.1 esté en verde.*
