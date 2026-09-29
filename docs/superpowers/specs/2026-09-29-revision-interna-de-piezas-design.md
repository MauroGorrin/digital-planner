# Revisión interna de piezas antes del cliente

**Fecha:** 2026-09-29
**Estado:** diseñado y aprobado por el usuario en conversación. Es el sub-proyecto **C** de la
descomposición acordada (A → B → **C** → D) de la lista de sugerencias sobre `digital-planner`. Por
instrucción explícita del usuario ("sigue sin parar, avísame cuando esté listo"), este spec **no
espera revisión del usuario antes del plan de implementación** — el paso "User Review Gate" de la
skill de brainstorming se salta a propósito aquí, con esa instrucción como la aprobación.

## El problema

Hoy cualquier persona de la agencia (`agency_admin` o `agency_member`, sin distinción:
`submit_for_review` solo exige `is_agency()`) puede mandar una pieza directo al cliente apenas la
termina. Para una agencia de una sola persona eso es lo correcto. Para una agencia con equipo —
un community manager que sube contenido, un líder de cuenta que responde por la marca — nada
impide que algo salga con un error tipográfico, una fecha mal puesta o un tono que no es el de esa
marca, porque nadie más lo vio antes de que el cliente lo viera.

El panel de ideas ya resuelve exactamente este problema para las ideas
(`correccion_interna` → `pendiente_cliente` en `idea_status`,
`supabase/migrations/0005_ideas.sql`). Este sub-proyecto le aplica el mismo patrón a
`content_pieces`, reutilizando los roles que ya existen.

## Alcance

**Dentro:** un estado nuevo entre `borrador` y `pendiente_revision` que exige la aprobación de un
`agency_admin` antes de que el cliente vea la pieza; los botones correspondientes en la ficha de la
pieza y en Pendientes.

**Fuera, deliberadamente:**

| No se construye | Por qué |
|---|---|
| Un rol nuevo | `agency_admin` ya distingue "puede aprobar antes que salga al cliente" de `agency_member` — es exactamente la regla que el panel de ideas ya aplica con `is_agency_admin()`. Agregar un tercer rol sería resolver un problema que no existe. |
| Revisión interna otra vez tras un reenvío por cambios del cliente | Decisión explícita del usuario: solo la primera vez que una pieza sale del equipo pasa por el líder de cuenta. Una corrección pedida por el cliente ya es sobre algo que un admin aprobó antes. |
| Cambiar `submit_for_review` | Sigue exactamente igual — mismo nombre, mismo permiso (`is_agency()`), mismo webhook. Solo cambia CUÁNDO se llama: ya no desde `borrador`, solo desde `cambios_solicitados`. |
| Alertas automáticas o recordatorios de "llevas 2 días sin revisar" | Mismo criterio que excluyó el spec de métricas: la pantalla primero, el aviso después, sabiendo qué umbral importa. |
| Configurar por agencia si este paso es obligatorio u opcional | El panel de ideas no tiene ese interruptor tampoco — siempre es de dos pasos. Si una agencia de una sola persona lo encuentra redundante, esa persona es agency_admin de su propia agencia y aprueba su propio trabajo en un clic, sin fricción real. |

## Lo que ya existe y este diseño usa

Verificado contra el código, no asumido:

- `content_status` (`supabase/migrations/0001_init.sql:12-20`), 7 valores: `borrador`,
  `pendiente_revision`, `cambios_solicitados`, `aprobado`, `programado`, `publicado`, `cancelado`.
- `is_agency()` e `is_agency_admin()` (`0001_init.sql:235-243`) comprueban el rol **sin mirar la
  agencia**. `has_client_access(client_id)` es la otra mitad obligatoria dentro de toda función
  `SECURITY DEFINER` que escribe una fila de una marca — confirmado en
  `0010_aislamiento_por_agencia.sql:474-566`, que reescribió `submit_for_review`,
  `mark_scheduled`, `mark_published`, `cancel_content_piece` y `reschedule_content_piece`
  precisamente para agregarles esta comprobación que les faltaba. **Las tres funciones nuevas de
  este spec siguen ese mismo orden: existencia → rol → `has_client_access(v_client)` → estado.**
  Saltarse este orden, o esta comprobación, reabre exactamente el agujero entre agencias que
  `0010` cerró.
