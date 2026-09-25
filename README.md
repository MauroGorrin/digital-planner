# Planner de Contenido

Aplicación web responsive para que una agencia de marketing y sus clientes planifiquen, revisen y aprueben contenido para redes sociales: calendario compartido, fichas de contenido con adjuntos y comentarios, flujo de aprobación, integración con Google Calendar y webhooks para Make.

## Stack

- **Next.js 14** (App Router, TypeScript, Server Actions)
- **Supabase**: Postgres + Auth + Storage + Row Level Security + Realtime
- **Tailwind CSS**
- Sin dependencias de terceros para el calendario/drag&drop (implementación nativa) para mantener el bundle ligero.

## 1. Crear el proyecto de Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. En **SQL Editor**, ejecuta en orden:
   - `supabase/migrations/0001_init.sql` (esquema, roles, RLS, funciones de transición de estado)
   - `supabase/migrations/0002_storage.sql` (bucket privado `attachments` y políticas)
   - `supabase/migrations/0003_attachment_versions.sql` (versionado de adjuntos y límites del
     bucket) — **paso manual antes de aplicarla:** verifica que el límite global de storage del
     proyecto, en el panel de Supabase, **Settings → Storage → "Upload file size limit"**, esté
     en 50 MB. En el plan gratuito de Supabase ese límite global es 50 MB por defecto y **no se
     puede subir sin mejorar de plan**, así que normalmente no hay nada que cambiar acá — solo
     confirmarlo. Supabase aplica `min(límite global del proyecto, límite del bucket)`, y esta
     migración solo toca el límite del bucket con un `update` directo a `storage.buckets`; el
     valor que fija (50 MB) ya está alineado con el tope del plan gratuito, así que no hay
     discrepancia entre ambos. Si en el futuro se mejora el plan de Supabase y se sube el límite
     global desde el panel, hay que subir también el número en los tres lugares donde vive (ver
     abajo).
3. En **Authentication > Providers**, deja activado el login por correo/contraseña. Para que las invitaciones envíen correo, configura un proveedor SMTP en **Authentication > Email Templates / SMTP Settings** (si no configuras SMTP, el usuario se crea igualmente pero deberás compartirle el enlace de invitación o restablecer su contraseña manualmente desde el panel de Supabase).
4. Crea al primer administrador manualmente: en **Authentication > Users**, crea un usuario con su correo, y en la tabla `profiles` (se crea automáticamente) actualiza su `role` a `agency_admin`:
   ```sql
   update profiles set role = 'agency_admin' where email = 'tu-correo@agencia.com';
   ```

### Adjuntos: límites, flujo de subida y versionado

**Límites — el contrato del producto.** 50 MB por archivo. Tipos permitidos: `image/jpeg`,
`image/png`, `image/webp`, `image/gif`, `video/mp4`, `video/quicktime` (`.mov`), `video/webm`,
`application/pdf`.

El tope de 50 MB no es una decisión de producto: el proyecto de Supabase está en el **plan
gratuito**, cuyo *Global file size limit* es 50 MB y no admite más sin mejorar de plan. Ese límite
global manda sobre el límite del bucket (Supabase aplica el mínimo de los dos), así que aunque el
bucket dijera un número mayor, el servidor seguiría cortando en 50 MB. Para subir el tope hay que:
1. mejorar el plan de Supabase y subir el límite global desde el panel (**Settings → Storage →
   "Upload file size limit"**), y
2. después subir el mismo número en los tres lugares donde vive en el código —
   `lib/attachments.ts` (`TAMANO_MAXIMO_BYTES`), `supabase/migrations/0003_attachment_versions.sql`
   (`file_size_limit` del `update storage.buckets`) y `supabase/config.toml`
   (`[storage] file_size_limit`) — que hay que mantener sincronizados a mano.

**Por qué la subida es navegador → XHR → base, y no una Server Action.** El flujo real es:
`createSignedUploadUrl()` (URL firmada de un solo uso) → `PUT` a esa URL con `XMLHttpRequest` →
insert en `attachments`. Dos motivos lo obligan, y son la razón de que esto no se "simplifique":
- Vercel corta el cuerpo de un request de función serverless cerca de 4,5 MB; un archivo de 150 MB
  nunca llegaría si pasara por una Server Action o una ruta de API.
