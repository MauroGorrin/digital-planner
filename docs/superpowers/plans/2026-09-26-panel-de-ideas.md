# Panel de ideas — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el equipo proponga ideas, las filtre internamente, las someta al cliente, y convierta las aprobadas en piezas del calendario.

**Architecture:** Tabla `ideas` con su propio ciclo de siete estados, separada de `content_pieces` porque una pieza no puede existir sin fecha y una idea aprobada casi nunca la tiene. Las transiciones viven en funciones `SECURITY DEFINER` de Postgres, igual que las de piezas. La política de lectura —no la interfaz— impide que el cliente vea lo que el equipo descartó.

**Tech Stack:** Next.js 14 (App Router, Server Actions) · TypeScript 5.5 strict · Supabase (Postgres + RLS) · Vitest 5 + jsdom · Tailwind 3.4

**Spec:** `docs/superpowers/specs/2026-09-26-panel-de-ideas-design.md`

## Global Constraints

- Los textos de interfaz van en español, **sin voseo** (tú con tilde: "Descárgalo", "Vuelve", "Elige"), con sus signos `¿` y `¡` y sus tildes.
- El estado de una idea **nunca** se cambia con un `update` directo: solo por las funciones `SECURITY DEFINER`. Es la misma regla no negociable que rige `content_pieces.status`.
- Pedir corrección y descartar **exigen nota**, validada en la función con `raise exception`, no en el formulario.
- El cliente solo puede ver ideas en `pendiente_cliente`, `correccion_cliente`, `aprobada` o `convertida`. Lo impone la política RLS.
- Nunca editar una migración ya aplicada (`0001`–`0004`): los cambios van en `0005`.
- Toda prueba unitaria vive en `tests/unit/**` y nunca toca Postgres ni la red; solo `tests/integration/**` usa Postgres real.
- `SUPABASE_SERVICE_ROLE_KEY` es solo de servidor.
- Gate antes de dar por terminada cualquier tarea: `npm run typecheck && npm run lint && npm run test && npm run test:integration`.

---

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `supabase/migrations/0005_ideas.sql` | Enum, tablas, columna en `notifications`, políticas RLS | 1 |
| `types/database.ts` | `IdeaStatus`, `Idea`, `IdeaStatusHistoryEntry`, etiquetas | 1 |
| `tests/integration/ideas-rls.test.ts` | Qué ve cada rol, contra Postgres real | 1 |
| `supabase/migrations/0005_ideas.sql` | Las seis funciones de transición | 2 |
| `tests/integration/ideas-transiciones.test.ts` | Permisos, notas obligatorias, notificaciones | 2 |
| `lib/ideas.ts` | `accionesDisponibles`, puro y sin React | 2 |
| `tests/unit/lib/ideas.test.ts` | Esa función | 2 |
| `app/actions-ideas.ts` | Server Actions que llaman a las funciones | 3 |
| `app/ideas/page.tsx` | La sección, servidor | 3 |
| `components/IdeasBoard.tsx` | Listado por estado y acciones | 3 |
| `components/NuevaIdeaForm.tsx` | Crear idea | 3 |
| `components/AppShell.tsx` | Enlace "Ideas" en la navegación | 3, 4 |
| `app/pendientes/page.tsx` | Ideas que esperan al cliente | 4 |
| `components/PendingList.tsx` | Mostrarlas junto a las piezas | 4 |
| `components/ContentPieceForm.tsx` | Prellenado desde una idea | 5 |

---

## Task 1: Migración de ideas y políticas de visibilidad

**Files:**
- Create: `supabase/migrations/0005_ideas.sql`
- Create: `tests/integration/ideas-rls.test.ts`
- Modify: `types/database.ts` (agregar al final de los tipos existentes)

**Interfaces:**
- Consumes: `clients`, `profiles`, `content_pieces`, `client_contacts`, `notifications`, `platform_type`, `content_format` de `0001_init.sql`; `is_agency()`.
- Produces: enum `idea_status`; tablas `ideas` e `idea_status_history`; columna `notifications.idea_id`; tipos `IdeaStatus`, `Idea`, `IdeaStatusHistoryEntry` y `IDEA_STATUS_LABELS`.

- [ ] **Step 1: Escribir la prueba de integración que falla**

Crear `tests/integration/ideas-rls.test.ts`:

```typescript
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
const sufijo = Date.now();
const correos = {
  agencia: `ideas-agencia-${sufijo}@prueba.local`,
  cliente: `ideas-cliente-${sufijo}@prueba.local`,
};

const ids = { agencia: '', cliente: '', marca: '' };

async function crearUsuario(email: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user.id;
}

async function sesionDe(email: string): Promise<SupabaseClient> {
  const cliente = createClient(URL!, ANON!, { auth: { persistSession: false } });
  const { error } = await cliente.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return cliente;
}

async function crearIdea(titulo: string, status: string) {
  const { data, error } = await admin
    .from('ideas')
    .insert({
      client_id: ids.marca,
      title: titulo,
      description: 'Descripcion de prueba',
      status,
      created_by: ids.agencia,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

beforeAll(async () => {
  ids.agencia = await crearUsuario(correos.agencia);
  ids.cliente = await crearUsuario(correos.cliente);
  await admin.from('profiles').update({ role: 'agency_admin' }).eq('id', ids.agencia);
  await admin.from('profiles').update({ role: 'client' }).eq('id', ids.cliente);

  const { data: marca, error } = await admin
    .from('clients')
    .insert({
      name: `Marca ideas ${sufijo}`,
      brand_name: 'Ideas',
      timezone: 'America/Mexico_City',
      created_by: ids.agencia,
    })
    .select('id')
    .single();
  if (error) throw error;
  ids.marca = marca.id;

  await admin.from('client_contacts').insert({ client_id: ids.marca, profile_id: ids.cliente });
  await admin.from('client_assignments').insert({ client_id: ids.marca, profile_id: ids.agencia });
});

afterAll(async () => {
  await admin.from('clients').delete().eq('id', ids.marca);
  for (const id of [ids.agencia, ids.cliente]) {
    if (id) await admin.auth.admin.deleteUser(id);
  }
});

describe('visibilidad de ideas', () => {
  it('el cliente no ve una idea en propuesta ni en correccion interna', async () => {
    const enPropuesta = await crearIdea('Solo del equipo', 'propuesta');
    const enCorreccion = await crearIdea('Devuelta al autor', 'correccion_interna');

    const cliente = await sesionDe(correos.cliente);
    const { data } = await cliente.from('ideas').select('id');
    const visibles = (data ?? []).map((i) => i.id);

    expect(visibles).not.toContain(enPropuesta);
    expect(visibles).not.toContain(enCorreccion);
  });

  it('el cliente si ve una idea desde pendiente_cliente en adelante', async () => {
    const pendiente = await crearIdea('Para que la apruebe', 'pendiente_cliente');
    const aprobada = await crearIdea('Ya aprobada', 'aprobada');

    const cliente = await sesionDe(correos.cliente);
    const { data } = await cliente.from('ideas').select('id');
    const visibles = (data ?? []).map((i) => i.id);

    expect(visibles).toContain(pendiente);
    expect(visibles).toContain(aprobada);
  });

  it('la agencia ve todas, incluidas las que el cliente no puede ver', async () => {
    const interna = await crearIdea('Interna', 'propuesta');

    const agencia = await sesionDe(correos.agencia);
    const { data } = await agencia.from('ideas').select('id');

    expect((data ?? []).map((i) => i.id)).toContain(interna);
  });

  it('el cliente no puede crear ideas', async () => {
    const cliente = await sesionDe(correos.cliente);
    const { error } = await cliente.from('ideas').insert({
      client_id: ids.marca,
      title: 'Idea del cliente',
      description: 'No deberia entrar',
    });

    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Correr la prueba y verificar que falla**

Run: `npm run test:integration`
Expected: FAIL. Todos los casos fallan porque la relación `ideas` no existe todavía.

- [ ] **Step 3: Escribir la migración**

Crear `supabase/migrations/0005_ideas.sql`:

```sql
-- Panel de ideas: la etapa anterior al calendario.
-- Las ideas no tienen fecha; la fecha se elige al convertirlas en pieza.
--
-- Repetible a proposito: estas migraciones se aplican a mano, pegadas en el editor SQL del panel
-- de Supabase, y una aplicacion que quedo a medias tiene que poder reintentarse.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'idea_status') then
    create type idea_status as enum (
      'propuesta',
      'correccion_interna',
      'pendiente_cliente',
      'correccion_cliente',
      'aprobada',
      'descartada',
      'convertida'
    );
  end if;
end;
$$;