- `submit_for_review` (`0010_aislamiento_por_agencia.sql:488-505`) hoy no comprueba el estado de
  origen (`v_old`) en absoluto — funciona desde cualquier estado. Eso es lo que permite dejarla sin
  tocar: seguirá funcionando igual desde `cambios_solicitados` cuando la interfaz deje de llamarla
  desde `borrador`.
- El patrón de dos pasos ya construido en `0005_ideas.sql`: `submit_idea_to_client` y
  `request_idea_internal_changes` exigen `is_agency_admin()`; `resubmit_idea` (la segunda vuelta,
  tras `correccion_cliente`) exige solo `is_agency()`, sin volver a pasar por el admin — el mismo
  criterio que confirmó el usuario para piezas.
- `client_assignments` (`0001_init.sql:63-69`): equipo de agencia asignado a una marca. Es a quién
  notifica `submit_for_internal_review`, filtrado además por rol.
- `content_pieces.assignee_id` (`0001_init.sql:93`): responsable interno de la pieza. Es a quién
  notifica `request_internal_changes` — mismo papel que `ideas.created_by` cumple en
  `request_idea_internal_changes`, pero usando el campo más específico que `content_pieces` ya
  tiene.
- El webhook `pieza_creada_revision` se dispara hoy desde `app/actions.ts:163-177`
  (`submitForReview`), después de la llamada RPC. Es el punto donde el cliente se entera — sigue
  disparándose en ese mismo momento semántico, solo que ahora desde una Server Action distinta.
- `WebhookEventType` (`lib/webhooks/dispatch.ts:5-12`) y el enum Postgres `webhook_event_type`
  (`0001_init.sql:22-30`), 7 valores hoy.
- `docs/superpowers/auditoria-aislamiento-0010.md` lleva una fila por cada uso de `is_agency()` /
  `is_agency_admin()` en el código — las funciones nuevas de este spec le agregan sus filas.

## Diseño

### La máquina de estados

```
borrador ──submit_for_internal_review (is_agency + has_client_access)────────▶ pendiente_revision_interna
pendiente_revision_interna ──approve_internal_review (is_agency_admin + has_client_access)──▶ pendiente_revision
pendiente_revision_interna ──request_internal_changes (is_agency_admin + has_client_access, nota obligatoria)──▶ borrador
cambios_solicitados ──submit_for_review (YA EXISTE, sin cambios)─────────────▶ pendiente_revision
```

Un valor nuevo en el enum `content_status`: `pendiente_revision_interna`. Nada más del ciclo
cambia — `aprobado`, `programado`, `publicado`, `cancelado` y sus funciones (`approve_content_piece`,
`request_changes`, `mark_scheduled`, `mark_published`, `cancel_content_piece`,
`reschedule_content_piece`) quedan intactos, sin tocarlos.

### Las tres funciones nuevas, migración `0013_revision_interna.sql`

