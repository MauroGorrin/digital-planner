# Revisión interna de piezas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exigir la aprobación de un `agency_admin` antes de que una pieza de contenido llegue al
cliente, reutilizando el mismo patrón de permisos que ya usa el panel de ideas.

**Architecture:** Un estado nuevo (`pendiente_revision_interna`) entre `borrador` y
`pendiente_revision`, con tres funciones `SECURITY DEFINER` nuevas que siguen el mismo orden de
comprobaciones que ya usa `submit_for_review`: existencia → rol → `has_client_access(v_client)` →
estado de origen. `submit_for_review` no se toca — sigue sirviendo, sin cambios, para el reenvío
tras cambios del cliente.

**Tech Stack:** Next.js 15 (App Router, Server Actions) · Supabase (Postgres, RLS, funciones
`SECURITY DEFINER`) · TypeScript 5.5 (strict) · Vitest 5 (`tests/unit` con jsdom,
`tests/integration` con `--environment node` contra Postgres real).

**Spec:** `docs/superpowers/specs/2026-09-29-revision-interna-de-piezas-design.md` — léelo completo
antes de empezar. Trae el SQL exacto de las tres funciones, las tres Server Actions exactas, y la
tabla de qué prueba verifica cada criterio de aceptación.

## Global Constraints

- **No se toca `submit_for_review`.** Ni su SQL ni su permiso (`is_agency()`). Solo cambia desde
  dónde lo llama la interfaz: ya no desde `borrador`, solo desde `cambios_solicitados`.
- **Las tres funciones nuevas siguen el orden: existencia → rol → `has_client_access(v_client)` →
  estado de origen.** Es el orden que documenta `0010_aislamiento_por_agencia.sql:483-486` y que
  impide que el personal de una agencia actúe sobre la pieza de otra. Invertir el orden, u
  omitir `has_client_access`, reabre ese agujero.
- **No se agrega ningún rol nuevo.** Se reutilizan `agency_admin`/`agency_member` tal cual existen.
- **Las Server Actions no repiten la comprobación de rol que ya hace la función SQL.** Mismo
  criterio que `app/actions-ideas.ts:43-50` (`enviarIdeaAlCliente`, `pedirCorreccionInterna`): usan
  `requireAgency()` como comodidad de mensaje, y dejan que la función SQL rechace a quien no sea
  `agency_admin` con su propio mensaje.
- **Los eventos de webhook existentes no cambian de significado.** `pieza_creada_revision` sigue
  disparándose en el mismo momento semántico exacto (cuando el cliente se entera), solo que ahora
  desde `approveInternalReview` en vez de desde `submitForReview` para el camino nuevo.
- **Gate obligatorio antes de dar cualquier tarea por terminada:** `npm run typecheck && npm run
  lint` deben pasar en cero para cada tarea. `npm run test` (unitarias) debe pasar en cero para las
  tareas 4 y 5. `npm run test:integration` debe pasar en cero para la tarea 1 — requiere Docker y
  Supabase local corriendo (`npm run test:integration` los levanta).

---

### Task 1: Migración `0013_revision_interna.sql` — el estado nuevo y sus tres funciones

**Files:**
- Create: `supabase/migrations/0013_revision_interna.sql`
- Test: `tests/integration/revision-interna.test.ts`
- Modify: `docs/superpowers/auditoria-aislamiento-0010.md` (agrega 3 filas a la tabla numerada)

**Interfaces:**
- Consumes: nada de otra tarea — es la base.
- Produces: el valor `'pendiente_revision_interna'` en el enum Postgres `content_status`; las RPC
  `submit_for_internal_review(p_content_piece_id uuid)`,
  `approve_internal_review(p_content_piece_id uuid)`,
  `request_internal_changes(p_content_piece_id uuid, p_note text)`; el valor
  `'pieza_enviada_a_revision_interna'` en el enum Postgres `webhook_event_type`. Las Tareas 2 y 3
  llaman estos nombres exactos.

- [ ] **Step 1: Escribe la migración, en `supabase/migrations/0013_revision_interna.sql`**

```sql
-- Revisión interna de piezas: un agency_admin aprueba antes de que la pieza llegue al cliente.
-- Mismo patrón que ya usa el panel de ideas (0005_ideas.sql: correccion_interna -> pendiente_cliente),
-- aplicado a content_pieces. No agrega ningún rol -- reutiliza agency_admin/agency_member.
--
-- Repetible a propósito: esta migración se aplica a mano, pegada en el editor SQL del panel de
-- Supabase, y una aplicación que quedó a medias tiene que poder reintentarse. Mismo patrón que
-- 0003 a 0012.

do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'pendiente_revision_interna'
      and enumtypid = 'content_status'::regtype
  ) then
    alter type content_status add value 'pendiente_revision_interna' after 'borrador';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'pieza_enviada_a_revision_interna'
      and enumtypid = 'webhook_event_type'::regtype
  ) then
    alter type webhook_event_type add value 'pieza_enviada_a_revision_interna';
  end if;
end;
$$;

-- ==========================================================================================
-- Las tres funciones. Mismo orden de comprobaciones que ya usa submit_for_review desde 0010:
-- existencia -> rol -> has_client_access(v_client) -> estado de origen. Saltarse ese orden, o esa
-- comprobación, reabre el agujero entre agencias que 0010 cerró -- ver su comentario en
-- 0010_aislamiento_por_agencia.sql:474-486.
-- ==========================================================================================

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
  -- Solo a quien lleva ESTA marca (client_assignments), no a todos los admins de la agencia.
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
  -- Mismo evento y mismo destinatario que submit_for_review: es el mismo momento semántico (el
  -- cliente se entera), solo que ahora se llega aquí después del visto bueno interno.
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
  -- Al responsable interno si tiene uno asignado; si no, a quien la creó.
  if coalesce(v_assignee, v_created_by) is not null then
    insert into notifications (profile_id, content_piece_id, type, title, body)
      values (coalesce(v_assignee, v_created_by), p_content_piece_id, 'correccion_interna_solicitada',
              'Te pidieron corregir una pieza', p_note);
  end if;
end;
$$;
```