- El `upload()` del SDK de Supabase Storage usa `fetch` internamente, que no emite eventos de
  progreso — solo `XMLHttpRequest` los expone. Sin eso, la barra de progreso sería una animación
  inventada, no progreso real basado en bytes transferidos.

**Versionado por rondas.** La ronda de revisión (`review_round`) la asigna un trigger de Postgres
(`set_attachment_round()`, en `0003_attachment_versions.sql`) y nunca el navegador: cuenta las
transiciones a `cambios_solicitados` de la pieza y suma uno, sobrescribiendo lo que llegue del
cliente. Un adjunto es "vigente" si ningún otro lo reemplaza (`replaces_id`) — es un estado
derivado en cada lectura, no una columna guardada, para no tener un segundo estado que se
desincronice. "Subir nueva versión" en un adjunto fija su `replaces_id` y pliega la versión
anterior bajo la nueva.

Como las filas del historial también se pueden borrar, borrar un eslabón **intermedio** de una
cadena de versiones (con A ← B ← C, borrar B) hace que `C.replaces_id` quede en `null`
(`on delete set null`) y A se quede sin nada que la referencie: A reaparece en la lista como
adjunto vigente independiente, es decir, una versión vieja vuelve a mostrarse como actual. No hay
pérdida de datos ni error — es un efecto inherente a poder borrar el historial, y queda anotado acá
para que no sorprenda.

**La salvedad del `.mov`.** `video/quicktime` está entre los tipos permitidos a propósito: es lo
que exporta un iPhone y el equipo lo va a subir seguido. Pero su reproducción inline no está
garantizada fuera de Safari — en Chrome, por ejemplo, un `.mov` con códec HEVC puede no
reproducirse. Cuando el navegador no puede reproducirlo, la ficha lo detecta y muestra un aviso con
un enlace de descarga en vez de un reproductor roto (`components/AttachmentUploader.tsx`).

**`supabase/config.toml`.** El `file_size_limit` bajo `[storage]` es el límite de la Supabase local
(Docker) que usan `npm run test:integration` y el arranque rápido local. No se alimenta del límite
del bucket en `0003_attachment_versions.sql` ni viceversa — hay que mantenerlos sincronizados a
mano.

## 2. Variables de entorno

Copia `.env.example` a `.env.local` y completa:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=       # Settings > API > service_role. Nunca se expone al navegador.
NEXT_PUBLIC_APP_URL=http://localhost:3000
GOOGLE_CLIENT_ID=                # opcional, para la integración con Google Calendar
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google-calendar/callback
```

## 3. Instalar y correr

```bash
npm install
npm run dev
```

Abre `http://localhost:3000`, inicia sesión con el administrador creado en el paso 1.

## Roles y permisos

| Acción | Administrador | Equipo agencia | Cliente |
|---|---|---|---|
| Crear/editar clientes | ✅ | ✅ | ❌ |
| Invitar equipo/contactos | ✅ | ❌ | ❌ |
| Crear/editar/duplicar/eliminar piezas | ✅ | ✅ | ❌ |
| Ver calendario de todos los clientes | ✅ | ✅ | Solo el suyo |
| Aprobar / solicitar cambios | ❌ | ❌ | ✅ |
| Comentar | ✅ | ✅ | ✅ |
| Configurar webhooks / Google Calendar | ✅ | ❌ | ❌ |

Todo el aislamiento de datos por cliente se aplica con **Row Level Security en Postgres** (no solo en la UI), así que un cliente nunca puede leer contenido de otra marca aunque manipule las peticiones.

## Estados de una pieza

`Borrador → Pendiente de revisión → (Aprobado | Cambios solicitados) → Programado → Publicado`, con `Cancelado` disponible en cualquier punto salvo publicado. Las transiciones viven en funciones `SECURITY DEFINER` de Postgres (`submit_for_review`, `approve_content_piece`, `request_changes`, `mark_scheduled`, `mark_published`, `cancel_content_piece`, `reschedule_content_piece`) que:
- registran el cambio en `status_history` (nunca se borra el historial),
- crean notificaciones para la contraparte correspondiente,
- exigen que solo un contacto del cliente pueda aprobar o solicitar cambios, y que la solicitud de cambios incluya una nota.