```sql
create or replace function submit_for_internal_review(p_content_piece_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_old content_status; v_client uuid;
begin
  select status, client_id into v_old, v_client from content_pieces where id = p_content_piece_id;
  if not is_agency() then raise exception 'No autorizado'; end if;
  if not has_client_access(v_client) then raise exception 'No autorizado'; end if;
  if v_old <> 'borrador' then raise exception 'Solo un borrador se puede enviar a revisión interna'; end if;

  update content_pieces set status = 'pendiente_revision_interna' where id = p_content_piece_id;
  insert into status_history (content_piece_id, from_status, to_status, changed_by)
    values (p_content_piece_id, v_old, 'pendiente_revision_interna', auth.uid());
  -- Solo a quien lleva ESTA marca, no a todos los admins de la agencia.
  insert into notifications (profile_id, content_piece_id, type, title, body)
    select ca.profile_id, p_content_piece_id, 'pendiente_revision_interna', 'Nueva pieza para revisión interna',
           'Tienes una pieza esperando tu revisión antes de mandarla al cliente.'
    from client_assignments ca
    join profiles p on p.id = ca.profile_id
    where ca.client_id = v_client and p.role = 'agency_admin';
end;
$$;

create or replace function approve_internal_review(p_content_piece_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_old content_status; v_client uuid;
begin
  select status, client_id into v_old, v_client from content_pieces where id = p_content_piece_id;
  if not is_agency_admin() then raise exception 'Solo un administrador de agencia puede aprobar la revisión interna'; end if;
  if not has_client_access(v_client) then raise exception 'No autorizado'; end if;
  if v_old <> 'pendiente_revision_interna' then raise exception 'Solo una pieza en revisión interna se puede aprobar'; end if;

  update content_pieces set status = 'pendiente_revision' where id = p_content_piece_id;
  insert into status_history (content_piece_id, from_status, to_status, changed_by)
    values (p_content_piece_id, v_old, 'pendiente_revision', auth.uid());
  -- Mismo evento y mismo destinatario que submit_for_review: es el mismo momento semántico
  -- (el cliente se entera), solo que ahora se llega aquí después del visto bueno interno.
  insert into notifications (profile_id, content_piece_id, type, title, body)
    select profile_id, p_content_piece_id, 'pendiente_revision', 'Nuevo contenido para revisar',
           'Tienes una pieza pendiente de revisión.'
    from client_contacts where client_id = v_client;
end;
$$;

create or replace function request_internal_changes(p_content_piece_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old content_status; v_client uuid; v_assignee uuid; v_created_by uuid;
begin
  select status, client_id, assignee_id, created_by into v_old, v_client, v_assignee, v_created_by
    from content_pieces where id = p_content_piece_id;
  if not is_agency_admin() then raise exception 'Solo un administrador de agencia puede pedir corrección interna'; end if;
  if not has_client_access(v_client) then raise exception 'No autorizado'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Pedir corrección exige una nota'; end if;
  if v_old <> 'pendiente_revision_interna' then raise exception 'Solo una pieza en revisión interna admite pedir corrección'; end if;

  update content_pieces set status = 'borrador' where id = p_content_piece_id;
  insert into status_history (content_piece_id, from_status, to_status, changed_by, note)
    values (p_content_piece_id, v_old, 'borrador', auth.uid(), p_note);
  -- Al responsable interno si tiene uno asignado; si no, a quien la creó. Mismo papel que
  -- ideas.created_by en request_idea_internal_changes, con el campo más específico que
  -- content_pieces ya tiene.
  if coalesce(v_assignee, v_created_by) is not null then
    insert into notifications (profile_id, content_piece_id, type, title, body)
      values (coalesce(v_assignee, v_created_by), p_content_piece_id, 'correccion_interna_solicitada',
              'Te pidieron corregir una pieza', p_note);
  end if;
end;
$$;
```

**RLS:** ninguna política nueva. `content_pieces_agency_update`
(`0010_aislamiento_por_agencia.sql:309-311`) ya exige `is_agency() and has_client_access(client_id)`
para cualquier `update` directo a la tabla, y las tres funciones de arriba son `SECURITY DEFINER` —
el control vive en su propio cuerpo, no en una política nueva.

**El enum de webhooks** (`0001_init.sql:22-30`) gana un valor opcional:
`pieza_enviada_a_revision_interna`, disparado desde `submit_for_internal_review` en la capa de
aplicación (no desde la función SQL — mismo patrón que los demás eventos, ver abajo). Nadie lo
recibe salvo que lo agregue a mano al array `events` de su configuración de webhook; los 7 eventos
existentes no cambian.

### La capa de aplicación (`app/actions.ts`)

Tres Server Actions nuevas, mismo patrón que `submitForReview` (línea 163): llaman al RPC,
recargan la pieza, y para las dos que cambian a `pendiente_revision_interna` o `pendiente_revision`
disparan el webhook correspondiente.

