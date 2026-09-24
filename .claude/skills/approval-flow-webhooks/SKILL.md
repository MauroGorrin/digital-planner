---
name: approval-flow-webhooks
description: Referencia de la máquina de estados de aprobación (content_status) y del catálogo de eventos de webhook (webhook_event_type) de digital-planner. Úsala antes de tocar app/actions.ts, cualquier función SECURITY DEFINER en supabase/migrations/0001_init.sql, lib/webhooks/dispatch.ts, o al escribir una prueba de integración sobre transiciones de estado.
---

# Flujo de aprobación y catálogo de webhooks

## Cuándo usar esto

- Antes de modificar cualquier función `SECURITY DEFINER` de transición de estado.
- Antes de agregar o modificar un evento en `lib/webhooks/dispatch.ts` o `app/actions.ts`.
- Al escribir una prueba de integración en `tests/integration/**` que llame `.rpc(...)`.
- Al depurar por qué una pieza no cambió de estado o un webhook no se disparó.

## La máquina de estados (`content_status`, `supabase/migrations/0001_init.sql`)

```
borrador ──submit_for_review──▶ pendiente_revision
pendiente_revision ──approve_content_piece──▶ aprobado
pendiente_revision ──request_changes──▶ cambios_solicitados
cambios_solicitados ──submit_for_review──▶ pendiente_revision   (reenvío)
aprobado ──mark_scheduled──▶ programado
programado ──mark_published──▶ publicado
cualquier estado excepto publicado ──cancel_content_piece──▶ cancelado
cualquier estado con fecha ──reschedule_content_piece──▶ (mismo estado, nueva scheduled_at)
```

Los 7 valores del enum son exactamente: `borrador`, `pendiente_revision`, `cambios_solicitados`,
`aprobado`, `programado`, `publicado`, `cancelado`.

Cada función de transición:
1. Es `SECURITY DEFINER` — corre con permisos del dueño de la tabla, así que valida el permiso del
   llamador a mano (`is_agency()`, `has_client_access()`, o pertenencia en `client_contacts`) antes
   de escribir. Nunca asumas que RLS sola te protege dentro de una de estas funciones.
2. Inserta una fila en `status_history` (`from_status`, `to_status`, `changed_by`, `note`) — esta
   tabla nunca se borra, es el historial de auditoría completo de la pieza.
3. Solo `approve_content_piece` y `request_changes` insertan además en `approvals`
   (`decision`, `note`) — las demás transiciones no son decisiones del cliente.
4. Crea filas en `notifications` para la contraparte correspondiente (agencia ↔ cliente).

**Quién puede llamar cada una:**

| Función | Quién |
|---|---|
| `submit_for_review` | `is_agency()` — admin o miembro de equipo |
| `approve_content_piece`, `request_changes` | debe existir una fila en `client_contacts` para ese `client_id` y `auth.uid()` |
| `mark_scheduled`, `mark_published`, `cancel_content_piece`, `reschedule_content_piece` | `is_agency()` |

## Catálogo de webhooks (`webhook_event_type`, disparados desde `app/actions.ts`)

Los 7 valores del enum son exactamente: `pieza_creada_revision`, `pieza_aprobada`,
`cambios_solicitados`, `comentario_agregado`, `fecha_cambiada`, `pieza_programada`,
`pieza_publicada`.

| Evento | Se dispara cuando |
|---|---|
| `pieza_creada_revision` | `submit_for_review` tiene éxito |
| `pieza_aprobada` | `approve_content_piece` tiene éxito |
| `cambios_solicitados` | `request_changes` tiene éxito |
| `comentario_agregado` | se inserta un comentario nuevo |
| `fecha_cambiada` | se reprograma la pieza (drag&drop o edición) |
| `pieza_programada` | `mark_scheduled` tiene éxito |
| `pieza_publicada` | `mark_published` tiene éxito |

Cada evento se firma con HMAC-SHA256 sobre el JSON exacto del payload, header
`X-Planner-Signature` (hex), y se envía a todo `webhook_configs` activo cuyo array `events`
incluya ese tipo. Ver `lib/webhooks/dispatch.ts`. Cada intento se registra en
`webhook_deliveries` (código de respuesta o error), nunca se descarta silenciosamente.

## Pasos para agregar una transición o un evento nuevo

1. Agrega el valor al enum Postgres correspondiente en una migración **nueva** (nunca edites
   `0001_init.sql`).
2. Si es una transición: escribe la función `SECURITY DEFINER`, siguiendo el patrón de las
   siete existentes — valida permiso, actualiza `content_pieces.status`, inserta en
   `status_history`, inserta en `notifications`.
3. Si es un evento de webhook: agrégalo al type `WebhookEventType` en `lib/webhooks/dispatch.ts`
   y dispáralo desde el punto de `app/actions.ts` donde ocurre el hecho de negocio.
4. Actualiza la tabla de este archivo — es la referencia que evita que un futuro cambio olvide un
   caso.

## Verificar

```bash
npx vitest run tests/integration --environment node   # expect: exit 0 — ejercita submit_for_review + approve_content_piece contra Postgres real
```

## No hacer

- No cambiar `content_pieces.status` con un `UPDATE` directo fuera de estas funciones — se pierde
  el registro en `status_history` y las notificaciones nunca se crean.
- No asumir que RLS protege dentro de una función `SECURITY DEFINER` — RLS no aplica ahí; la
  validación de permiso es manual, dentro de la función misma.