## Integración con Google Calendar

`app/api/google-calendar/connect` inicia el flujo OAuth y `.../callback` intercambia el código por tokens y guarda la conexión (`google_calendar_connections`). Desde **Ajustes** un administrador conecta uno o más calendarios, y desde la ficha de cada **Cliente** se elige qué calendario usar (`client_calendar_mappings`).

Cuando una pieza pasa a **Aprobado** o **Programado** (`app/actions.ts`), se llama a `lib/google-calendar/sync.ts`, que:
- crea el evento si no existe, o lo actualiza (`PATCH`) si ya existe, usando `calendar_event_links` para evitar duplicados,
- incluye cliente, plataforma, formato, copy y enlace a la ficha,
- si cambia la fecha/hora (drag & drop o edición), se vuelve a sincronizar automáticamente.

## Automatización con Make (webhooks salientes)

Desde **Ajustes > Automatización con Make**, un administrador configura una URL y una clave secreta (se guarda solo en la base de datos, protegida por RLS de solo-admin; nunca se envía al navegador). `lib/webhooks/dispatch.ts` firma cada payload con HMAC-SHA256 (`X-Planner-Signature`) y lo envía a todos los webhooks activos suscritos a ese evento:

- `pieza_creada_revision`, `pieza_aprobada`, `cambios_solicitados`, `comentario_agregado`, `fecha_cambiada`, `pieza_programada`, `pieza_publicada`.

El payload incluye: id de la pieza, cliente, título, estado, fecha/hora, plataforma, copy, usuario que hizo el cambio y enlace a la ficha. Cada envío se registra en `webhook_deliveries` (código de respuesta o error) para poder auditarlo.

## Notificaciones

- Campanita en la barra superior con notificaciones en tiempo real (Supabase Realtime) por usuario.
- Configurables por cliente desde su ficha: correo al cliente cuando hay contenido pendiente, correo al equipo cuando el cliente responde, y días de espera antes de un recordatorio (`notification_settings`). El envío de correos en sí requiere conectar un proveedor (Supabase SMTP, o un webhook de Make que dispare el correo — el evento `pieza_creada_revision`/`cambios_solicitados` ya lleva todos los datos necesarios).

## Exportar a CSV

`GET /api/export/csv` exporta el calendario visible para el usuario autenticado (filtrado automáticamente por RLS) a un CSV con codificación UTF-8 (BOM incluido para Excel).

## Flujo de prueba end-to-end