**Nota sobre `alter type ... add value` dentro de un bloque `do $$`:** Postgres no permite usar un
valor de enum recién agregado en la MISMA transacción en la que se agregó, si `add value` corre
dentro de un bloque transaccional implícito. Pegar este archivo completo de una sola vez en el
editor SQL de Supabase (que ejecuta cada sentencia de nivel superior en su propia transacción
implícita, no todo el archivo en una) es seguro — es el mismo patrón que ya usan `0005`, `0008` y
`0009` para sus propios `alter type`. Si al aplicar esto a mano ves el error "unsafe use of new
value of enum type", ejecuta primero el bloque de los dos `alter type` solo, confirma, y luego pega
el resto del archivo.

- [ ] **Step 2: Escribe las pruebas de integración, en `tests/integration/revision-interna.test.ts`**

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Corre contra la Supabase LOCAL de `npm run test:integration`, nunca contra un proyecto remoto.
//
// Archivo autocontenido: monta sus DOS agencias propias (no reutiliza la del backfill ni la de
// otras suites) porque el criterio 5 del spec exige probar que el personal de una agencia no puede
// tocar una pieza de otra, y eso necesita una segunda agencia real, no una marca sin dueño.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON || !SERVICE) {
  throw new Error(
    'Faltan credenciales de Supabase local. Corre `npm run test:integration`, que ejecuta ' +
      'scripts/write-supabase-test-env.mjs antes de Vitest.'
  );
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const PASSWORD = 'contrasena-de-prueba-1234';
const sufijo = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function crearUsuario(email: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  return data.user.id;
}

async function sesionDe(email: string): Promise<SupabaseClient> {
  const cliente = createClient(URL!, ANON!, { auth: { persistSession: false } });
  const { error } = await cliente.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return cliente;
}

async function insertar(tabla: string, fila: Record<string, unknown>): Promise<string> {
  const { data, error } = await admin.from(tabla).insert(fila).select('id').single();
  if (error) throw new Error(`No se pudo insertar en ${tabla}: ${error.message}`);
  return (data as { id: string }).id;
}

function enUnDia() {
  return new Date(Date.now() + 86_400_000).toISOString();
}

async function crearPieza(clientId: string, status: string, overrides: Record<string, unknown> = {}) {
  return insertar('content_pieces', {
    client_id: clientId,
    platform: 'instagram',
    format: 'post',
    title: `Pieza ${status} ${Math.random().toString(36).slice(2)}`,
    copy_text: '',
    scheduled_at: enUnDia(),
    status,
    ...overrides,
  });
}

async function estadoDeLaPieza(id: string) {
  const { data } = await admin.from('content_pieces').select('status').eq('id', id).single();
  return data?.status as string;
}

async function historial(pieceId: string, to: string) {
  const { data } = await admin
    .from('status_history')
    .select('id, note')
    .eq('content_piece_id', pieceId)
    .eq('to_status', to);
  return data ?? [];
}

async function notificacionesDe(profileId: string, type: string) {
  const { data } = await admin
    .from('notifications')
    .select('id, content_piece_id, body')
    .eq('profile_id', profileId)
    .eq('type', type);
  return data ?? [];
}

const ids = {
  agenciaA: '',
  agenciaB: '',
  adminA: '',
  adminA2: '',
  miembroA: '',
  adminB: '',
  marcaA: '',
};
const correos = {
  adminA: `revint-adminA-${sufijo}@prueba.local`,
  adminA2: `revint-adminA2-${sufijo}@prueba.local`,
  miembroA: `revint-miembroA-${sufijo}@prueba.local`,
  adminB: `revint-adminB-${sufijo}@prueba.local`,
};

beforeAll(async () => {
  ids.agenciaA = await insertar('agencies', { name: `Revisión interna A ${sufijo}` });
  ids.agenciaB = await insertar('agencies', { name: `Revisión interna B ${sufijo}` });

  ids.adminA = await crearUsuario(correos.adminA);
  // adminA2 existe SOLO para la prueba 9: es admin de la MISMA agencia que adminA, pero no está
  // asignado a marcaA, y no debe recibir la notificación de "nueva pieza para revisión interna".
  ids.adminA2 = await crearUsuario(correos.adminA2);
  ids.miembroA = await crearUsuario(correos.miembroA);
  ids.adminB = await crearUsuario(correos.adminB);

  for (const [id, role, agencyId] of [
    [ids.adminA, 'agency_admin', ids.agenciaA],
    [ids.adminA2, 'agency_admin', ids.agenciaA],
    [ids.miembroA, 'agency_member', ids.agenciaA],
    [ids.adminB, 'agency_admin', ids.agenciaB],
  ] as const) {
    const { error } = await admin.from('profiles').update({ role, agency_id: agencyId }).eq('id', id);
    if (error) throw error;
  }

  ids.marcaA = await insertar('clients', {
    name: `Marca A ${sufijo}`,
    brand_name: 'Marca A',
    timezone: 'America/Mexico_City',
    agency_id: ids.agenciaA,
    created_by: ids.adminA,
  });

  // adminA queda asignado a marcaA; adminA2 NO -- es justo la asimetría que prueba el caso 9.
  await insertar('client_assignments', { client_id: ids.marcaA, profile_id: ids.adminA });
});

afterAll(async () => {
  if (ids.marcaA) await admin.from('clients').delete().eq('id', ids.marcaA);
  for (const id of [ids.adminA, ids.adminA2, ids.miembroA, ids.adminB]) {
    if (id) await admin.auth.admin.deleteUser(id);
  }
  const agencias = [ids.agenciaA, ids.agenciaB].filter(Boolean);
  if (agencias.length > 0) await admin.from('agencies').delete().in('id', agencias);
});