create table if not exists ideas (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  title text not null,
  description text not null default '',
  reference_link text,
  suggested_platform platform_type,
  suggested_format content_format,
  status idea_status not null default 'propuesta',
  created_by uuid references profiles (id),
  -- on delete set null, no cascade: borrar la pieza no debe borrar la idea que la origino ni el
  -- registro de por que se aprobo.
  content_piece_id uuid references content_pieces (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ideas_client_status on ideas (client_id, status);

create table if not exists idea_status_history (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references ideas (id) on delete cascade,
  from_status idea_status,
  to_status idea_status not null,
  changed_by uuid references profiles (id),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_idea_history_idea on idea_status_history (idea_id);

-- notifications.content_piece_id apunta a piezas, asi que una notificacion de idea no tendria
-- adonde llevar al usuario sin esta columna.
alter table notifications
  add column if not exists idea_id uuid references ideas (id) on delete cascade;

drop trigger if exists trg_ideas_updated on ideas;
create trigger trg_ideas_updated before update on ideas
  for each row execute function touch_updated_at();

alter table ideas enable row level security;
alter table idea_status_history enable row level security;

-- El cliente no ve lo que el equipo descarto. Es el punto central del diseno: si esto dependiera
-- de un filtro en la interfaz, una consulta directa a la API mostraria las ideas internas.
--
-- has_client_access() NO sirve aca: devuelve verdadero para cualquier usuario de agencia sin
-- mirar la marca, asi que no distingue el caso agencia del caso contacto de cliente.
drop policy if exists ideas_select on ideas;
create policy ideas_select on ideas for select using (
  is_agency()
  or (
    exists (
      select 1 from client_contacts
      where client_id = ideas.client_id and profile_id = auth.uid()
    )
    and status in ('pendiente_cliente', 'correccion_cliente', 'aprobada', 'convertida')
  )
);

drop policy if exists ideas_agency_write on ideas;
create policy ideas_agency_write on ideas for insert with check (is_agency());

drop policy if exists ideas_agency_update on ideas;
create policy ideas_agency_update on ideas for update using (is_agency()) with check (is_agency());

drop policy if exists ideas_agency_delete on ideas;
create policy ideas_agency_delete on ideas for delete using (is_agency());

-- El historial se lee si se puede leer la idea; se escribe solo desde las funciones de transicion,
-- que son security definer y por lo tanto no pasan por estas politicas.
drop policy if exists idea_history_select on idea_status_history;
create policy idea_history_select on idea_status_history for select using (
  exists (select 1 from ideas where id = idea_status_history.idea_id)
);
```

- [ ] **Step 4: Agregar los tipos**

En `types/database.ts`, al final:

```typescript
export type IdeaStatus =
  | 'propuesta'
  | 'correccion_interna'
  | 'pendiente_cliente'
  | 'correccion_cliente'
  | 'aprobada'
  | 'descartada'
  | 'convertida';

export const IDEA_STATUS_LABELS: Record<IdeaStatus, string> = {
  propuesta: 'Propuesta',
  correccion_interna: 'Corrección interna',
  pendiente_cliente: 'Pendiente del cliente',
  correccion_cliente: 'Corrección del cliente',
  aprobada: 'Aprobada',
  descartada: 'Descartada',
  convertida: 'Convertida en pieza',
};

export interface Idea {
  id: string;
  client_id: string;
  title: string;
  description: string;
  reference_link: string | null;
  suggested_platform: PlatformType | null;
  suggested_format: ContentFormat | null;
  status: IdeaStatus;
  created_by: string | null;
  content_piece_id: string | null;
  created_at: string;
  updated_at: string;
  clients?: Pick<Client, 'id' | 'name' | 'brand_name'> | null;
  author?: Pick<Profile, 'id' | 'full_name'> | null;
}

export interface IdeaStatusHistoryEntry {
  id: string;
  idea_id: string;
  from_status: IdeaStatus | null;
  to_status: IdeaStatus;
  changed_by: string | null;
  note: string | null;
  created_at: string;
}
```

- [ ] **Step 5: Correr las pruebas y verificar que pasan**

Run: `npm run test:integration`
Expected: PASS, los cuatro casos nuevos en verde más los existentes.

- [ ] **Step 6: Verificar que la migración es repetible**

Run: `npx supabase db reset && docker exec -i supabase_db_digital-planner psql -U postgres -d postgres < supabase/migrations/0005_ideas.sql`
Expected: exit 0. Correrlo dos veces seguidas también debe salir en verde.

- [ ] **Step 7: Correr el gate completo**

Run: `npm run typecheck && npm run lint && npm run test && npm run test:integration`
Expected: todo en verde.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0005_ideas.sql tests/integration/ideas-rls.test.ts types/database.ts
git commit -m "feat: add ideas table with client-visibility policy"
```

---

## Task 2: Las seis transiciones, en Postgres

**Files:**
- Modify: `supabase/migrations/0005_ideas.sql` (agregar al final)
- Create: `tests/integration/ideas-transiciones.test.ts`
- Create: `lib/ideas.ts`
- Create: `tests/unit/lib/ideas.test.ts`

**Interfaces:**
- Consumes: tablas y enum de la Tarea 1; `is_agency()`, `is_agency_admin()`, `client_contacts`, `client_assignments`, `notifications`.
- Produces: funciones `submit_idea_to_client`, `request_idea_internal_changes`, `approve_idea`, `request_idea_client_changes`, `discard_idea`, `resubmit_idea`; y `accionesDisponibles(status, rol, esContactoDelCliente): AccionDeIdea[]`.

- [ ] **Step 1: Escribir las pruebas de integración que fallan**

Crear `tests/integration/ideas-transiciones.test.ts`. Reutiliza el mismo encabezado de credenciales, `crearUsuario` y `sesionDe` que `tests/integration/ideas-rls.test.ts` (cópialos: los archivos de integración de este repo son autocontenidos), con estos casos:

```typescript
describe('transiciones de ideas', () => {
  it('un usuario de agencia no puede aprobar', async () => {
    const idea = await crearIdea('Para aprobar', 'pendiente_cliente');
    const agencia = await sesionDe(correos.agencia);

    const { error } = await agencia.rpc('approve_idea', { p_idea_id: idea, p_note: null });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/solo el cliente/i);
  });

  it('un contacto del cliente no puede enviar al cliente', async () => {
    const idea = await crearIdea('En propuesta', 'propuesta');
    const cliente = await sesionDe(correos.cliente);

    const { error } = await cliente.rpc('submit_idea_to_client', { p_idea_id: idea });

    expect(error).not.toBeNull();
  });

  it('pedir correccion sin nota es rechazado', async () => {
    const idea = await crearIdea('Sin nota', 'pendiente_cliente');
    const cliente = await sesionDe(correos.cliente);

    const { error } = await cliente.rpc('request_idea_client_changes', {
      p_idea_id: idea,
      p_note: '   ',
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/nota/i);
  });

  it('pedir correccion con nota la registra en el historial', async () => {
    const idea = await crearIdea('Con nota', 'pendiente_cliente');
    const cliente = await sesionDe(correos.cliente);

    const { error } = await cliente.rpc('request_idea_client_changes', {
      p_idea_id: idea,
      p_note: 'El tono no es el de la marca',
    });
    expect(error).toBeNull();

    const { data } = await admin
      .from('idea_status_history')
      .select('to_status, note')
      .eq('idea_id', idea)
      .single();

    expect(data!.to_status).toBe('correccion_cliente');
    expect(data!.note).toBe('El tono no es el de la marca');
  });

  it('reenviar devuelve la idea a quien pidio el cambio', async () => {
    const agencia = await sesionDe(correos.agencia);

    const deInterna = await crearIdea('Corregida internamente', 'correccion_interna');
    await agencia.rpc('resubmit_idea', { p_idea_id: deInterna });
    const { data: a } = await admin.from('ideas').select('status').eq('id', deInterna).single();
    expect(a!.status).toBe('propuesta');

    const delCliente = await crearIdea('Corregida para el cliente', 'correccion_cliente');
    await agencia.rpc('resubmit_idea', { p_idea_id: delCliente });
    const { data: b } = await admin.from('ideas').select('status').eq('id', delCliente).single();
    expect(b!.status).toBe('pendiente_cliente');
  });

  it('descartar exige motivo y lo registra', async () => {
    const idea = await crearIdea('A descartar', 'propuesta');
    const agencia = await sesionDe(correos.agencia);

    const sinMotivo = await agencia.rpc('discard_idea', { p_idea_id: idea, p_reason: '' });
    expect(sinMotivo.error).not.toBeNull();

    const conMotivo = await agencia.rpc('discard_idea', {
      p_idea_id: idea,
      p_reason: 'Ya se hizo algo igual en julio',
    });
    expect(conMotivo.error).toBeNull();

    const { data } = await admin.from('ideas').select('status').eq('id', idea).single();
    expect(data!.status).toBe('descartada');
  });

  it('enviar al cliente notifica a cada contacto de la marca', async () => {
    const idea = await crearIdea('Para el cliente', 'propuesta');
    const agencia = await sesionDe(correos.agencia);

    const { error } = await agencia.rpc('submit_idea_to_client', { p_idea_id: idea });
    expect(error).toBeNull();

    const { data } = await admin
      .from('notifications')
      .select('profile_id, idea_id, content_piece_id')
      .eq('idea_id', idea);

    expect(data).toHaveLength(1);
    expect(data![0].profile_id).toBe(ids.cliente);
    expect(data![0].content_piece_id).toBeNull();
  });
});
```

- [ ] **Step 2: Correr la prueba y verificar que falla**

Run: `npm run test:integration`
Expected: FAIL. Las funciones RPC no existen; Postgres responde que no encuentra la función.

- [ ] **Step 3: Escribir las funciones**

Agregar al final de `supabase/migrations/0005_ideas.sql`:

```sql
-- Las transiciones viven aca, no en la interfaz: una llamada directa a la API tiene que fallar
-- igual que un clic. Mismo patron que las funciones de content_pieces en 0001_init.sql.

create or replace function submit_idea_to_client(p_idea_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_old idea_status; v_client uuid;
begin
  select status, client_id into v_old, v_client from ideas where id = p_idea_id;
  if v_client is null then raise exception 'La idea no existe'; end if;
  if not is_agency_admin() then raise exception 'Solo un administrador de agencia puede enviarla al cliente'; end if;
  if v_old <> 'propuesta' then raise exception 'Solo una idea en propuesta se puede enviar al cliente'; end if;

  update ideas set status = 'pendiente_cliente' where id = p_idea_id;
  insert into idea_status_history (idea_id, from_status, to_status, changed_by)
    values (p_idea_id, v_old, 'pendiente_cliente', auth.uid());
  insert into notifications (profile_id, idea_id, type, title, body)
    select profile_id, p_idea_id, 'idea_pendiente', 'Una idea espera tu revision', null
    from client_contacts where client_id = v_client;
end;
$$;

create or replace function request_idea_internal_changes(p_idea_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old idea_status;
begin
  select status into v_old from ideas where id = p_idea_id;
  if v_old is null then raise exception 'La idea no existe'; end if;
  if not is_agency_admin() then raise exception 'Solo un administrador de agencia puede pedir correccion interna'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Pedir correccion exige una nota'; end if;
  if v_old <> 'propuesta' then raise exception 'Solo una idea en propuesta se puede devolver al autor'; end if;

  update ideas set status = 'correccion_interna' where id = p_idea_id;
  insert into idea_status_history (idea_id, from_status, to_status, changed_by, note)
    values (p_idea_id, v_old, 'correccion_interna', auth.uid(), p_note);
end;
$$;

create or replace function approve_idea(p_idea_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_old idea_status; v_client uuid;
begin
  select status, client_id into v_old, v_client from ideas where id = p_idea_id;
  if v_client is null then raise exception 'La idea no existe'; end if;
  if not exists (select 1 from client_contacts where client_id = v_client and profile_id = auth.uid()) then
    raise exception 'Solo el cliente puede aprobar una idea';
  end if;
  if v_old <> 'pendiente_cliente' then raise exception 'Solo una idea pendiente se puede aprobar'; end if;

  update ideas set status = 'aprobada' where id = p_idea_id;
  insert into idea_status_history (idea_id, from_status, to_status, changed_by, note)
    values (p_idea_id, v_old, 'aprobada', auth.uid(), p_note);
  insert into notifications (profile_id, idea_id, type, title, body)
    select profile_id, p_idea_id, 'idea_aprobada', 'El cliente aprobo una idea', p_note
    from client_assignments where client_id = v_client;
end;
$$;

create or replace function request_idea_client_changes(p_idea_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old idea_status; v_client uuid;
begin
  select status, client_id into v_old, v_client from ideas where id = p_idea_id;
  if v_client is null then raise exception 'La idea no existe'; end if;
  if not exists (select 1 from client_contacts where client_id = v_client and profile_id = auth.uid()) then
    raise exception 'Solo el cliente puede pedir cambios en una idea';
  end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Pedir correccion exige una nota'; end if;
  if v_old <> 'pendiente_cliente' then raise exception 'Solo una idea pendiente admite pedir cambios'; end if;

  update ideas set status = 'correccion_cliente' where id = p_idea_id;
  insert into idea_status_history (idea_id, from_status, to_status, changed_by, note)
    values (p_idea_id, v_old, 'correccion_cliente', auth.uid(), p_note);
  insert into notifications (profile_id, idea_id, type, title, body)
    select profile_id, p_idea_id, 'idea_cambios', 'El cliente pidio cambios en una idea', p_note
    from client_assignments where client_id = v_client;
end;
$$;

create or replace function discard_idea(p_idea_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old idea_status; v_client uuid;
begin
  select status, client_id into v_old, v_client from ideas where id = p_idea_id;
  if v_client is null then raise exception 'La idea no existe'; end if;
  if not (
    is_agency()
    or exists (select 1 from client_contacts where client_id = v_client and profile_id = auth.uid())
  ) then
    raise exception 'No autorizado';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Descartar exige un motivo'; end if;
  if v_old = 'convertida' then raise exception 'Una idea ya convertida en pieza no se descarta'; end if;

  update ideas set status = 'descartada' where id = p_idea_id;
  insert into idea_status_history (idea_id, from_status, to_status, changed_by, note)
    values (p_idea_id, v_old, 'descartada', auth.uid(), p_reason);
end;
$$;

-- No necesita saber quien pidio el cambio: lo deduce del estado. Si viene de correccion interna
-- vuelve al filtro interno; si viene del cliente vuelve directo al cliente, sin repetir el filtro.
-- Repetirlo haria que cada ida y vuelta con el cliente pasara dos veces por el equipo.
create or replace function resubmit_idea(p_idea_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_old idea_status; v_new idea_status; v_client uuid;
begin
  select status, client_id into v_old, v_client from ideas where id = p_idea_id;
  if v_client is null then raise exception 'La idea no existe'; end if;
  if not is_agency() then raise exception 'Solo la agencia puede reenviar una idea'; end if;

  if v_old = 'correccion_interna' then
    v_new := 'propuesta';
  elsif v_old = 'correccion_cliente' then
    v_new := 'pendiente_cliente';
  else
    raise exception 'Solo una idea en correccion se puede reenviar';
  end if;

  update ideas set status = v_new where id = p_idea_id;
  insert into idea_status_history (idea_id, from_status, to_status, changed_by)
    values (p_idea_id, v_old, v_new, auth.uid());

  if v_new = 'pendiente_cliente' then
    insert into notifications (profile_id, idea_id, type, title, body)
      select profile_id, p_idea_id, 'idea_pendiente', 'Una idea corregida espera tu revision', null
      from client_contacts where client_id = v_client;
  end if;
end;
$$;
```

- [ ] **Step 4: Correr las pruebas de integración**

Run: `npm run test:integration`
Expected: PASS, los siete casos nuevos.

- [ ] **Step 5: Escribir la prueba unitaria de las acciones disponibles**

Crear `tests/unit/lib/ideas.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { accionesDisponibles } from '@/lib/ideas';

describe('accionesDisponibles', () => {
  it('un admin de agencia filtra una propuesta', () => {
    expect(accionesDisponibles('propuesta', 'agency_admin', false)).toEqual([
      'enviar_al_cliente',
      'pedir_correccion_interna',
      'descartar',
    ]);
  });

  it('un miembro de agencia no filtra, solo descarta', () => {
    expect(accionesDisponibles('propuesta', 'agency_member', false)).toEqual(['descartar']);
  });

  it('el cliente decide sobre una idea que le enviaron', () => {
    expect(accionesDisponibles('pendiente_cliente', 'client', true)).toEqual([
      'aprobar',
      'pedir_correccion_cliente',
      'descartar',
    ]);
  });

  it('la agencia no puede aprobar aunque vea la idea pendiente', () => {
    expect(accionesDisponibles('pendiente_cliente', 'agency_admin', false)).toEqual(['descartar']);
  });

  it('una idea en correccion se reenvia desde la agencia', () => {
    expect(accionesDisponibles('correccion_cliente', 'agency_member', false)).toEqual([
      'reenviar',
      'descartar',
    ]);
  });

  it('una idea aprobada se convierte, y solo desde la agencia', () => {
    expect(accionesDisponibles('aprobada', 'agency_admin', false)).toEqual(['convertir', 'descartar']);
    expect(accionesDisponibles('aprobada', 'client', true)).toEqual([]);
  });

  it('una idea descartada o convertida no ofrece nada', () => {
    expect(accionesDisponibles('descartada', 'agency_admin', false)).toEqual([]);
    expect(accionesDisponibles('convertida', 'agency_admin', false)).toEqual([]);
  });
});
```

- [ ] **Step 6: Correr la prueba y verificar que falla**

Run: `npx vitest run tests/unit/lib/ideas.test.ts`
Expected: FAIL con un error de módulo no encontrado sobre `@/lib/ideas`.

- [ ] **Step 7: Escribir `lib/ideas.ts`**

```typescript
import type { IdeaStatus, UserRole } from '@/types/database';

export type AccionDeIdea =
  | 'enviar_al_cliente'
  | 'pedir_correccion_interna'
  | 'aprobar'
  | 'pedir_correccion_cliente'
  | 'reenviar'
  | 'convertir'
  | 'descartar';

/**
 * Que puede hacer cada rol con una idea segun su estado.
 *
 * Existe para que la interfaz no ofrezca un boton que la base va a rechazar: las reglas de verdad
 * estan en las funciones SECURITY DEFINER de 0005_ideas.sql, y esto es su reflejo para decidir que
 * dibujar. Si las dos se separan, manda la base y la interfaz esta mal.
 */
export function accionesDisponibles(
  status: IdeaStatus,
  rol: UserRole,
  esContactoDelCliente: boolean
): AccionDeIdea[] {
  if (status === 'descartada' || status === 'convertida') return [];

  const esAgencia = rol === 'agency_admin' || rol === 'agency_member';
  const acciones: AccionDeIdea[] = [];

  if (status === 'propuesta' && rol === 'agency_admin') {
    acciones.push('enviar_al_cliente', 'pedir_correccion_interna');
  }
  if (status === 'pendiente_cliente' && esContactoDelCliente) {
    acciones.push('aprobar', 'pedir_correccion_cliente');
  }
  if ((status === 'correccion_interna' || status === 'correccion_cliente') && esAgencia) {
    acciones.push('reenviar');
  }
  if (status === 'aprobada' && esAgencia) {
    acciones.push('convertir');
  }

  if (esAgencia || esContactoDelCliente) acciones.push('descartar');

  return acciones;
}
```

- [ ] **Step 8: Correr la prueba y verificar que pasa**

Run: `npx vitest run tests/unit/lib/ideas.test.ts`
Expected: PASS, 7 pruebas.

- [ ] **Step 9: Correr el gate completo**

Run: `npm run typecheck && npm run lint && npm run test && npm run test:integration`
Expected: todo en verde.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/0005_ideas.sql tests/integration/ideas-transiciones.test.ts lib/ideas.ts tests/unit/lib/ideas.test.ts
git commit -m "feat: enforce idea transitions in the database"
```

---

## Task 3: La sección Ideas para la agencia

**Files:**
- Create: `app/actions-ideas.ts`
- Create: `app/ideas/page.tsx`
- Create: `components/IdeasBoard.tsx`
- Create: `components/NuevaIdeaForm.tsx`
- Modify: `components/AppShell.tsx` (agregar `{ href: '/ideas', label: 'Ideas' }` a `AGENCY_NAV`, después de Pendientes)

**Interfaces:**
- Consumes: `accionesDisponibles` y `AccionDeIdea` de la Tarea 2; las seis funciones RPC; los tipos de la Tarea 1.
- Produces: Server Actions `crearIdea`, `enviarIdeaAlCliente`, `pedirCorreccionInterna`, `pedirCorreccionDelCliente`, `aprobarIdea`, `descartarIdea`, `reenviarIdea`.

- [ ] **Step 1: Escribir las Server Actions**

Crear `app/actions-ideas.ts`. Sigue el patrón de `app/actions.ts`: `'use server'` arriba, `requireProfile`/`requireAgency` de `@/lib/auth`, `createClient` de `@/lib/supabase/server`, y `revalidatePath` al final.

```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { requireAgency, requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { ContentFormat, PlatformType } from '@/types/database';

async function llamar(rpc: string, args: Record<string, unknown>) {
  const supabase = createClient();
  const { error } = await supabase.rpc(rpc, args);
  if (error) throw new Error(error.message);
  revalidatePath('/ideas');
  revalidatePath('/pendientes');
}

export async function crearIdea(input: {
  client_id: string;
  title: string;
  description: string;
  reference_link?: string;
  suggested_platform?: PlatformType;
  suggested_format?: ContentFormat;
}) {
  const profile = await requireAgency();
  const supabase = createClient();
  const { error } = await supabase.from('ideas').insert({
    client_id: input.client_id,
    title: input.title,
    description: input.description,
    reference_link: input.reference_link || null,
    suggested_platform: input.suggested_platform ?? null,
    suggested_format: input.suggested_format ?? null,
    created_by: profile.id,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/ideas');
}

export async function enviarIdeaAlCliente(id: string) {
  await requireAgency();
  await llamar('submit_idea_to_client', { p_idea_id: id });
}

export async function pedirCorreccionInterna(id: string, note: string) {
  await requireAgency();
  await llamar('request_idea_internal_changes', { p_idea_id: id, p_note: note });
}

export async function aprobarIdea(id: string, note?: string) {
  await requireProfile();
  await llamar('approve_idea', { p_idea_id: id, p_note: note ?? null });
}

export async function pedirCorreccionDelCliente(id: string, note: string) {
  await requireProfile();
  await llamar('request_idea_client_changes', { p_idea_id: id, p_note: note });
}

export async function descartarIdea(id: string, reason: string) {
  await requireProfile();
  await llamar('discard_idea', { p_idea_id: id, p_reason: reason });
}

export async function reenviarIdea(id: string) {
  await requireAgency();
  await llamar('resubmit_idea', { p_idea_id: id });
}
```

**Nota sobre los guardas:** `requireAgency` en las acciones de agencia es comodidad de interfaz, no el control — el control está en la función de Postgres. Las acciones del cliente usan `requireProfile` porque un contacto de cliente no pasa `requireAgency`.

- [ ] **Step 2: Escribir la página**

Crear `app/ideas/page.tsx`, siguiendo el patrón de `app/calendario/page.tsx`:

```tsx
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/AppShell';
import { IdeasBoard } from '@/components/IdeasBoard';
import type { Client, Idea } from '@/types/database';

export default async function IdeasPage() {
  const profile = await requireProfile();
  const supabase = createClient();

  const [{ data: ideas }, { data: clients }, { data: contactos }] = await Promise.all([
    supabase
      .from('ideas')
      .select('*, clients(id,name,brand_name), author:profiles!ideas_created_by_fkey(id,full_name)')
      .order('created_at', { ascending: false }),
    supabase.from('clients').select('id,name,brand_name,timezone,archived').eq('archived', false).order('name'),
    supabase.from('client_contacts').select('client_id').eq('profile_id', profile.id),
  ]);

  // De que marcas es contacto este usuario. Decide que botones ve, pero no que datos recibe: eso
  // ya lo filtro la politica de lectura.
  const marcasDondeEsContacto = new Set((contactos ?? []).map((c) => c.client_id));

  return (
    <AppShell profile={profile}>
      <IdeasBoard
        profile={profile}
        ideas={(ideas ?? []) as Idea[]}
        clients={(clients ?? []) as Client[]}
        marcasDondeEsContacto={[...marcasDondeEsContacto]}
      />
    </AppShell>
  );
}
```

- [ ] **Step 3: Escribir `components/NuevaIdeaForm.tsx`**

Componente cliente con los campos del modelo: marca (select de `clients`), título, descripción, enlace de referencia opcional, y plataforma y formato **opcionales** con una opción vacía "Sin definir". Al enviar, llama a `crearIdea` y hace `router.refresh()`.

Usa las mismas clases de Tailwind y la misma estructura que `components/ContentPieceForm.tsx` — mismo `rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200`, mismos `label`/`input` — para que las dos pantallas se vean de la misma familia. Solo lo muestra la agencia.

- [ ] **Step 4: Escribir `components/IdeasBoard.tsx`**

Componente cliente que agrupa las ideas por estado, en este orden: Propuesta, Corrección interna, Pendiente del cliente, Corrección del cliente, Aprobada, Convertida, Descartada. Usa `IDEA_STATUS_LABELS` para los títulos.

Por cada idea muestra: título, marca, autor, descripción recortada, y las sugerencias de plataforma y formato si las tiene.

**El maquetado lo resuelves siguiendo `components/CalendarBoard.tsx`** — mismas clases, misma familia visual. Lo que **no** puedes improvisar es el despacho de acciones, que es donde un error importa. Ese va tal cual:

```tsx
const ACCIONES_CON_NOTA: AccionDeIdea[] = [
  'pedir_correccion_interna',
  'pedir_correccion_cliente',
  'descartar',
];

const ETIQUETAS: Record<AccionDeIdea, string> = {
  enviar_al_cliente: 'Enviar al cliente',
  pedir_correccion_interna: 'Pedir corrección',
  aprobar: 'Aprobar',
  pedir_correccion_cliente: 'Pedir cambios',
  reenviar: 'Reenviar',
  convertir: 'Crear pieza desde esta idea',
  descartar: 'Descartar',
};

async function ejecutar(accion: AccionDeIdea, idea: Idea, nota: string) {
  switch (accion) {
    case 'enviar_al_cliente':
      return enviarIdeaAlCliente(idea.id);
    case 'pedir_correccion_interna':
      return pedirCorreccionInterna(idea.id, nota);
    case 'aprobar':
      return aprobarIdea(idea.id);
    case 'pedir_correccion_cliente':
      return pedirCorreccionDelCliente(idea.id, nota);
    case 'reenviar':
      return reenviarIdea(idea.id);
    case 'descartar':
      return descartarIdea(idea.id, nota);
    case 'convertir':
      router.push(`/piezas/nueva?idea=${idea.id}`);
      return;
  }
}
```

Y las reglas de comportamiento, que tampoco son negociables:

- Los botones de cada idea salen de `accionesDisponibles(idea.status, profile.role, marcasDondeEsContacto.includes(idea.client_id))`. Nada de decidir a mano qué mostrar.
- Una acción de `ACCIONES_CON_NOTA` abre un campo de texto y **el botón de confirmar queda deshabilitado mientras `nota.trim()` esté vacío**. La base también lo rechaza; esto evita el viaje.
- Si una acción falla, el mensaje del error se muestra **en la tarjeta de esa idea**, no al pie de la página: con varias ideas en pantalla, un error al pie no dice a cuál corresponde.
- Tras una acción con éxito, `router.refresh()`.

- [ ] **Step 5: Agregar el enlace a la navegación**

En `components/AppShell.tsx`, en `AGENCY_NAV`, después de Pendientes:

```typescript
  { href: '/ideas', label: 'Ideas' },
```

- [ ] **Step 6: Correr el gate completo**

Run: `npm run typecheck && npm run lint && npm run test && npm run test:integration && npm run build`
Expected: todo en verde. Esta tarea no agrega pruebas automatizadas: el proyecto no tiene pruebas de componente y eso es un no-objetivo explícito. Dilo así en el reporte en vez de fabricar evidencia.

- [ ] **Step 7: Commit**

```bash
git add app/actions-ideas.ts app/ideas/page.tsx components/IdeasBoard.tsx components/NuevaIdeaForm.tsx components/AppShell.tsx
git commit -m "feat: add the ideas section for the agency"
```

---

## Task 4: La vista del cliente y su entrada en Pendientes

**Files:**
- Modify: `components/AppShell.tsx` (agregar `{ href: '/ideas', label: 'Ideas' }` a `CLIENT_NAV`)
- Modify: `app/pendientes/page.tsx`
- Modify: `components/PendingList.tsx`

**Interfaces:**
- Consumes: la página `/ideas` y `IdeasBoard` de la Tarea 3; el tipo `Idea` de la Tarea 1.
- Produces: nada que consuman otras tareas.

- [ ] **Step 1: Agregar Ideas a la navegación del cliente**

En `components/AppShell.tsx`, en `CLIENT_NAV`, después de Pendientes:

```typescript
  { href: '/ideas', label: 'Ideas' },
```

La página ya funciona para el cliente sin cambios: la política de lectura le entrega solo lo que puede ver, y `accionesDisponibles` le da solo sus botones.

- [ ] **Step 2: Cargar las ideas pendientes en la página de pendientes**

En `app/pendientes/page.tsx`, agregar una consulta en paralelo a la que ya existe:

```tsx
  const [{ data: pieces }, { data: ideas }] = await Promise.all([
    supabase
      .from('content_pieces')
      .select('*, clients(id,name,brand_name,timezone), assignee:profiles!content_pieces_assignee_id_fkey(id,full_name)')
      .in('status', ['pendiente_revision', 'cambios_solicitados', 'aprobado', 'programado'])
      .order('scheduled_at'),
    supabase
      .from('ideas')
      .select('*, clients(id,name,brand_name)')
      .in('status', ['pendiente_cliente', 'correccion_cliente'])
      .order('created_at', { ascending: false }),
  ]);
```

Y pasarlas: `<PendingList profile={profile} pieces={...} ideas={(ideas ?? []) as Idea[]} />`.

- [ ] **Step 3: Mostrarlas en `components/PendingList.tsx`**

Agregar el prop `ideas: Idea[]` y, **arriba de la lista de piezas**, una sección "Ideas esperando tu revisión" con las que están en `pendiente_cliente`, cada una enlazando a `/ideas`.

Va arriba porque una idea sin resolver bloquea producción: mientras el cliente no responda, el equipo no sabe si grabar.

Si no hay ideas pendientes, la sección no se renderiza — no un bloque vacío.

- [ ] **Step 4: Correr el gate completo**

Run: `npm run typecheck && npm run lint && npm run test && npm run test:integration && npm run build`
Expected: todo en verde.

- [ ] **Step 5: Commit**

```bash
git add components/AppShell.tsx app/pendientes/page.tsx components/PendingList.tsx
git commit -m "feat: show pending ideas to the client"
```

---

## Task 5: Convertir una idea aprobada en pieza

**Files:**
- Modify: `app/piezas/nueva/page.tsx`
- Modify: `components/ContentPieceForm.tsx`
- Modify: `app/actions-ideas.ts` (agregar `vincularIdeaAPieza`)
- Modify: `supabase/migrations/0005_ideas.sql` (agregar `convert_idea_to_piece`)
- Modify: `tests/integration/ideas-transiciones.test.ts` (agregar el caso)

**Interfaces:**
- Consumes: `ideas.content_piece_id` de la Tarea 1; el formulario de pieza existente.
- Produces: función `convert_idea_to_piece(p_idea_id uuid, p_content_piece_id uuid)`; Server Action `vincularIdeaAPieza(ideaId, pieceId)`.

- [ ] **Step 1: Escribir la prueba de integración que falla**

Agregar a `tests/integration/ideas-transiciones.test.ts`:

```typescript
  it('convertir vincula la pieza y deja la idea en convertida', async () => {
    const idea = await crearIdea('Lista para producir', 'aprobada');
    const { data: pieza } = await admin
      .from('content_pieces')
      .insert({
        client_id: ids.marca,
        platform: 'instagram',
        format: 'reel',
        title: 'Pieza desde idea',
        scheduled_at: new Date().toISOString(),
        created_by: ids.agencia,
      })
      .select('id')
      .single();

    const agencia = await sesionDe(correos.agencia);
    const { error } = await agencia.rpc('convert_idea_to_piece', {
      p_idea_id: idea,
      p_content_piece_id: pieza!.id,
    });
    expect(error).toBeNull();

    const { data } = await admin
      .from('ideas')
      .select('status, content_piece_id')
      .eq('id', idea)
      .single();

    expect(data!.status).toBe('convertida');
    expect(data!.content_piece_id).toBe(pieza!.id);
  });

  it('solo una idea aprobada se puede convertir', async () => {
    const idea = await crearIdea('Todavia en propuesta', 'propuesta');
    const { data: pieza } = await admin
      .from('content_pieces')
      .insert({
        client_id: ids.marca,
        platform: 'instagram',
        format: 'post',
        title: 'Pieza suelta',
        scheduled_at: new Date().toISOString(),
        created_by: ids.agencia,
      })
      .select('id')
      .single();

    const agencia = await sesionDe(correos.agencia);
    const { error } = await agencia.rpc('convert_idea_to_piece', {
      p_idea_id: idea,
      p_content_piece_id: pieza!.id,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/aprobada/i);
  });
```

- [ ] **Step 2: Correr la prueba y verificar que falla**

Run: `npm run test:integration`
Expected: FAIL, la función `convert_idea_to_piece` no existe.

- [ ] **Step 3: Escribir la función**

Agregar al final de `supabase/migrations/0005_ideas.sql`:

```sql
-- La pieza se crea por el camino normal y despues se vincula. Asi la creacion sigue teniendo un
-- solo lugar donde vive su validacion, y esta funcion solo se ocupa del vinculo y del estado.
create or replace function convert_idea_to_piece(p_idea_id uuid, p_content_piece_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_old idea_status; v_client_idea uuid; v_client_pieza uuid;
begin
  select status, client_id into v_old, v_client_idea from ideas where id = p_idea_id;
  if v_client_idea is null then raise exception 'La idea no existe'; end if;
  if not is_agency() then raise exception 'Solo la agencia puede convertir una idea'; end if;
  if v_old <> 'aprobada' then raise exception 'Solo una idea aprobada se puede convertir'; end if;

  select client_id into v_client_pieza from content_pieces where id = p_content_piece_id;
  if v_client_pieza is null then raise exception 'La pieza no existe'; end if;
  if v_client_pieza <> v_client_idea then
    raise exception 'La pieza pertenece a otra marca que la idea';
  end if;

  update ideas
    set status = 'convertida', content_piece_id = p_content_piece_id
    where id = p_idea_id;
  insert into idea_status_history (idea_id, from_status, to_status, changed_by)
    values (p_idea_id, v_old, 'convertida', auth.uid());
end;
$$;
```

La comprobación de que ambas pertenecen a la misma marca no es adorno: sin ella, una idea de una marca podría quedar vinculada a la pieza de otra, y el registro de "de dónde salió esta pieza" mentiría.

- [ ] **Step 4: Correr las pruebas de integración**

Run: `npm run test:integration`
Expected: PASS, los dos casos nuevos.

- [ ] **Step 5: Agregar la Server Action**

En `app/actions-ideas.ts`:

```typescript
export async function vincularIdeaAPieza(ideaId: string, pieceId: string) {
  await requireAgency();
  await llamar('convert_idea_to_piece', { p_idea_id: ideaId, p_content_piece_id: pieceId });
}
```

- [ ] **Step 6: Prellenar el formulario desde la idea**

En `app/piezas/nueva/page.tsx`, leer `searchParams.idea`. Si viene, cargar esa idea y pasarla al formulario como valores por defecto: marca, título, descripción como copy, y las sugerencias de plataforma y formato si las tiene.

En `components/ContentPieceForm.tsx`, aceptar un prop opcional `ideaOrigen?: { id: string; client_id: string; title: string; description: string; suggested_platform: PlatformType | null; suggested_format: ContentFormat | null }`, usarlo para los valores iniciales, y **después de crear la pieza**, llamar a `vincularIdeaAPieza(ideaOrigen.id, id)` antes de navegar.

Si el vínculo falla, la pieza ya existe: muestra el error y ofrece ir a la pieza, con el mismo patrón que ya usa el formulario cuando falla la subida de un archivo. La pieza no se borra — hacer reescribir el formulario por un fallo de vínculo sería peor.

- [ ] **Step 7: Correr el gate completo**

Run: `npm run typecheck && npm run lint && npm run test && npm run test:integration && npm run build`
Expected: todo en verde.

- [ ] **Step 8: Verificación manual**

Con `npm run dev` y dos sesiones (agencia y contacto de cliente):

1. Crear una idea como agencia. Confirmar que el cliente **no la ve**.
2. Enviarla al cliente. Confirmar que ahora sí la ve, y que le aparece en Pendientes.
3. Como cliente, pedir corrección con una nota. Confirmar que el intento sin nota no deja enviar.
4. Como agencia, reenviarla. Confirmar que vuelve directo al cliente, **sin pasar por el filtro interno**.
5. Aprobar como cliente y convertir como agencia. Confirmar que la pieza queda vinculada y la idea en Convertida.

Anotar qué se pudo verificar y qué no. **No inventar resultados.**

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/0005_ideas.sql tests/integration/ideas-transiciones.test.ts app/actions-ideas.ts app/piezas/nueva/page.tsx components/ContentPieceForm.tsx
git commit -m "feat: convert an approved idea into a content piece"
```