```ts
export async function submitForInternalReview(id: string) {
  const profile = await requireAgency();
  const supabase = await createClient();
  const { error } = await supabase.rpc('submit_for_internal_review', { p_content_piece_id: id });
  if (error) throw errorParaElCliente(error, 'submitForInternalReview');
  const piece = await loadPieceWithClient(id);
  if (piece) {
    await dispatchWebhookEvent(
      buildWebhookPayload('pieza_enviada_a_revision_interna', piece, profile.full_name, getBaseUrl(), piece.clients.brand_name)
    );
  }
  revalidatePath('/calendario');
  revalidatePath('/pendientes');
  revalidatePath(`/piezas/${id}`);
}

export async function approveInternalReview(id: string) {
  const profile = await requireAgency();
  const supabase = await createClient();
  const { error } = await supabase.rpc('approve_internal_review', { p_content_piece_id: id });
  if (error) throw errorParaElCliente(error, 'approveInternalReview');
  const piece = await loadPieceWithClient(id);
  if (piece) {
    await dispatchWebhookEvent(
      buildWebhookPayload('pieza_creada_revision', piece, profile.full_name, getBaseUrl(), piece.clients.brand_name)
    );
  }
  revalidatePath('/calendario');
  revalidatePath('/pendientes');
  revalidatePath(`/piezas/${id}`);
}

export async function requestInternalChanges(id: string, note: string) {
  await requireAgency();
  const supabase = await createClient();
  const { error } = await supabase.rpc('request_internal_changes', { p_content_piece_id: id, p_note: note });
  if (error) throw errorParaElCliente(error, 'requestInternalChanges');
  revalidatePath('/calendario');
  revalidatePath('/pendientes');
  revalidatePath(`/piezas/${id}`);
}
```

`requestInternalChanges` no dispara webhook: no hay ningún evento del catálogo para "de vuelta al
borrador" (el ciclo de ideas tampoco dispara nada en `request_idea_internal_changes`) — la
notificación en la base ya avisa al responsable, y un webhook de "corrección interna" no tiene hoy
ningún consumidor que lo pida.

`requireAgency()` en las tres es la misma comodidad de siempre (mensaje claro sin viaje a la base);
el control real es el `if not is_agency_admin()` / `if not is_agency()` dentro de cada función SQL.
`approveInternalReview`/`requestInternalChanges` no comprueban el rol en la capa de aplicación
porque la función SQL ya rechaza a un `agency_member` con un mensaje claro — duplicar la
comprobación aquí sería la misma regla en dos sitios, que es como se desincronizan.

### Interfaz

**`ContentPieceDetail.tsx`** (extiende el bloque `isAgency` de la línea ~145):

- En `borrador`: el botón cambia de "Enviar a revisión" (llamaba a `submitForReview`) a **"Enviar a
  revisión interna"** (llama a `submitForInternalReview`). Mismo permiso (cualquiera del equipo),
  mismo lugar en la pantalla.
- Sección nueva, visible **solo si `profile.role === 'agency_admin'` y `piece.status ===
  'pendiente_revision_interna'`** — mismo patrón visual que la sección de aprobación del cliente
  (línea ~210): un párrafo, dos botones. **"Aprobar y enviar al cliente"** (llama a
  `approveInternalReview`, confirmación simple) y **"Pedir corrección interna"** (revela un
  `textarea` con nota obligatoria, llama a `requestInternalChanges`) — mismo patrón que ya usa
  "Solicitar cambios" del lado del cliente, un poco más abajo en el mismo archivo.
- Un `agency_member` que abre una pieza en `pendiente_revision_interna` ve el estado en el badge
  pero ningún botón de decisión — la ve, no puede actuar, igual que hoy ve `pendiente_revision` sin
  poder aprobarla ni pedir cambios (esa es la mitad del cliente).

**`PendingList.tsx`:** sección nueva "Piezas esperando revisión interna (N)", filtrando
`status === 'pendiente_revision_interna'`, visible a toda la agencia (mismo criterio que ya usa la
sección de ideas: toda la agencia ve que algo espera, aunque solo el admin pueda decidir al entrar).
Colocada antes de la sección "Pendientes de aprobación del cliente" existente — es el paso que
ocurre primero en el flujo.

**`types/database.ts`:** una entrada más en `STATUS_LABELS` ("Revisión interna") y
`STATUS_COLORS`.

## Qué se prueba

**Integración** (`tests/integration/`, contra Postgres real, mismo patrón que
`ideas-transiciones.test.ts` y `state-transitions.test.ts`):

1. Un `agency_member` puede llamar `submit_for_internal_review` sobre una pieza en `borrador` de su
   agencia.
2. Un `agency_member` **no puede** llamar `approve_internal_review` ni `request_internal_changes` —
   las dos rechazan con el mensaje de "Solo un administrador...".
3. Un `agency_admin` puede llamar las dos.
4. **El personal de OTRA agencia no puede llamar ninguna de las tres funciones sobre una pieza
   ajena**, aunque acierte el UUID exacto — es la prueba que confirma que `has_client_access(v_client)`
   está en las tres, en el mismo orden que en `submit_for_review`.