describe('submit_for_internal_review', () => {
  it('un agency_member puede enviar un borrador a revisión interna', async () => {
    const pieza = await crearPieza(ids.marcaA, 'borrador');
    const miembro = await sesionDe(correos.miembroA);

    const { error } = await miembro.rpc('submit_for_internal_review', { p_content_piece_id: pieza });

    expect(error).toBeNull();
    expect(await estadoDeLaPieza(pieza)).toBe('pendiente_revision_interna');
    expect(await historial(pieza, 'pendiente_revision_interna')).toHaveLength(1);
  });

  it('rechaza si la pieza no está en borrador', async () => {
    const pieza = await crearPieza(ids.marcaA, 'pendiente_revision');
    const miembro = await sesionDe(correos.miembroA);

    const { error } = await miembro.rpc('submit_for_internal_review', { p_content_piece_id: pieza });

    expect(error?.message).toMatch(/borrador/i);
    expect(await estadoDeLaPieza(pieza)).toBe('pendiente_revision');
  });

  it('notifica solo a los agency_admin ASIGNADOS a esa marca, no a todos los admins de la agencia', async () => {
    const pieza = await crearPieza(ids.marcaA, 'borrador');
    const miembro = await sesionDe(correos.miembroA);

    const { error } = await miembro.rpc('submit_for_internal_review', { p_content_piece_id: pieza });
    expect(error).toBeNull();

    const notisAdminA = await notificacionesDe(ids.adminA, 'pendiente_revision_interna');
    const notisAdminA2 = await notificacionesDe(ids.adminA2, 'pendiente_revision_interna');
    expect(notisAdminA.some((n) => n.content_piece_id === pieza)).toBe(true);
    expect(notisAdminA2.some((n) => n.content_piece_id === pieza)).toBe(false);
  });

  it('el personal de OTRA agencia no puede enviarla a revisión interna, acierte o no el UUID', async () => {
    const pieza = await crearPieza(ids.marcaA, 'borrador');
    const adminDeB = await sesionDe(correos.adminB);

    const { error } = await adminDeB.rpc('submit_for_internal_review', { p_content_piece_id: pieza });

    expect(error).not.toBeNull();
    expect(await estadoDeLaPieza(pieza)).toBe('borrador');
  });
});

describe('approve_internal_review', () => {
  it('un agency_member NO puede aprobar', async () => {
    const pieza = await crearPieza(ids.marcaA, 'pendiente_revision_interna');
    const miembro = await sesionDe(correos.miembroA);

    const { error } = await miembro.rpc('approve_internal_review', { p_content_piece_id: pieza });

    expect(error?.message).toMatch(/administrador/i);
    expect(await estadoDeLaPieza(pieza)).toBe('pendiente_revision_interna');
  });

  it('un agency_admin sí puede aprobar, y la pieza pasa a pendiente_revision', async () => {
    const pieza = await crearPieza(ids.marcaA, 'pendiente_revision_interna');
    const admin_ = await sesionDe(correos.adminA);

    const { error } = await admin_.rpc('approve_internal_review', { p_content_piece_id: pieza });

    expect(error).toBeNull();
    expect(await estadoDeLaPieza(pieza)).toBe('pendiente_revision');
    expect(await historial(pieza, 'pendiente_revision')).toHaveLength(1);
  });

  it('rechaza si la pieza no está en pendiente_revision_interna', async () => {
    const pieza = await crearPieza(ids.marcaA, 'borrador');
    const admin_ = await sesionDe(correos.adminA);

    const { error } = await admin_.rpc('approve_internal_review', { p_content_piece_id: pieza });

    expect(error?.message).toMatch(/revisión interna/i);
  });

  it('el admin de OTRA agencia no puede aprobar, aunque sea agency_admin', async () => {
    const pieza = await crearPieza(ids.marcaA, 'pendiente_revision_interna');
    const adminDeB = await sesionDe(correos.adminB);

    const { error } = await adminDeB.rpc('approve_internal_review', { p_content_piece_id: pieza });

    expect(error).not.toBeNull();
    expect(await estadoDeLaPieza(pieza)).toBe('pendiente_revision_interna');
  });
});

describe('request_internal_changes', () => {
  it('un agency_member NO puede pedir corrección interna', async () => {
    const pieza = await crearPieza(ids.marcaA, 'pendiente_revision_interna');
    const miembro = await sesionDe(correos.miembroA);

    const { error } = await miembro.rpc('request_internal_changes', { p_content_piece_id: pieza, p_note: 'Cambia esto' });

    expect(error?.message).toMatch(/administrador/i);
  });

  it('un agency_admin puede pedir corrección con nota, y la pieza vuelve a borrador', async () => {
    const pieza = await crearPieza(ids.marcaA, 'pendiente_revision_interna', { assignee_id: ids.miembroA });
    const admin_ = await sesionDe(correos.adminA);

    const { error } = await admin_.rpc('request_internal_changes', { p_content_piece_id: pieza, p_note: 'Cambia la fecha' });

    expect(error).toBeNull();
    expect(await estadoDeLaPieza(pieza)).toBe('borrador');
    const filas = await historial(pieza, 'borrador');
    expect(filas).toHaveLength(1);
    expect(filas[0].note).toBe('Cambia la fecha');
  });

  it('sin nota (vacía o solo espacios) rechaza', async () => {
    const pieza = await crearPieza(ids.marcaA, 'pendiente_revision_interna');
    const admin_ = await sesionDe(correos.adminA);

    const vacia = await admin_.rpc('request_internal_changes', { p_content_piece_id: pieza, p_note: '' });
    expect(vacia.error?.message).toMatch(/nota/i);

    const espacios = await admin_.rpc('request_internal_changes', { p_content_piece_id: pieza, p_note: '   ' });
    expect(espacios.error?.message).toMatch(/nota/i);
  });

  it('rechaza si la pieza no está en pendiente_revision_interna', async () => {
    const pieza = await crearPieza(ids.marcaA, 'borrador');
    const admin_ = await sesionDe(correos.adminA);

    const { error } = await admin_.rpc('request_internal_changes', { p_content_piece_id: pieza, p_note: 'Algo' });

    expect(error?.message).toMatch(/revisión interna/i);
  });

  it('notifica al responsable interno (assignee_id) si tiene uno', async () => {
    const pieza = await crearPieza(ids.marcaA, 'pendiente_revision_interna', { assignee_id: ids.miembroA, created_by: ids.adminA });
    const admin_ = await sesionDe(correos.adminA);

    const { error } = await admin_.rpc('request_internal_changes', { p_content_piece_id: pieza, p_note: 'Corrige el copy' });
    expect(error).toBeNull();

    const notis = await notificacionesDe(ids.miembroA, 'correccion_interna_solicitada');
    expect(notis.some((n) => n.content_piece_id === pieza && n.body === 'Corrige el copy')).toBe(true);
  });

  it('sin responsable interno, notifica a quien creó la pieza', async () => {
    const pieza = await crearPieza(ids.marcaA, 'pendiente_revision_interna', { assignee_id: null, created_by: ids.miembroA });
    const admin_ = await sesionDe(correos.adminA);

    const { error } = await admin_.rpc('request_internal_changes', { p_content_piece_id: pieza, p_note: 'Falta el link' });
    expect(error).toBeNull();

    const notis = await notificacionesDe(ids.miembroA, 'correccion_interna_solicitada');
    expect(notis.some((n) => n.content_piece_id === pieza && n.body === 'Falta el link')).toBe(true);
  });

  it('el admin de OTRA agencia no puede pedir corrección', async () => {
    const pieza = await crearPieza(ids.marcaA, 'pendiente_revision_interna');
    const adminDeB = await sesionDe(correos.adminB);

    const { error } = await adminDeB.rpc('request_internal_changes', { p_content_piece_id: pieza, p_note: 'Algo' });

    expect(error).not.toBeNull();
    expect(await estadoDeLaPieza(pieza)).toBe('pendiente_revision_interna');
  });
});