1. Como administrador, crea un cliente de prueba en **Clientes** y añade un contacto de cliente (correo real o de prueba).
2. Crea una pieza (**+ Nueva pieza**) en estado *Borrador*, con fecha en las próximas 24h.
3. Ábrela y pulsa **Enviar a revisión** → el cliente recibe una notificación in-app y (si hay webhook configurado) se dispara `pieza_creada_revision`.
4. Inicia sesión como el contacto del cliente (o revisa con impersonación), abre la pieza y pulsa **Solicitar cambios**, explicando qué modificar.
5. Como agencia, edita la pieza (el historial de la solicitud de cambios permanece visible) y pulsa **Reenviar a revisión**.
6. Como cliente, pulsa **Aprobar** → la pieza pasa a *Aprobado*, se dispara `pieza_aprobada`, y si hay un calendario de Google conectado para ese cliente, se crea/actualiza el evento correspondiente.
7. Como agencia, arrastra la pieza a otra fecha en el calendario mensual → confirma que la hora se mantiene en la zona horaria del cliente y que el evento de Google Calendar se actualiza sin duplicarse (`fecha_cambiada`).
8. Marca la pieza como **Programado** y luego **Publicado**, revisando en cada paso el historial de la ficha y, si hay un webhook de prueba (p. ej. https://webhook.site), que cada evento llegó firmado.

## Arranque rápido en local (con datos de demostración)

Si solo quieres ver la aplicación funcionando, no hace falta crear un proyecto en Supabase ni un
usuario a mano. Con Docker corriendo:

```bash
npm install
npx supabase start                                   # Postgres + Auth local, aplica las migraciones
node scripts/write-supabase-test-env.mjs .env.local  # escribe las credenciales locales
node scripts/seed-demo.mjs                           # marca de ejemplo con 4 piezas
npm run dev
```

Entra en http://localhost:3000/login con cualquiera de los dos usuarios que crea el seed:

| Usuario | Rol | Qué puede hacer |
|---|---|---|
| `agencia@demo.local` / `demo1234` | Administrador de agencia | Crear y editar piezas, ver todas las marcas |
| `cliente@demo.local` / `demo1234` | Contacto de cliente | Ver solo su marca, aprobar o solicitar cambios |

`scripts/seed-demo.mjs` es idempotente y **se niega a correr contra una URL que no sea local**, para
que una contraseña de demostración no llegue nunca a una base real. Para producción, el primer
administrador se crea desde el panel de Supabase (sección 1 más arriba).

Para apagar todo: `npm run db:test:stop`.

## Pruebas

| Comando | Qué corre |
|---|---|
| `npm run test` | Pruebas unitarias (Vitest + jsdom) sobre `tests/unit/**`: firma HMAC de webhooks, fecha/hora con zona horaria, y el upsert-sin-duplicado de Google Calendar. |
| `npm run test:watch` | Lo mismo, en modo watch. |
| `npm run test:coverage` | Lo mismo, con reporte de cobertura en `coverage/` (no se versiona). |
| `npm run test:integration` | Levanta una Supabase local en Docker, reaplica las migraciones desde cero y ejercita las funciones `SECURITY DEFINER` de transición de estado contra Postgres real. |
| `npm run db:test:stop` | Apaga la Supabase local. |

Las pruebas de integración necesitan Docker corriendo. Nunca tocan un proyecto de Supabase remoto:
las credenciales salen de `supabase status` en tiempo de ejecución y aterrizan en `.env.test.local`,
que está fuera de control de versiones.

## CI

`.github/workflows/ci.yml` corre en cada `push` a `main`/`master` y en cada `pull_request`, sobre
Node 22: `npm ci` → `npm run lint` → `npx tsc --noEmit` → `npm run test` → `npm run test:integration`
→ `npm run build`.

El check que aparece en la UI de branch protection de GitHub se llama **`CI / test`** (workflow `CI`,
job `test`). Es el mismo conjunto de comandos que el gate local, sin excepciones: si algo está en el
gate, está en CI.

## Despliegue en Vercel

El despliegue va por la integración Git de Vercel: cada push a `main` dispara un deploy de
producción, y un rollback es "Promote to Production" sobre un deployment anterior.

**Versión de Node del proyecto: `22.x`.** Se fija en Vercel en *Project Settings → General →
Node.js Version*, y `package.json` → `engines.node` lo documenta. Vercel deshabilita Node 20 para
despliegues nuevos a partir del **2026-10-01**, así que este ajuste no es opcional.

Variables de entorno a cargar en el dashboard de Vercel (las mismas 7 de `.env.example`):

| Variable | Secreta | Dónde se consigue |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | no | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | no | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | **sí** | Supabase → Settings → API (nunca llega al navegador) |
| `NEXT_PUBLIC_APP_URL` | no | El dominio de producción del proyecto |
| `GOOGLE_CLIENT_ID` | no | Google Cloud Console (solo si se usa Google Calendar) |
| `GOOGLE_CLIENT_SECRET` | **sí** | Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | no | `https://<tu-dominio>/api/google-calendar/callback` |

`middleware.ts` construye un cliente de Supabase en cada request, así que sin
`NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` la aplicación responde 500 en todas
las rutas, incluida `/login`. Verifica que las 7 estén cargadas antes del primer deploy.

## Estructura del proyecto

```
app/                    rutas (App Router) y Server Actions (actions.ts, admin-actions.ts)
components/              UI compartida (calendario, ficha, formularios, notificaciones)
lib/supabase/            clientes de Supabase (browser, server, middleware)
lib/webhooks/            envío firmado de eventos a Make
lib/google-calendar/     sincronización de eventos
supabase/migrations/     esquema SQL, RLS y funciones de transición de estado
```
