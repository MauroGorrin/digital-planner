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
3. En **Authentication > Providers**, deja activado el login por correo/contraseña. Para que las invitaciones envíen correo, configura un proveedor SMTP en **Authentication > Email Templates / SMTP Settings** (si no configuras SMTP, el usuario se crea igualmente pero deberás compartirle el enlace de invitación o restablecer su contraseña manualmente desde el panel de Supabase).
4. Crea al primer administrador manualmente: en **Authentication > Users**, crea un usuario con su correo, y en la tabla `profiles` (se crea automáticamente) actualiza su `role` a `agency_admin`:
   ```sql
   update profiles set role = 'agency_admin' where email = 'tu-correo@agencia.com';
   ```

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

## Estructura del proyecto

```
app/                    rutas (App Router) y Server Actions (actions.ts, admin-actions.ts)
components/              UI compartida (calendario, ficha, formularios, notificaciones)
lib/supabase/            clientes de Supabase (browser, server, middleware)
lib/webhooks/            envío firmado de eventos a Make
lib/google-calendar/     sincronización de eventos
supabase/migrations/     esquema SQL, RLS y funciones de transición de estado
```