describe('submit_for_review (sin cambios) tras un rechazo del cliente', () => {
  it('un agency_member reenvía sin pasar de nuevo por un agency_admin', async () => {
    const pieza = await crearPieza(ids.marcaA, 'cambios_solicitados');
    const miembro = await sesionDe(correos.miembroA);

    const { error } = await miembro.rpc('submit_for_review', { p_content_piece_id: pieza });

    expect(error).toBeNull();
    expect(await estadoDeLaPieza(pieza)).toBe('pendiente_revision');
  });
});
```

- [ ] **Step 3: Corre las pruebas de integración y confirma que fallan**

Run: `npm run test:integration`
Expected: FAIL — los RPC `submit_for_internal_review`, `approve_internal_review` y
`request_internal_changes` no existen todavía (la migración no está aplicada a la base local); el
error de Postgres es del estilo `function submit_for_internal_review(uuid) does not exist` o
`42883`.

- [ ] **Step 4: Aplica la migración a la Supabase local y vuelve a correr las pruebas**

`npm run test:integration` ya hace `supabase db reset` antes de correr Vitest, y ese reset aplica
TODAS las migraciones de `supabase/migrations/` en orden — incluida la que acabas de crear. No hace
falta aplicarla a mano para la Supabase local; sí hace falta pegarla luego a mano en el panel de
Supabase de producción, que es responsabilidad de quien revise el resultado final, no de este paso.

Run: `npm run test:integration`
Expected: PASS — las 13 pruebas nuevas de `tests/integration/revision-interna.test.ts`, y ninguna
de las suites existentes debe romperse (confirma que no se tocó nada de `submit_for_review` ni de
las demás funciones).

- [ ] **Step 5: Agrega las filas a `docs/superpowers/auditoria-aislamiento-0010.md`**

Abre el archivo, busca la tabla numerada (termina en la fila 45 antes de este cambio) y agrégale
tres filas nuevas al final, con el número de línea EXACTO de cada función dentro del archivo que
acabas de escribir (búscalo tú: `grep -n "if not is_agency\|if not is_agency_admin" supabase/migrations/0013_revision_interna.sql`):

```markdown
| 46 | `0013:<línea>` | `submit_for_internal_review` (función nueva) | **`is_agency() and has_client_access(v_client)`** | Mismo patrón que `submit_for_review`: cualquiera del equipo puede proponer, pero solo sobre una pieza de su propia agencia. |
| 47 | `0013:<línea>` | `approve_internal_review` (función nueva) | **`is_agency_admin() and has_client_access(v_client)`** | El admin de otra agencia también tiene que rechazarse aquí — ser admin no basta, tiene que ser admin DE ESTA agencia. |
| 48 | `0013:<línea>` | `request_internal_changes` (función nueva) | **`is_agency_admin() and has_client_access(v_client)`** | Misma razón que la anterior. |
```

- [ ] **Step 6: Typecheck y commit**

Run: `npm run typecheck`
Expected: exit 0 (esta tarea no toca TypeScript, pero confirma que la migración no rompió nada que
el resto del código espere).

```bash
git add supabase/migrations/0013_revision_interna.sql tests/integration/revision-interna.test.ts docs/superpowers/auditoria-aislamiento-0010.md
git commit -m "feat: revisión interna de piezas antes del cliente (migración)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Tipos compartidos — `WebhookEventType` y `ContentStatus`

**Files:**
- Modify: `lib/webhooks/dispatch.ts:5-12`
- Modify: `types/database.ts` (el tipo `ContentStatus`, `STATUS_LABELS`, `STATUS_COLORS`)

**Interfaces:**
- Consumes: nada de código de otra tarea (el nombre del estado y del evento ya están fijados por
  el spec y por la migración de la Tarea 1, pero este archivo no necesita que la migración esté
  aplicada para compilar).
- Produces: `'pieza_enviada_a_revision_interna'` como miembro válido de `WebhookEventType`
  (`lib/webhooks/dispatch.ts`); `'pendiente_revision_interna'` como miembro válido de
  `ContentStatus`, con su entrada en `STATUS_LABELS` y `STATUS_COLORS` (`types/database.ts`). La
  Tarea 3 usa el primero; las Tareas 4 y 5 usan el segundo.

Esta tarea no tiene prueba propia: son cambios de tipos sin lógica, y el gate es que el proyecto
siga compilando. La Tarea 4 los ejercita de verdad a través de sus pruebas de componente.

- [ ] **Step 1: Agrega el evento nuevo a `lib/webhooks/dispatch.ts`**

El bloque actual (líneas 5-12) es:

```ts
export type WebhookEventType =
  | 'pieza_creada_revision'
  | 'pieza_aprobada'
  | 'cambios_solicitados'
  | 'comentario_agregado'
  | 'fecha_cambiada'
  | 'pieza_programada'
  | 'pieza_publicada';
```

Reemplázalo por:

```ts
export type WebhookEventType =
  | 'pieza_creada_revision'
  | 'pieza_aprobada'
  | 'cambios_solicitados'
  | 'comentario_agregado'
  | 'fecha_cambiada'
  | 'pieza_programada'
  | 'pieza_publicada'
  // Se dispara al entrar a revisión interna (antes de que la vea el cliente). Nadie lo recibe
  // salvo que lo agregue a mano al array `events` de su webhook -- ver
  // docs/superpowers/specs/2026-09-29-revision-interna-de-piezas-design.md.
  | 'pieza_enviada_a_revision_interna';
```

- [ ] **Step 2: Agrega el estado nuevo a `types/database.ts`**

El `ContentStatus` actual es:

```ts
export type ContentStatus =
  | 'borrador'
  | 'pendiente_revision'
  | 'cambios_solicitados'
  | 'aprobado'
  | 'programado'
  | 'publicado'
  | 'cancelado';
```

Reemplázalo por (el orden importa poco a TypeScript, pero se coloca donde vive en la máquina de
estados real, entre `borrador` y `pendiente_revision`):