5. `submit_for_internal_review` sobre una pieza que NO está en `borrador` (ej. ya en
   `pendiente_revision`) rechaza.
6. `approve_internal_review` / `request_internal_changes` sobre una pieza que NO está en
   `pendiente_revision_interna` rechazan.
7. `request_internal_changes` sin nota (vacía o solo espacios) rechaza.
8. El reenvío desde `cambios_solicitados` sigue funcionando con `submit_for_review` y sigue
   aceptando a un `agency_member`, sin exigir admin — confirma que no se rompió el camino existente
   ni se le agregó una segunda vuelta por el admin.
9. `submit_for_internal_review` notifica solo a los `agency_admin` asignados a esa marca (
   `client_assignments`), no a todos los admins de la agencia.
10. `request_internal_changes` notifica a `assignee_id` si existe; si no, a `created_by`.

**Componentes** (`tests/unit/components/`):

11. `ContentPieceDetail`: en `borrador`, el botón dice "Enviar a revisión interna" y llama a
    `submitForInternalReview`.
12. `ContentPieceDetail`: en `pendiente_revision_interna`, un `agency_admin` ve los dos botones de
    decisión; un `agency_member` ve el estado pero ningún botón de decisión.
13. `ContentPieceDetail`: "Pedir corrección interna" exige la nota antes de habilitar el envío
    (mismo patrón que "Solicitar cambios" del cliente).
14. `PendingList`: una pieza en `pendiente_revision_interna` aparece en la sección nueva y no en
    "Pendientes de aprobación del cliente".

**Documentación:** una fila nueva en `docs/superpowers/auditoria-aislamiento-0010.md` por cada uso
de `is_agency()` / `is_agency_admin()` que agreguen las tres funciones (3 de `is_agency()`/
`is_agency_admin()` combinados — cada función usa uno de los dos, más `has_client_access` en las
tres).

**Manual:** ninguno.

## Criterios de aceptación

1. CUANDO un `agency_member` envía un borrador a revisión interna, EL SISTEMA lo mueve a
   `pendiente_revision_interna` y notifica solo a los `agency_admin` asignados a esa marca.
2. CUANDO un `agency_member` intenta aprobar una revisión interna o pedir corrección interna, EL
   SISTEMA lo rechaza.
3. CUANDO un `agency_admin` aprueba una revisión interna, EL SISTEMA mueve la pieza a
   `pendiente_revision`, notifica a los contactos del cliente, y dispara `pieza_creada_revision`.
4. CUANDO un `agency_admin` pide corrección interna con una nota, EL SISTEMA mueve la pieza de
   vuelta a `borrador` y notifica al responsable interno (o a quien la creó, si no hay responsable).
5. CUANDO el personal de otra agencia intenta cualquiera de las tres transiciones sobre una pieza
   ajena, EL SISTEMA lo rechaza, acierte o no el UUID.
6. CUANDO el cliente pide cambios y el equipo reenvía, EL SISTEMA no exige una segunda aprobación
   de un `agency_admin`.

### Cómo se verifica cada criterio

| Criterio | Cómo |
|---|---|
| 1 | Integración 1, 9 |
| 2 | Integración 2, Componente 12 |
| 3 | Integración 3 |
| 4 | Integración 3 (parte admin), 7, 10 |
| 5 | Integración 4 |
| 6 | Integración 8 |

## Orden de entrega

1. Migración `0013_revision_interna.sql`: el valor nuevo del enum `content_status`, las tres
   funciones, el valor nuevo del enum `webhook_event_type`. Sin RLS nueva que agregar. Con sus
   pruebas de integración (1-10).
2. `lib/webhooks/dispatch.ts`: agregar `'pieza_enviada_a_revision_interna'` a `WebhookEventType`.
3. `app/actions.ts`: las tres Server Actions nuevas.
4. `types/database.ts`: `pendiente_revision_interna` en `ContentStatus`, `STATUS_LABELS`,
   `STATUS_COLORS`.
5. `ContentPieceDetail.tsx`: el botón renombrado y la sección nueva, con sus pruebas de componente
   (11-13).
6. `PendingList.tsx`: la sección nueva, con su prueba de componente (14).
7. `docs/superpowers/auditoria-aislamiento-0010.md`: las filas nuevas.