```ts
export type ContentStatus =
  | 'borrador'
  | 'pendiente_revision_interna'
  | 'pendiente_revision'
  | 'cambios_solicitados'
  | 'aprobado'
  | 'programado'
  | 'publicado'
  | 'cancelado';
```

`STATUS_LABELS` actual:

```ts
export const STATUS_LABELS: Record<ContentStatus, string> = {
  borrador: 'Borrador',
  pendiente_revision: 'Pendiente de revisión',
  cambios_solicitados: 'Cambios solicitados',
  aprobado: 'Aprobado',
  programado: 'Programado',
  publicado: 'Publicado',
  cancelado: 'Cancelado',
};
```

Reemplázalo por:

```ts
export const STATUS_LABELS: Record<ContentStatus, string> = {
  borrador: 'Borrador',
  pendiente_revision_interna: 'Revisión interna',
  pendiente_revision: 'Pendiente de revisión',
  cambios_solicitados: 'Cambios solicitados',
  aprobado: 'Aprobado',
  programado: 'Programado',
  publicado: 'Publicado',
  cancelado: 'Cancelado',
};
```

`STATUS_COLORS` actual:

```ts
export const STATUS_COLORS: Record<ContentStatus, string> = {
  borrador: 'bg-slate-200 text-slate-700',
  pendiente_revision: 'bg-amber-100 text-amber-800',
  cambios_solicitados: 'bg-red-100 text-red-700',
  aprobado: 'bg-green-100 text-green-700',
  programado: 'bg-blue-100 text-blue-700',
  publicado: 'bg-emerald-100 text-emerald-800',
  cancelado: 'bg-zinc-200 text-zinc-600',
};
```

Reemplázalo por (color propio, distinto del ámbar que ya usa `pendiente_revision`, para que el
badge distinga a simple vista cuál de los dos "pendiente" es):

```ts
export const STATUS_COLORS: Record<ContentStatus, string> = {
  borrador: 'bg-slate-200 text-slate-700',
  pendiente_revision_interna: 'bg-violet-100 text-violet-800',
  pendiente_revision: 'bg-amber-100 text-amber-800',
  cambios_solicitados: 'bg-red-100 text-red-700',
  aprobado: 'bg-green-100 text-green-700',
  programado: 'bg-blue-100 text-blue-700',
  publicado: 'bg-emerald-100 text-emerald-800',
  cancelado: 'bg-zinc-200 text-zinc-600',
};
```

- [ ] **Step 3: Typecheck, lint y commit**

Run: `npm run typecheck && npm run lint`
Expected: exit 0. Si `STATUS_LABELS` o `STATUS_COLORS` quedan sin la entrada nueva, `tsc` falla
solo porque los dos son `Record<ContentStatus, string>` — es la red de seguridad que impide
olvidar una de las dos.

```bash
git add lib/webhooks/dispatch.ts types/database.ts
git commit -m "feat: tipos del estado y evento de revisión interna

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Las tres Server Actions en `app/actions.ts`

**Files:**
- Modify: `app/actions.ts` (agrega 3 funciones nuevas, después de `submitForReview`)

**Interfaces:**
- Consumes: `submit_for_internal_review`, `approve_internal_review`, `request_internal_changes`
  (RPC de la Tarea 1); `'pieza_enviada_a_revision_interna'` y `'pieza_creada_revision'` de
  `WebhookEventType` (Tarea 2).
- Produces: `submitForInternalReview(id: string): Promise<void>`,
  `approveInternalReview(id: string): Promise<void>`,
  `requestInternalChanges(id: string, note: string): Promise<void>`, exportadas de
  `@/app/actions`. La Tarea 4 las importa y las llama.

Sin prueba propia, mismo criterio que la Tarea 2: son envoltorios delgados sobre el RPC, igual que
`submitForReview` ya lo es — este proyecto no las prueba de forma directa (los componentes que las
llaman las mockean; ver `tests/unit/components/ContentPieceForm.test.tsx` para el mismo patrón con
`createContentPiece`). Las prueba de verdad la Tarea 1 (el RPC) y la Tarea 4 (el componente que las
invoca, con ellas mockeadas).

- [ ] **Step 1: Agrega las tres Server Actions a `app/actions.ts`**

El bloque actual de `submitForReview` (líneas 163-177) es:

```ts
export async function submitForReview(id: string) {
  const profile = await requireAgency();
  const supabase = await createClient();
  const { error } = await supabase.rpc('submit_for_review', { p_content_piece_id: id });
  if (error) throw errorParaElCliente(error, 'submitForReview');
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
```

Justo después de esa función (antes de `export async function approvePiece`), agrega:

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
    // Mismo evento que submitForReview: es el mismo momento semántico (el cliente se entera),
    // solo que ahora se llega aquí después del visto bueno interno.
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

`requestInternalChanges` no dispara ningún webhook: no hay ningún evento del catálogo para "de
vuelta a borrador" (el RPC ya avisa al responsable con una fila en `notifications`), y las demás
funciones de este archivo que tampoco cambian el estado hacia el cliente (`deleteAttachment`,
etc.) tampoco disparan webhook — mismo criterio.

- [ ] **Step 2: Typecheck, lint y commit**

Run: `npm run typecheck && npm run lint`
Expected: exit 0.

```bash
git add app/actions.ts
git commit -m "feat: Server Actions de revisión interna

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `ContentPieceDetail.tsx` — el botón renombrado y la sección nueva

**Files:**
- Modify: `components/ContentPieceDetail.tsx`
- Test: `tests/unit/components/ContentPieceDetail.test.tsx` (archivo nuevo — no existe ninguna
  prueba de este componente todavía)

**Interfaces:**
- Consumes: `submitForInternalReview`, `approveInternalReview`, `requestInternalChanges` de
  `@/app/actions` (Tarea 3); `'pendiente_revision_interna'` de `ContentStatus` (Tarea 2).
- Produces: nada que otra tarea de este plan consuma.

**Contexto exacto de `components/ContentPieceDetail.tsx` en este momento** (léelo entero antes de
tocarlo — es donde vive toda la lógica de este archivo, y los fragmentos de abajo son los únicos
puntos que cambian):

- Línea 16-24: el import de las Server Actions —

```tsx
import {
  approvePiece,
  cancelPiece,
  deleteContentPiece,
  duplicateContentPiece,
  markPiecePublished,
  markPieceScheduled,
  requestPieceChanges,
  submitForReview,
} from '@/app/actions';
```

- Líneas 46-50: los `useState` existentes —

```tsx
  const [changesNote, setChangesNote] = useState('');
  const [showChangesBox, setShowChangesBox] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelBox, setShowCancelBox] = useState(false);
  const [error, setError] = useState<string | null>(null);
```

- Líneas 147-150: el botón de `borrador` dentro del bloque `isAgency` —

```tsx
            {piece.status === 'borrador' && (
              <button disabled={isPending} onClick={() => run(() => submitForReview(piece.id))} className="btn-primary">
                Enviar a revisión
              </button>
            )}
```

- Líneas 209-265: la sección de aprobación del cliente completa (el patrón visual que la sección
  nueva de este paso copia).

- [ ] **Step 1: Escribe las pruebas, en `tests/unit/components/ContentPieceDetail.test.tsx`**

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContentPieceDetail } from '@/components/ContentPieceDetail';
import { approveInternalReview, requestInternalChanges, submitForInternalReview } from '@/app/actions';
import type { Client, ContentPiece, Profile } from '@/types/database';

const push = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh, back: vi.fn() }),
}));

// ContentPieceDetail importa todas estas de @/app/actions (algunas directamente, otras a través de
// AttachmentUploader/CommentThread, que también las usan) — hay que mockearlas todas o una llamada
// no probada en esta prueba deja `undefined(...)` esperando a que alguien la dispare.
vi.mock('@/app/actions', () => ({
  submitForReview: vi.fn(),
  submitForInternalReview: vi.fn(),
  approveInternalReview: vi.fn(),
  requestInternalChanges: vi.fn(),
  approvePiece: vi.fn(),
  cancelPiece: vi.fn(),
  deleteContentPiece: vi.fn(),
  duplicateContentPiece: vi.fn(),
  markPiecePublished: vi.fn(),
  markPieceScheduled: vi.fn(),
  requestPieceChanges: vi.fn(),
  addComment: vi.fn(),
  deleteAttachment: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } }),
}));

const CLIENTE: Client = {
  id: 'client-1',
  name: 'Cliente Uno',
  agency_id: 'agency-1',
  brand_name: 'Marca Uno',
  timezone: 'UTC',
  logo_url: null,
  notes: null,
  archived: false,
  billing_mode: 'paquete',
  created_by: null,
  created_at: '2026-01-01T00:00:00.000Z',
};

function crearPerfil(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'profile-1',
    full_name: 'Persona de prueba',
    email: 'persona@ejemplo.com',
    role: 'agency_member',
    agency_id: 'agency-1',
    phone: null,
    avatar_url: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function crearPieza(overrides: Partial<ContentPiece> = {}): ContentPiece & { clients: Client } {
  return {
    id: 'pieza-1',
    client_id: 'client-1',
    platform: 'instagram',
    format: 'post',
    title: 'Pieza de prueba',
    copy_text: '',
    reference_link: null,
    scheduled_at: '2026-10-05T15:00:00.000Z',
    status: 'borrador',
    assignee_id: null,
    created_by: null,
    duplicated_from: null,
    cancelled_reason: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    clients: CLIENTE,
    ...overrides,
  };
}

function renderizar(opciones: {
  profile?: Profile;
  piece?: ContentPiece & { clients: Client };
  isClientContact?: boolean;
} = {}) {
  return render(
    <ContentPieceDetail
      profile={opciones.profile ?? crearPerfil()}
      piece={opciones.piece ?? crearPieza()}
      attachments={[]}
      urls={{}}
      comments={[]}
      history={[]}
      isClientContact={opciones.isClientContact ?? false}
    />
  );
}

describe('ContentPieceDetail — revisión interna', () => {
  afterEach(() => vi.clearAllMocks());

  it('en borrador, el botón dice "Enviar a revisión interna" (no "Enviar a revisión") y llama a submitForInternalReview', async () => {
    vi.mocked(submitForInternalReview).mockResolvedValue(undefined);
    renderizar({ piece: crearPieza({ status: 'borrador' }) });

    expect(screen.queryByRole('button', { name: 'Enviar a revisión' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar a revisión interna' }));

    await waitFor(() => expect(submitForInternalReview).toHaveBeenCalledWith('pieza-1'));
  });

  it('en pendiente_revision_interna, un agency_admin ve los dos botones de decisión', () => {
    renderizar({
      profile: crearPerfil({ role: 'agency_admin' }),
      piece: crearPieza({ status: 'pendiente_revision_interna' }),
    });

    expect(screen.getByRole('button', { name: '✓ Aprobar y enviar al cliente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pedir corrección interna' })).toBeInTheDocument();
  });

  it('en pendiente_revision_interna, un agency_member NO ve los botones de decisión', () => {
    renderizar({
      profile: crearPerfil({ role: 'agency_member' }),
      piece: crearPieza({ status: 'pendiente_revision_interna' }),
    });

    expect(screen.queryByRole('button', { name: '✓ Aprobar y enviar al cliente' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pedir corrección interna' })).not.toBeInTheDocument();
  });

  it('aprobar pide confirmación primero, y solo al confirmar llama a approveInternalReview', async () => {
    vi.mocked(approveInternalReview).mockResolvedValue(undefined);
    renderizar({
      profile: crearPerfil({ role: 'agency_admin' }),
      piece: crearPieza({ status: 'pendiente_revision_interna' }),
    });

    fireEvent.click(screen.getByRole('button', { name: '✓ Aprobar y enviar al cliente' }));
    expect(approveInternalReview).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Aprobar y enviar' }));
    await waitFor(() => expect(approveInternalReview).toHaveBeenCalledWith('pieza-1'));
  });

  it('"Pedir corrección interna" exige la nota antes de habilitar el envío', () => {
    renderizar({
      profile: crearPerfil({ role: 'agency_admin' }),
      piece: crearPieza({ status: 'pendiente_revision_interna' }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Pedir corrección interna' }));
    expect(screen.getByRole('button', { name: 'Enviar solicitud' })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Explica qué hay que corregir…'), {
      target: { value: 'Cambia la fecha' },
    });
    expect(screen.getByRole('button', { name: 'Enviar solicitud' })).toBeEnabled();
  });

  it('al enviar la corrección interna, llama a requestInternalChanges con el id y la nota', async () => {
    vi.mocked(requestInternalChanges).mockResolvedValue(undefined);
    renderizar({
      profile: crearPerfil({ role: 'agency_admin' }),
      piece: crearPieza({ status: 'pendiente_revision_interna' }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Pedir corrección interna' }));
    fireEvent.change(screen.getByPlaceholderText('Explica qué hay que corregir…'), {
      target: { value: 'Cambia la fecha' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }));

    await waitFor(() => expect(requestInternalChanges).toHaveBeenCalledWith('pieza-1', 'Cambia la fecha'));
  });

  it('el reenvío tras cambios del cliente sigue diciendo "Reenviar a revisión" y llamando a submitForReview', () => {
    renderizar({ piece: crearPieza({ status: 'cambios_solicitados' }) });

    expect(screen.getByRole('button', { name: 'Reenviar a revisión' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Corre las pruebas y confirma que fallan**

Run: `npx vitest run tests/unit/components/ContentPieceDetail.test.tsx`
Expected: FAIL — el botón todavía dice "Enviar a revisión" (no "...interna"), `submitForInternalReview` no existe en `@/app/actions` todavía, y no hay ninguna sección para
`pendiente_revision_interna`.

- [ ] **Step 3a: Actualiza el import de Server Actions**

Reemplaza el bloque de import (líneas 16-24):

```tsx
import {
  approvePiece,
  cancelPiece,
  deleteContentPiece,
  duplicateContentPiece,
  markPiecePublished,
  markPieceScheduled,
  requestPieceChanges,
  submitForReview,
} from '@/app/actions';
```

por:

```tsx
import {
  approveInternalReview,
  approvePiece,
  cancelPiece,
  deleteContentPiece,
  duplicateContentPiece,
  markPiecePublished,
  markPieceScheduled,
  requestInternalChanges,
  requestPieceChanges,
  submitForInternalReview,
  submitForReview,
} from '@/app/actions';
```

- [ ] **Step 3b: Agrega el estado nuevo**

Después de la línea `const [changesNote, setChangesNote] = useState('');` (línea 46), agrega:

```tsx
  const [internalChangesNote, setInternalChangesNote] = useState('');
  const [showInternalChangesBox, setShowInternalChangesBox] = useState(false);
```

(Estado propio, separado de `changesNote`/`showChangesBox`: esos son del lado del cliente. Aunque
`pendiente_revision_interna` y `pendiente_revision` son estados que nunca coinciden a la vez en la
misma pieza, reutilizar la misma variable para dos propósitos distintos sería frágil — mejor cada
sección con la suya.)

- [ ] **Step 3c: Cambia el botón de `borrador`**

Reemplaza:

```tsx
            {piece.status === 'borrador' && (
              <button disabled={isPending} onClick={() => run(() => submitForReview(piece.id))} className="btn-primary">
                Enviar a revisión
              </button>
            )}
```

por:

```tsx
            {piece.status === 'borrador' && (
              <button disabled={isPending} onClick={() => run(() => submitForInternalReview(piece.id))} className="btn-primary">
                Enviar a revisión interna
              </button>
            )}
```

El bloque de `cambios_solicitados` (el "Reenviar a revisión" justo debajo) **no cambia** — sigue
llamando a `submitForReview`.

- [ ] **Step 3d: Agrega la sección nueva**

La sección de aprobación del cliente empieza así:

```tsx
        {/* Flujo de aprobación para cliente */}
        {isClientContact && piece.status === 'pendiente_revision' && (
```

Justo ANTES de esa línea (después del cierre del bloque `{showCancelBox && (...)}` que la
precede), agrega:

```tsx
        {/* Revisión interna: solo un agency_admin decide si sale al cliente */}
        {isAgency && profile.role === 'agency_admin' && piece.status === 'pendiente_revision_interna' && (
          <div className="mt-5 rounded-xl border border-brand-100 bg-brand-50/60 p-4">
            <p className="mb-3 text-sm font-medium text-slate-700">¿Apruebas esta pieza para mandarla al cliente?</p>
            <div className="flex flex-wrap gap-2">
              <button
                disabled={isPending}
                onClick={() =>
                  confirm({
                    title: 'Aprobar revisión interna',
                    description: 'La pieza pasa a esperar la revisión del cliente.',
                    confirmLabel: 'Aprobar y enviar',
                    onConfirm: () => run(() => approveInternalReview(piece.id)),
                  })
                }
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                ✓ Aprobar y enviar al cliente
              </button>
              <button
                onClick={() => setShowInternalChangesBox((v) => !v)}
                className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-red-600 ring-1 ring-red-200 hover:bg-red-50"
              >
                Pedir corrección interna
              </button>
            </div>
            {showInternalChangesBox && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={internalChangesNote}
                  onChange={(e) => setInternalChangesNote(e.target.value)}
                  placeholder="Explica qué hay que corregir…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  rows={3}
                />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowInternalChangesBox(false)} className="text-sm text-slate-500">
                    Cerrar
                  </button>
                  <button
                    disabled={!internalChangesNote.trim() || isPending}
                    onClick={() =>
                      run(async () => {
                        await requestInternalChanges(piece.id, internalChangesNote);
                        setInternalChangesNote('');
                        setShowInternalChangesBox(false);
                      })
                    }
                    className="rounded-lg bg-red-600 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    Enviar solicitud
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

```

- [ ] **Step 4: Corre las pruebas y confirma que pasan**

Run: `npx vitest run tests/unit/components/ContentPieceDetail.test.tsx`
Expected: PASS — 8 pruebas.

Si alguna falla por un texto o mensaje distinto al que produjo `AttachmentUploader` o
`CommentThread` durante el montaje (por ejemplo, si alguno de los dos llama a otra función de
`@/app/actions` que no está en la lista del mock), agrégala a `vi.mock('@/app/actions', ...)` con
`vi.fn()` — no cambies el componente para acomodar la prueba.

- [ ] **Step 5: Typecheck, lint y commit**

Run: `npm run typecheck && npm run lint`
Expected: exit 0.

```bash
git add components/ContentPieceDetail.tsx tests/unit/components/ContentPieceDetail.test.tsx
git commit -m "feat: UI de revisión interna en la ficha de la pieza

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `PendingList.tsx` — la sección nueva

**Files:**
- Modify: `components/PendingList.tsx`
- Test: `tests/unit/components/PendingList.test.tsx` (ya existe — agrega un `describe` nuevo, no
  toques los existentes)

**Interfaces:**
- Consumes: `'pendiente_revision_interna'` de `ContentStatus` (Tarea 2).
- Produces: nada que otra tarea consuma.

**Contexto exacto de `components/PendingList.tsx` en este momento:**

```tsx
export function PendingList({ profile, pieces, ideas }: { profile: Profile; pieces: ContentPiece[]; ideas: Idea[] }) {
  const now = Date.now();
  const needsAttention = pieces.filter((p) => p.status === 'pendiente_revision' || p.status === 'cambios_solicitados');
```

y, en el JSX, justo antes de la sección `needsAttention`:

```tsx
      {ideasPendientes.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            {esAgencia ? 'Ideas esperando respuesta del cliente' : 'Ideas esperando tu revisión'}
          </h2>
          <IdeaTable ideas={ideasPendientes} showClient={esAgencia} showStatus={esAgencia} />
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          {profile.role === 'client' ? 'Pendientes de tu revisión' : 'Pendientes de aprobación del cliente'} ({needsAttention.length})
        </h2>
```

- [ ] **Step 1: Escribe la prueba, agregada a `tests/unit/components/PendingList.test.tsx`**

Al final del archivo, antes del cierre `});` del último `describe`, agrega un `describe` nuevo
(reutiliza `crearPerfil` y `crearPieza`, ya definidas arriba en el mismo archivo):

```tsx
describe('PendingList — sección de revisión interna de piezas', () => {
  it('una pieza en pendiente_revision_interna aparece en su propia sección, no en la de aprobación del cliente', () => {
    const piezaInterna = crearPieza({ id: 'pieza-interna', title: 'Pieza en revisión interna', status: 'pendiente_revision_interna' });

    render(<PendingList profile={crearPerfil({ role: 'agency_admin' })} pieces={[piezaInterna]} ideas={[]} />);

    expect(screen.getByRole('heading', { name: 'Piezas esperando revisión interna (1)' })).toBeInTheDocument();
    expect(screen.getByText('Pieza en revisión interna')).toBeInTheDocument();
    expect(screen.getByText(/Pendientes de aprobación del cliente \(0\)/)).toBeInTheDocument();
  });

  it('sin ninguna pieza en pendiente_revision_interna, la sección no se renderiza', () => {
    render(<PendingList profile={crearPerfil({ role: 'agency_admin' })} pieces={[]} ideas={[]} />);

    expect(screen.queryByText(/Piezas esperando revisión interna/)).not.toBeInTheDocument();
  });

  it('como cliente, la sección nunca se muestra aunque llegara una pieza en ese estado', () => {
    const piezaInterna = crearPieza({ id: 'pieza-interna', status: 'pendiente_revision_interna' });

    render(<PendingList profile={crearPerfil({ role: 'client' })} pieces={[piezaInterna]} ideas={[]} />);

    expect(screen.queryByText(/Piezas esperando revisión interna/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Corre las pruebas y confirma que fallan**

Run: `npx vitest run tests/unit/components/PendingList.test.tsx`
Expected: FAIL — no existe ningún encabezado "Piezas esperando revisión interna".

- [ ] **Step 3: Agrega la sección al componente**

Reemplaza:

```tsx
export function PendingList({ profile, pieces, ideas }: { profile: Profile; pieces: ContentPiece[]; ideas: Idea[] }) {
  const now = Date.now();
  const needsAttention = pieces.filter((p) => p.status === 'pendiente_revision' || p.status === 'cambios_solicitados');
```

por:

```tsx
export function PendingList({ profile, pieces, ideas }: { profile: Profile; pieces: ContentPiece[]; ideas: Idea[] }) {
  const now = Date.now();
  const pendientesDeRevisionInterna = pieces.filter((p) => p.status === 'pendiente_revision_interna');
  const needsAttention = pieces.filter((p) => p.status === 'pendiente_revision' || p.status === 'cambios_solicitados');
```

Reemplaza:

```tsx
      {ideasPendientes.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            {esAgencia ? 'Ideas esperando respuesta del cliente' : 'Ideas esperando tu revisión'}
          </h2>
          <IdeaTable ideas={ideasPendientes} showClient={esAgencia} showStatus={esAgencia} />
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          {profile.role === 'client' ? 'Pendientes de tu revisión' : 'Pendientes de aprobación del cliente'} ({needsAttention.length})
        </h2>
```

por:

```tsx
      {ideasPendientes.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            {esAgencia ? 'Ideas esperando respuesta del cliente' : 'Ideas esperando tu revisión'}
          </h2>
          <IdeaTable ideas={ideasPendientes} showClient={esAgencia} showStatus={esAgencia} />
        </section>
      )}

      {esAgencia && pendientesDeRevisionInterna.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            Piezas esperando revisión interna ({pendientesDeRevisionInterna.length})
          </h2>
          <PieceTable pieces={pendientesDeRevisionInterna} showClient={esAgencia} />
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          {profile.role === 'client' ? 'Pendientes de tu revisión' : 'Pendientes de aprobación del cliente'} ({needsAttention.length})
        </h2>
```

- [ ] **Step 4: Corre las pruebas y confirma que pasan**

Run: `npx vitest run tests/unit/components/PendingList.test.tsx`
Expected: PASS — las 3 pruebas nuevas, más las que ya existían en el archivo, sin regresión.

- [ ] **Step 5: Typecheck, lint y commit**

Run: `npm run typecheck && npm run lint`
Expected: exit 0.

```bash
git add components/PendingList.tsx tests/unit/components/PendingList.test.tsx
git commit -m "feat: sección de revisión interna en Pendientes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Al terminar las 5 tareas

Corre el gate completo una vez más sobre todo el árbol:

```bash
npm run typecheck && npm run lint && npm run test && npm run test:integration
```

Expected: exit 0 en los cuatro. Esta vez `test:integration` sí importa correrlo — a diferencia de
los sub-proyectos A y B, este SÍ toca SQL y RLS, y es la única forma de confirmar que ninguna
suite existente (`state-transitions.test.ts`, `ideas-transiciones.test.ts`, `aislamiento.test.ts`,
`privilegios.test.ts`) se rompió con el enum nuevo o con las funciones nuevas.

**Recordatorio para el usuario, no para el agente que ejecuta esto:** esta migración se aplica a
mano en el panel de Supabase de producción, pegando `supabase/migrations/0013_revision_interna.sql`
completo en el editor SQL — igual que las anteriores. Sin aplicarla ahí, el código nuevo desplegado
llamaría a funciones que no existen en producción todavía.
