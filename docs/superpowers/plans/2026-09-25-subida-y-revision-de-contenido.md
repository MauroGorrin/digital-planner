# Subida y revisión de contenido — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la agencia pueda subir videos de hasta 200 MB con progreso real y que el cliente los revise reproduciéndolos en la ficha, sin descargarlos, con las versiones agrupadas por ronda de revisión.

**Architecture:** La subida sigue yendo directo del navegador a Supabase Storage (obligatorio: una función serverless de Vercel corta el cuerpo del request cerca de 4,5 MB). El progreso real se consigue pidiendo una URL firmada de subida y enviando el archivo con `XMLHttpRequest`, porque el `upload()` del SDK usa `fetch` y no emite eventos de progreso. El versionado son dos columnas aditivas en `attachments`, con la ronda asignada por un trigger de Postgres para que el navegador no pueda falsearla.

**Tech Stack:** Next.js 14 (App Router, Server Actions) · TypeScript 5.5 strict · Supabase (Postgres + Storage + RLS) · `@supabase/supabase-js` 2.x con `storage-js` 2.117.1 · Vitest 5 + jsdom · Tailwind 3.4

**Spec:** `docs/superpowers/specs/2026-09-25-subida-y-revision-de-contenido-design.md`

## Global Constraints

- Tope por archivo: **209715200** bytes (200 MB), idéntico en el bucket y en la validación del navegador.
- Tipos permitidos, exactamente estos ocho: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `video/mp4`, `video/quicktime`, `video/webm`, `application/pdf`.
- La subida nunca pasa por una Server Action ni por una ruta de la API: siempre navegador → Storage.
- `review_round` nunca se envía desde el cliente. Lo asigna el trigger; enviarlo es un error.
- Toda prueba unitaria mockea `@/lib/supabase/server` y `global.fetch`; solo `tests/integration/**` toca Postgres real. Ver `.claude/rules/tests.md`.
- Nunca editar una migración ya aplicada (`0001`, `0002`): los cambios van en `0003`.
- Los textos de interfaz van en español.
- Gate antes de dar por terminada cualquier tarea: `npm run typecheck && npm run lint && npm run test && npm run test:integration`.

---

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `supabase/migrations/0003_attachment_versions.sql` | Columnas de versionado, trigger de ronda, límites del bucket, corrección de la política de borrado | 1 |
| `types/database.ts` | Los dos campos nuevos en `Attachment` | 1 |
| `lib/attachments.ts` | Validación, agrupado por rondas, registro con compensación y subida con progreso. Sin React ni JSX, para poder probarlo aislado | 2, 3, 4 |
| `components/AttachmentUploader.tsx` | Interfaz: selección, progreso, previsualización, rondas, reemplazo | 4, 5, 6, 7 |
| `app/piezas/[id]/page.tsx` | Genera las URLs firmadas en el servidor | 5 |
| `tests/integration/attachment-versions.test.ts` | Trigger, restricción `unique` y política de borrado, contra Postgres real | 1 |
| `tests/unit/lib/attachments.test.ts` | Funciones de `lib/attachments.ts` | 2, 3 |

---

## Task 1: Migración de versionado, límites del bucket y política de borrado

**Files:**
- Create: `supabase/migrations/0003_attachment_versions.sql`
- Create: `tests/integration/attachment-versions.test.ts`
- Modify: `types/database.ts:117-126` (interfaz `Attachment`)

**Interfaces:**
- Consumes: el esquema de `0001_init.sql` — tablas `attachments`, `status_history`, `clients`, `client_contacts`, `content_pieces`; funciones `is_agency()`, `has_client_access(uuid)`.
- Produces: columnas `attachments.replaces_id uuid | null` y `attachments.review_round number`; trigger `attachments_set_round`; restricción `attachments_replaces_id_unique`.

- [ ] **Step 1: Escribir la prueba de integración que falla**

Crear `tests/integration/attachment-versions.test.ts`. Copia el encabezado de credenciales de `tests/integration/state-transitions.test.ts` (mismo patrón, mismas variables):

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
  agencia: `adj-agencia-${sufijo}@prueba.local`,
  ajeno: `adj-ajeno-${sufijo}@prueba.local`,
};

const ids = { agencia: '', ajeno: '', cliente: '', clienteAjeno: '', pieza: '' };

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

async function insertarAdjunto(nombre: string, replacesId: string | null = null) {
  const { data, error } = await admin
    .from('attachments')
    .insert({
      content_piece_id: ids.pieza,
      file_path: `${ids.cliente}/${ids.pieza}/${nombre}`,
      file_name: nombre,
      file_type: 'video/mp4',
      file_size: 1024,
      uploaded_by: ids.agencia,
      replaces_id: replacesId,
    })
    .select('id, review_round')
    .single();
  return { data, error };
}

beforeAll(async () => {
  ids.agencia = await crearUsuario(correos.agencia);
  ids.ajeno = await crearUsuario(correos.ajeno);
  await admin.from('profiles').update({ role: 'agency_admin' }).eq('id', ids.agencia);
  await admin.from('profiles').update({ role: 'agency_member' }).eq('id', ids.ajeno);

  const { data: cliente } = await admin
    .from('clients')
    .insert({ name: `Cliente adj ${sufijo}`, brand_name: 'Marca adj' })
    .select('id')
    .single();
  ids.cliente = cliente!.id;

  const { data: otro } = await admin
    .from('clients')
    .insert({ name: `Cliente ajeno adj ${sufijo}`, brand_name: 'Marca ajena' })
    .select('id')
    .single();
  ids.clienteAjeno = otro!.id;

  const { data: pieza } = await admin
    .from('content_pieces')
    .insert({
      client_id: ids.cliente,
      platform: 'instagram',
      format: 'reel',
      title: 'Pieza de adjuntos',
      copy_text: 'x',
      scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
    })
    .select('id')
    .single();
  ids.pieza = pieza!.id;
});

afterAll(async () => {
  if (ids.cliente) await admin.from('clients').delete().eq('id', ids.cliente);
  if (ids.clienteAjeno) await admin.from('clients').delete().eq('id', ids.clienteAjeno);
  for (const id of [ids.agencia, ids.ajeno]) {
    if (id) await admin.auth.admin.deleteUser(id);
  }
});

describe('versionado de adjuntos', () => {
  it('asigna la ronda 1 antes de cualquier solicitud de cambios', async () => {
    const { data, error } = await insertarAdjunto('v1.mp4');
    expect(error).toBeNull();
    expect(data!.review_round).toBe(1);
  });

  it('asigna la ronda 2 a lo subido despues de un cambios_solicitados', async () => {
    await admin.from('status_history').insert({
      content_piece_id: ids.pieza,
      from_status: 'pendiente_revision',
      to_status: 'cambios_solicitados',
      changed_by: ids.agencia,
    });

    const { data, error } = await insertarAdjunto('v2.mp4');
    expect(error).toBeNull();
    expect(data!.review_round).toBe(2);
  });

  it('ignora la ronda que mande el cliente y usa la que calcula la base', async () => {
    const { data, error } = await admin
      .from('attachments')
      .insert({
        content_piece_id: ids.pieza,
        file_path: `${ids.cliente}/${ids.pieza}/mentira.mp4`,
        file_name: 'mentira.mp4',
        file_type: 'video/mp4',
        file_size: 1024,
        uploaded_by: ids.agencia,
        review_round: 99,
      })
      .select('review_round')
      .single();
    expect(error).toBeNull();
    expect(data!.review_round).toBe(2);
  });

  it('impide que dos adjuntos reemplacen al mismo padre', async () => {
    const { data: padre } = await insertarAdjunto('padre.mp4');
    const primero = await insertarAdjunto('reemplazo-a.mp4', padre!.id);
    expect(primero.error).toBeNull();

    const segundo = await insertarAdjunto('reemplazo-b.mp4', padre!.id);
    expect(segundo.error).not.toBeNull();
  });

  it('permite varios adjuntos originales sin reemplazo', async () => {
    const a = await insertarAdjunto('suelto-a.mp4');
    const b = await insertarAdjunto('suelto-b.mp4');
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
  });
});

describe('politica de borrado en storage', () => {
  it('rechaza a un miembro de agencia sin acceso a esa marca', async () => {
    const ajeno = await sesionDe(correos.ajeno);
    const { error } = await ajeno.storage
      .from('attachments')
      .remove([`${ids.cliente}/${ids.pieza}/inexistente.mp4`]);
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Correr la prueba y verificar que falla**

Run: `npm run test:integration`
Expected: FAIL. Los casos de ronda fallan porque la columna `review_round` no existe todavía (error de Postgres `column "review_round" does not exist`).

- [ ] **Step 3: Escribir la migración**

Crear `supabase/migrations/0003_attachment_versions.sql`:

```sql
-- Versionado de adjuntos, limites del bucket y correccion de la politica de borrado.
-- Aditiva: las filas existentes quedan validas con los valores por defecto.

alter table attachments
  add column replaces_id uuid references attachments (id) on delete set null,
  add column review_round int not null default 1;

-- Postgres admite multiples NULL en un unique, y eso es lo buscado: muchos adjuntos
-- originales (replaces_id is null) conviven sin problema. La restriccion solo impide
-- que dos archivos declaren el mismo padre y la cadena se bifurque.
alter table attachments
  add constraint attachments_replaces_id_unique unique (replaces_id);

create index idx_attachments_piece_round on attachments (content_piece_id, review_round);

-- La ronda la decide la base, nunca el navegador: sobrescribe lo que llegue del cliente.
create or replace function set_attachment_round()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select count(*) + 1 into new.review_round
  from status_history
  where content_piece_id = new.content_piece_id
    and to_status = 'cambios_solicitados';
  return new;
end;
$$;

create trigger attachments_set_round
  before insert on attachments
  for each row execute function set_attachment_round();

-- Limites explicitos del bucket. Sin esto hereda el default del proyecto (50 MB).
update storage.buckets
set file_size_limit = 209715200,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/quicktime', 'video/webm', 'application/pdf'
    ]
where id = 'attachments';

-- Correccion: el borrado tambien debe verificar la marca, igual que lectura y escritura.
drop policy if exists "attachments_delete" on storage.objects;
create policy "attachments_delete" on storage.objects for delete
  using (
    bucket_id = 'attachments'
    and is_agency()
    and has_client_access((storage.foldername(name))[1]::uuid)
  );
```

- [ ] **Step 4: Correr la prueba y verificar que pasa**

Run: `npm run test:integration`
Expected: PASS, 3 archivos de prueba, 9 pruebas (las 3 de transiciones más las 6 nuevas), 0 fallidas.

El script `test:integration` hace `supabase db reset`, que reaplica las tres migraciones desde cero, así que no hace falta aplicar la migración a mano.

- [ ] **Step 5: Actualizar el tipo**

En `types/database.ts`, dentro de `interface Attachment` (línea 117), agregar los dos campos después de `uploaded_by`:

```typescript
export interface Attachment {
  id: string;
  content_piece_id: string;
  file_path: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  uploaded_by: string | null;
  replaces_id: string | null;
  review_round: number;
  created_at: string;
}
```

- [ ] **Step 6: Correr el gate completo**

Run: `npm run typecheck && npm run lint && npm run test && npm run test:integration`
Expected: todo en verde.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0003_attachment_versions.sql tests/integration/attachment-versions.test.ts types/database.ts
git commit -m "feat: add attachment versioning, bucket limits and cross-brand delete guard"
```

---

## Task 2: Validación y agrupado por rondas

**Files:**
- Create: `lib/attachments.ts`
- Create: `tests/unit/lib/attachments.test.ts`

**Interfaces:**
- Consumes: el tipo `Attachment` de la Tarea 1, con `replaces_id` y `review_round`.
- Produces: `TAMANO_MAXIMO_BYTES: number`, `TIPOS_PERMITIDOS: readonly string[]`, `formatearBytes(bytes: number): string`, `validarArchivo(file: { name: string; type: string; size: number }): string | null`, `agruparPorRonda(attachments: Attachment[]): RondaDeRevision[]`, y los tipos `AdjuntoConHistorial` y `RondaDeRevision`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/unit/lib/attachments.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import {
  TAMANO_MAXIMO_BYTES,
  agruparPorRonda,
  formatearBytes,
  validarArchivo,
} from '@/lib/attachments';
import type { Attachment } from '@/types/database';

function adjunto(parcial: Partial<Attachment> & { id: string }): Attachment {
  return {
    content_piece_id: 'pieza-1',
    file_path: `ruta/${parcial.id}`,
    file_name: `${parcial.id}.mp4`,
    file_type: 'video/mp4',
    file_size: 1024,
    uploaded_by: 'usuario-1',
    replaces_id: null,
    review_round: 1,
    created_at: '2026-09-25T10:00:00.000Z',
    ...parcial,
  };
}

describe('validarArchivo', () => {
  it('acepta un video mp4 dentro del limite', () => {
    expect(validarArchivo({ name: 'reel.mp4', type: 'video/mp4', size: 1_000_000 })).toBeNull();
  });

  it('acepta un .mov de iPhone', () => {
    expect(validarArchivo({ name: 'reel.mov', type: 'video/quicktime', size: 1_000_000 })).toBeNull();
  });

  it('rechaza por tipo no permitido nombrando el archivo', () => {
    const mensaje = validarArchivo({ name: 'malo.zip', type: 'application/zip', size: 10 });
    expect(mensaje).toContain('malo.zip');
    expect(mensaje).toContain('no permitido');
  });

  it('rechaza por tamano indicando el peso real y el maximo', () => {
    const mensaje = validarArchivo({
      name: 'enorme.mp4',
      type: 'video/mp4',
      size: TAMANO_MAXIMO_BYTES + 1,
    });
    expect(mensaje).toContain('enorme.mp4');
    expect(mensaje).toContain('200');
  });
});

describe('formatearBytes', () => {
  it('usa la unidad legible mas cercana', () => {
    expect(formatearBytes(1024)).toBe('1.0 KB');
    expect(formatearBytes(209_715_200)).toBe('200.0 MB');
  });
});

describe('agruparPorRonda', () => {
  it('devuelve las rondas de la mas reciente a la mas vieja', () => {
    const rondas = agruparPorRonda([
      adjunto({ id: 'a', review_round: 1 }),
      adjunto({ id: 'b', review_round: 2 }),
    ]);
    expect(rondas.map((r) => r.ronda)).toEqual([2, 1]);
  });

  it('marca como vigente al que nadie reemplaza y pliega la cadena', () => {
    const rondas = agruparPorRonda([
      adjunto({ id: 'v1' }),
      adjunto({ id: 'v2', replaces_id: 'v1' }),
      adjunto({ id: 'v3', replaces_id: 'v2' }),
    ]);

    expect(rondas).toHaveLength(1);
    expect(rondas[0].adjuntos).toHaveLength(1);
    expect(rondas[0].adjuntos[0].vigente.id).toBe('v3');
    expect(rondas[0].adjuntos[0].reemplazados.map((a) => a.id)).toEqual(['v2', 'v1']);
  });

  it('mantiene como vigentes los adjuntos independientes de un carrusel', () => {
    const rondas = agruparPorRonda([
      adjunto({ id: 'img1' }),
      adjunto({ id: 'img2' }),
      adjunto({ id: 'img3' }),
    ]);
    expect(rondas[0].adjuntos.map((a) => a.vigente.id)).toEqual(['img1', 'img2', 'img3']);
  });

  it('no se cuelga si la cadena de reemplazos tuviera un ciclo', () => {
    const rondas = agruparPorRonda([
      adjunto({ id: 'x', replaces_id: 'y' }),
      adjunto({ id: 'y', replaces_id: 'x' }),
    ]);
    expect(rondas).toHaveLength(0);
  });

  it('devuelve una lista vacia si no hay adjuntos', () => {
    expect(agruparPorRonda([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/unit/lib/attachments.test.ts`
Expected: FAIL con `Cannot find module '@/lib/attachments'`.

- [ ] **Step 3: Escribir la implementación**

Crear `lib/attachments.ts`:

```typescript
import type { Attachment } from '@/types/database';

/** Igual al file_size_limit del bucket en 0003_attachment_versions.sql. */
export const TAMANO_MAXIMO_BYTES = 209_715_200;

/** Igual al allowed_mime_types del bucket en 0003_attachment_versions.sql. */
export const TIPOS_PERMITIDOS = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'application/pdf',
] as const;

export function formatearBytes(bytes: number): string {
  const unidades = ['B', 'KB', 'MB', 'GB'];
  let valor = bytes;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i++;
  }
  return `${valor.toFixed(1)} ${unidades[i]}`;
}

/** Devuelve null si el archivo es aceptable, o el mensaje a mostrar si no lo es. */
export function validarArchivo(file: { name: string; type: string; size: number }): string | null {
  if (!TIPOS_PERMITIDOS.includes(file.type as (typeof TIPOS_PERMITIDOS)[number])) {
    return `"${file.name}" es de un tipo no permitido (${file.type || 'desconocido'}). Se aceptan imágenes, video MP4, MOV o WebM, y PDF.`;
  }
  if (file.size > TAMANO_MAXIMO_BYTES) {
    return `"${file.name}" pesa ${formatearBytes(file.size)} y el máximo es ${formatearBytes(TAMANO_MAXIMO_BYTES)}.`;
  }
  return null;
}

export interface AdjuntoConHistorial {
  vigente: Attachment;
  /** Versiones anteriores, de la más reciente a la más antigua. */
  reemplazados: Attachment[];
}

export interface RondaDeRevision {
  ronda: number;
  adjuntos: AdjuntoConHistorial[];
}

/**
 * Agrupa los adjuntos por ronda de revisión, de la más reciente a la más vieja.
 * Un adjunto es vigente si ningún otro lo reemplaza; no se persiste ese estado
 * porque un segundo estado guardado se desincroniza.
 */
export function agruparPorRonda(attachments: Attachment[]): RondaDeRevision[] {
  const reemplazadoPor = new Map<string, Attachment>();
  for (const a of attachments) {
    if (a.replaces_id) reemplazadoPor.set(a.replaces_id, a);
  }

  const porId = new Map(attachments.map((a) => [a.id, a]));
  const vigentes = attachments.filter((a) => !reemplazadoPor.has(a.id));

  const rondas = new Map<number, AdjuntoConHistorial[]>();
  for (const vigente of vigentes) {
    const reemplazados: Attachment[] = [];
    const vistos = new Set<string>([vigente.id]);
    let cursor = vigente.replaces_id;
    while (cursor && !vistos.has(cursor)) {
      const anterior = porId.get(cursor);
      if (!anterior) break;
      reemplazados.push(anterior);
      vistos.add(anterior.id);
      cursor = anterior.replaces_id;
    }
    const lista = rondas.get(vigente.review_round) ?? [];
    lista.push({ vigente, reemplazados });
    rondas.set(vigente.review_round, lista);
  }

  return [...rondas.entries()]
    .map(([ronda, adjuntos]) => ({ ronda, adjuntos }))
    .sort((a, b) => b.ronda - a.ronda);
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run tests/unit/lib/attachments.test.ts`
Expected: PASS, 11 pruebas.

- [ ] **Step 5: Commit**

```bash
git add lib/attachments.ts tests/unit/lib/attachments.test.ts
git commit -m "feat: add attachment validation and round grouping"
```

---

## Task 3: Registro con compensación ante fallo

Si el archivo sube al bucket pero el insert en la base falla, hoy queda un objeto huérfano que nadie ve ni limpia. Esta función lo compensa, y recibe el cliente de Supabase por parámetro justamente para poder probar ese camino sin un navegador.

**Files:**
- Modify: `lib/attachments.ts` (agregar al final)
- Modify: `tests/unit/lib/attachments.test.ts` (agregar al final)

**Interfaces:**
- Consumes: nada de tareas anteriores más allá del módulo donde vive.
- Produces: `registrarAdjunto(opciones: OpcionesRegistro): Promise<void>` y los tipos `ClienteAdjuntos` y `OpcionesRegistro`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Agregar a `tests/unit/lib/attachments.test.ts` (y añadir `registrarAdjunto` a la lista de imports desde `@/lib/attachments`, más `vi` a los imports de `vitest`):

```typescript
describe('registrarAdjunto', () => {
  function clienteFalso(errorDeInsert: { message: string } | null) {
    const insert = vi.fn().mockResolvedValue({ error: errorDeInsert });
    const remove = vi.fn().mockResolvedValue({ error: null });
    return {
      cliente: {
        from: () => ({ insert }),
        storage: { from: () => ({ remove }) },
      },
      insert,
      remove,
    };
  }

  const base = {
    contentPieceId: 'pieza-1',
    filePath: 'cliente-1/pieza-1/reel.mp4',
    fileName: 'reel.mp4',
    fileType: 'video/mp4',
    fileSize: 2048,
    uploadedBy: 'usuario-1',
  };

  it('inserta la fila sin mandar review_round', async () => {
    const { cliente, insert, remove } = clienteFalso(null);

    await registrarAdjunto({ supabase: cliente, ...base });

    expect(insert).toHaveBeenCalledTimes(1);
    const fila = insert.mock.calls[0][0];
    expect(fila).toMatchObject({
      content_piece_id: 'pieza-1',
      file_path: 'cliente-1/pieza-1/reel.mp4',
      replaces_id: null,
    });
    expect(fila).not.toHaveProperty('review_round');
    expect(remove).not.toHaveBeenCalled();
  });

  it('propaga replaces_id cuando es una nueva version', async () => {
    const { cliente, insert } = clienteFalso(null);

    await registrarAdjunto({ supabase: cliente, ...base, replacesId: 'adjunto-viejo' });

    expect(insert.mock.calls[0][0].replaces_id).toBe('adjunto-viejo');
  });

  it('borra el objeto subido si falla el insert y avisa del error', async () => {
    const { cliente, remove } = clienteFalso({ message: 'violacion de RLS' });

    await expect(registrarAdjunto({ supabase: cliente, ...base })).rejects.toThrow(
      /violacion de RLS/
    );
    expect(remove).toHaveBeenCalledWith(['cliente-1/pieza-1/reel.mp4']);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/unit/lib/attachments.test.ts`
Expected: FAIL — `registrarAdjunto` no está exportada.

- [ ] **Step 3: Escribir la implementación**

Agregar al final de `lib/attachments.ts`:

```typescript
/**
 * La parte del cliente de Supabase que esta función usa. Se declara acá, en vez de depender
 * del tipo completo del SDK, para poder pasarle un doble en las pruebas.
 */
export interface ClienteAdjuntos {
  from(tabla: string): {
    // PromiseLike, no Promise: el builder de postgrest-js implementa PromiseLike y no tiene
    // catch ni finally, asi que declarar Promise aca haria que el cliente real de Supabase
    // no sea asignable a este tipo y el typecheck falle. Verificado contra postgrest-js
    // instalado. PromiseLike acepta tanto el builder real como el doble de las pruebas.
    insert(fila: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
  };
  storage: {
    from(bucket: string): {
      remove(rutas: string[]): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

export interface OpcionesRegistro {
  supabase: ClienteAdjuntos;
  contentPieceId: string;
  filePath: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedBy: string | null;
  replacesId?: string | null;
}

/**
 * Registra en la base un archivo ya subido al bucket. Si el insert falla, borra el objeto
 * para no dejar un huérfano en storage. Nunca envía review_round: lo asigna el trigger.
 */
export async function registrarAdjunto(opciones: OpcionesRegistro): Promise<void> {
  const { supabase, filePath } = opciones;

  const { error } = await supabase.from('attachments').insert({
    content_piece_id: opciones.contentPieceId,
    file_path: filePath,
    file_name: opciones.fileName,
    file_type: opciones.fileType,
    file_size: opciones.fileSize,
    uploaded_by: opciones.uploadedBy,
    replaces_id: opciones.replacesId ?? null,
  });

  if (error) {
    await supabase.storage.from('attachments').remove([filePath]);
    throw new Error(`No se pudo registrar el archivo: ${error.message}`);
  }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run tests/unit/lib/attachments.test.ts`
Expected: PASS, 14 pruebas.

- [ ] **Step 5: Commit**

```bash
git add lib/attachments.ts tests/unit/lib/attachments.test.ts
git commit -m "feat: register attachments with orphan compensation"
```

---

## Task 4: Subida con URL firmada y progreso real

**Files:**
- Modify: `lib/attachments.ts` (agregar `subirConProgreso`)
- Modify: `components/AttachmentUploader.tsx` (reescribir `handleUpload` y el estado)

**Interfaces:**
- Consumes: `validarArchivo` y `registrarAdjunto` de las Tareas 2 y 3.
- Produces: `subirConProgreso(opciones: { signedUrl: string; file: File; onProgress: (pct: number) => void }): Promise<void>`.

- [ ] **Step 1: Confirmar la forma de la URL firmada**

El SDK no documenta el verbo exacto en sus tipos. Confirmarlo una vez antes de escribir el cliente, en vez de asumirlo. Con la Supabase local levantada (`npx supabase start`), correr:

```bash
node -e "
const {createClient}=require('@supabase/supabase-js');const fs=require('fs');
for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const i=l.indexOf('=');if(i>0)process.env[l.slice(0,i).trim()]=l.slice(i+1).trim();}
const c=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
c.storage.from('attachments').createSignedUploadUrl('prueba/ejemplo.mp4').then(r=>console.log(JSON.stringify(r.data,null,2)));
"
```

Expected: un objeto con `signedUrl`, `token` y `path`. Anotar si `signedUrl` ya lleva el token en la query (en ese caso el `PUT` no necesita cabecera de autorización) o no (entonces hay que mandar `authorization: Bearer <token>`). El paso 3 usa la variante que corresponda.

- [ ] **Step 2: Agregar `subirConProgreso` a `lib/attachments.ts`**

```typescript
/**
 * Sube un archivo a una URL firmada con XMLHttpRequest, que es la única forma de obtener
 * progreso real: el upload() del SDK usa fetch, que no emite eventos de progreso.
 */
export function subirConProgreso(opciones: {
  signedUrl: string;
  file: File;
  onProgress: (porcentaje: number) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', opciones.signedUrl);
    xhr.setRequestHeader('content-type', opciones.file.type);

    xhr.upload.addEventListener('progress', (evento) => {
      if (evento.lengthComputable) {
        opciones.onProgress(Math.round((evento.loaded / evento.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`La subida falló (HTTP ${xhr.status}). Volvé a intentarlo.`));
    });
    xhr.addEventListener('error', () =>
      reject(new Error('Se cortó la conexión durante la subida. Volvé a intentarlo.'))
    );
    xhr.addEventListener('abort', () => reject(new Error('Subida cancelada.')));

    xhr.send(opciones.file);
  });
}
```

Si el paso 1 mostró que el token no viaja en la URL, agregar antes de `xhr.send`:
`xhr.setRequestHeader('authorization', \`Bearer ${token}\`);` y sumar `token: string` a las opciones.

- [ ] **Step 3: Reescribir la subida en `components/AttachmentUploader.tsx`**

Reemplazar el estado `uploading` y la función `handleUpload` por lo siguiente. Mantener el resto del componente como está; el render se cambia en las Tareas 5 a 7.

```typescript
'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { registrarAdjunto, subirConProgreso, validarArchivo } from '@/lib/attachments';
import type { Attachment, Client, ContentPiece } from '@/types/database';

interface ProgresoDeArchivo {
  nombre: string;
  porcentaje: number;
}

// dentro del componente:
const router = useRouter();
const [progreso, setProgreso] = useState<ProgresoDeArchivo | null>(null);
const [error, setError] = useState<string | null>(null);

async function handleUpload(files: FileList | null, replacesId: string | null = null) {
  if (!files || files.length === 0) return;
  setError(null);

  const seleccionados = Array.from(files);
  for (const file of seleccionados) {
    const problema = validarArchivo(file);
    if (problema) {
      setError(problema);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
  }

  try {
    // De a uno: varios videos en paralelo se estorban y ninguno termina.
    for (const file of seleccionados) {
      setProgreso({ nombre: file.name, porcentaje: 0 });

      const path = `${piece.client_id}/${piece.id}/${Date.now()}_${file.name.replace(/[^\w.\-]/g, '_')}`;

      const { data: firmada, error: errorFirma } = await supabase.storage
        .from('attachments')
        .createSignedUploadUrl(path);
      if (errorFirma || !firmada) {
        throw new Error(errorFirma?.message ?? 'No se pudo preparar la subida.');
      }

      await subirConProgreso({
        signedUrl: firmada.signedUrl,
        file,
        onProgress: (porcentaje) => setProgreso({ nombre: file.name, porcentaje }),
      });

      const {
        data: { user },
      } = await supabase.auth.getUser();

      await registrarAdjunto({
        supabase,
        contentPieceId: piece.id,
        filePath: path,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        uploadedBy: user?.id ?? null,
        replacesId,
      });
    }
    router.refresh();
  } catch (err) {
    setError(err instanceof Error ? err.message : 'No se pudo subir el archivo.');
  } finally {
    setProgreso(null);
    if (inputRef.current) inputRef.current.value = '';
  }
}
```

Y en el render, reemplazar `{uploading && <p …>Subiendo…</p>}` por la barra real:

```tsx
{progreso && (
  <div className="mt-2">
    <p className="text-xs text-slate-500">
      Subiendo {progreso.nombre} — {progreso.porcentaje}%
    </p>
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full bg-brand-600 transition-all"
        style={{ width: `${progreso.porcentaje}%` }}
      />
    </div>
  </div>
)}
```

También borrar el `deleteAttachment(...).then(() => window.location.reload())` y dejar
`deleteAttachment(a.id, piece.id).then(() => router.refresh())`.

- [ ] **Step 4: Verificar el gate**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: verde. Las pruebas unitarias existentes no cambian.

- [ ] **Step 5: Verificación manual**

Con `npm run dev` y el seed cargado (`node scripts/seed-demo.mjs`), entrar como `agencia@demo.local`, abrir una pieza y:
1. Subir un archivo `.zip` → se rechaza antes de transferir, con el nombre en el mensaje.
2. Subir un video de más de 200 MB → se rechaza indicando peso real y máximo.
3. Subir un video válido de al menos 20 MB → la barra avanza progresivamente, no salta de 0 a 100.

- [ ] **Step 6: Commit**

```bash
git add lib/attachments.ts components/AttachmentUploader.tsx
git commit -m "feat: upload with signed URL and real progress"
```

---

## Task 5: URLs firmadas en el servidor y reproducción inline de video

**Files:**
- Modify: `app/piezas/[id]/page.tsx:20-45`
- Modify: `components/ContentPieceDetail.tsx:264`
- Modify: `components/AttachmentUploader.tsx` (quitar el `useEffect` de URLs, recibirlas por props)

**Interfaces:**
- Consumes: `agruparPorRonda` de la Tarea 2 (se usa en la Tarea 6; acá solo se preparan las URLs).
- Produces: el prop `urls: Record<string, string>` que `AttachmentUploader` recibe ya resuelto.

- [ ] **Step 1: Generar las URLs en el servidor**

En `app/piezas/[id]/page.tsx`, después del `Promise.all` que carga adjuntos (línea 20), agregar:

```typescript
const listaAdjuntos = (attachments ?? []) as Attachment[];

const urlsFirmadas: Record<string, string> = {};
if (listaAdjuntos.length > 0) {
  const { data: firmadas } = await supabase.storage
    .from('attachments')
    .createSignedUrls(
      listaAdjuntos.map((a) => a.file_path),
      3600
    );
  for (const [i, firmada] of (firmadas ?? []).entries()) {
    if (firmada.signedUrl) urlsFirmadas[listaAdjuntos[i].id] = firmada.signedUrl;
  }
}
```

Y pasarlas al componente, reemplazando la línea 41:

```tsx
attachments={listaAdjuntos}
urls={urlsFirmadas}
```

- [ ] **Step 2: Pasar el prop a través de `ContentPieceDetail`**

En `components/ContentPieceDetail.tsx`, agregar `urls: Record<string, string>` a las props del componente y pasarlo en la línea 264:

```tsx
<AttachmentUploader piece={piece} attachments={attachments} urls={urls} canManage={isAgency} />
```

- [ ] **Step 3: Consumir las URLs y reproducir video en `AttachmentUploader.tsx`**

Borrar el `useEffect` que llamaba a `createSignedUrl` y el estado `urls`; ahora llegan por props. Reemplazar el bloque de previsualización por:

```tsx
{a.file_type?.startsWith('image/') && urls[a.id] && (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={urls[a.id]} alt={a.file_name} className="mt-1 h-20 rounded-md object-cover" />
)}

{a.file_type?.startsWith('video/') && urls[a.id] && (
  <video
    controls
    preload="metadata"
    className="mt-1 max-h-64 w-full rounded-md bg-black"
    onError={(e) => e.currentTarget.classList.add('hidden')}
  >
    <source src={urls[a.id]} type={a.file_type} />
    Tu navegador no puede reproducir este archivo. Descargalo para verlo.
  </video>
)}
```

`preload="metadata"` es deliberado: carga solo la carátula y la duración. Sin eso, abrir una ficha con tres reels le descarga medio giga a alguien que quizá solo quería leer el copy.

- [ ] **Step 4: Verificar el gate**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: verde.

- [ ] **Step 5: Verificación manual**

Entrar como `cliente@demo.local` a una pieza con video adjunto:
1. El video aparece con controles, sin descargarse entero: en la pestaña Red del navegador, la descarga grande solo empieza al pulsar play.
2. Las imágenes siguen mostrándose como antes.
3. Recargar la página no produce un parpadeo con previsualizaciones vacías.

- [ ] **Step 6: Commit**

```bash
git add app/piezas/\[id\]/page.tsx components/ContentPieceDetail.tsx components/AttachmentUploader.tsx
git commit -m "feat: sign attachment URLs on the server and play video inline"
```

---

## Task 6: Agrupado por rondas en la interfaz

**Files:**
- Modify: `components/AttachmentUploader.tsx` (el listado)

**Interfaces:**
- Consumes: `agruparPorRonda`, `AdjuntoConHistorial` y `RondaDeRevision` de la Tarea 2; el prop `urls` de la Tarea 5.
- Produces: nada que consuman otras tareas.

- [ ] **Step 1: Extraer la fila a un componente local**

En `components/AttachmentUploader.tsx`, antes del componente principal, definir `FilaAdjunto` con el renderizado que hoy está en línea dentro del `.map()`. Es el mismo contenido: nombre, peso, previsualización de imagen o video (Tarea 5) y el botón de borrar.

```tsx
function FilaAdjunto({
  adjunto,
  url,
  canManage,
  onEliminar,
}: {
  adjunto: Attachment;
  url: string | undefined;
  canManage: boolean;
  onEliminar: (id: string) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="min-w-0 flex-1">
        <a href={url} target="_blank" rel="noreferrer">
          <p className="truncate text-sm font-medium text-brand-700">{adjunto.file_name}</p>
          <p className="text-xs text-slate-400">{formatearBytes(adjunto.file_size ?? 0)}</p>
        </a>

        {adjunto.file_type?.startsWith('image/') && url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={adjunto.file_name} className="mt-1 h-20 rounded-md object-cover" />
        )}

        {adjunto.file_type?.startsWith('video/') && url && (
          <video controls preload="metadata" className="mt-1 max-h-64 w-full rounded-md bg-black">
            <source src={url} type={adjunto.file_type} />
            Tu navegador no puede reproducir este archivo. Descargalo para verlo.
          </video>
        )}
      </div>

      {canManage && (
        <button
          onClick={() => onEliminar(adjunto.id)}
          className="text-xs text-red-500 hover:underline"
        >
          Eliminar
        </button>
      )}
    </div>
  );
}
```

Importar `formatearBytes` desde `@/lib/attachments` y borrar la función local `formatBytes` que hoy vive en el archivo: quedaría duplicada.

- [ ] **Step 2: Reemplazar el listado plano por rondas**

Importar `agruparPorRonda` y envolver cada ronda:

```tsx
const rondas = agruparPorRonda(attachments);
const rondaVigente = rondas[0]?.ronda;

// …

{rondas.length === 0 && <p className="text-sm text-slate-400">Sin adjuntos todavía.</p>}

{rondas.map((ronda) => (
  <details key={ronda.ronda} open={ronda.ronda === rondaVigente} className="mt-2">
    <summary className="cursor-pointer text-xs font-medium text-slate-500">
      {ronda.ronda === rondaVigente ? 'Versión actual' : `Ronda ${ronda.ronda}`} —{' '}
      {ronda.adjuntos.length} {ronda.adjuntos.length === 1 ? 'archivo' : 'archivos'}
    </summary>

    <div className="mt-2 space-y-2">
      {ronda.adjuntos.map((entrada) => (
        <div key={entrada.vigente.id}>
          <FilaAdjunto
            adjunto={entrada.vigente}
            url={urls[entrada.vigente.id]}
            canManage={canManage}
            onEliminar={eliminar}
          />

          {entrada.reemplazados.length > 0 && (
            <details className="mt-1 pl-3">
              <summary className="cursor-pointer text-xs text-slate-400">
                {entrada.reemplazados.length} versión
                {entrada.reemplazados.length === 1 ? '' : 'es'} anterior
                {entrada.reemplazados.length === 1 ? '' : 'es'}
              </summary>
              <div className="mt-1 space-y-1 opacity-60">
                {entrada.reemplazados.map((viejo) => (
                  <FilaAdjunto
                    key={viejo.id}
                    adjunto={viejo}
                    url={urls[viejo.id]}
                    canManage={false}
                    onEliminar={eliminar}
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      ))}
    </div>
  </details>
))}
```

`<details>` nativo evita sumar estado de abierto/cerrado y funciona sin JavaScript. Las versiones anteriores van con `canManage={false}`: el historial no se borra, que es justamente lo que el producto promete conservar.

Definir también el manejador que las filas reciben, dentro del componente principal:

```tsx
function eliminar(id: string) {
  deleteAttachment(id, piece.id).then(() => router.refresh());
}
```

- [ ] **Step 3: Verificar el gate**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: verde.

- [ ] **Step 4: Verificación manual**

Con el seed cargado, sobre una pieza: subir un archivo, pedir cambios como cliente, y subir otro como agencia. La ficha debe mostrar "Versión actual — 1 archivo" abierto y "Ronda 1 — 1 archivo" colapsado.

- [ ] **Step 5: Commit**

```bash
git add components/AttachmentUploader.tsx
git commit -m "feat: group attachments by review round"
```

---

## Task 7: Reemplazo explícito por archivo

**Files:**
- Modify: `components/AttachmentUploader.tsx`

**Interfaces:**
- Consumes: `handleUpload(files, replacesId)` de la Tarea 4, que ya acepta el segundo parámetro; `FilaAdjunto` de la Tarea 6.
- Produces: nada.

- [ ] **Step 1: Agregar la prop a `FilaAdjunto`**

Sumar `onSubirVersion?: (files: FileList | null, replacesId: string) => void` a las props de `FilaAdjunto`. Es opcional a propósito: las filas del historial (Tarea 6) se renderizan sin ella, así que una versión vieja nunca ofrece reemplazo.

Dentro del componente, agregar la referencia y el control, junto al botón de eliminar:

```tsx
const inputVersionRef = useRef<HTMLInputElement>(null);

// en el render, dentro del bloque de acciones:
{onSubirVersion && (
  <>
    <input
      ref={inputVersionRef}
      type="file"
      className="hidden"
      onChange={(e) => onSubirVersion(e.target.files, adjunto.id)}
    />
    <button
      type="button"
      onClick={() => inputVersionRef.current?.click()}
      className="text-xs text-brand-700 hover:underline"
    >
      Subir nueva versión
    </button>
  </>
)}
```

- [ ] **Step 2: Pasarla solo a las filas vigentes**

En el listado de la Tarea 6, agregar a la `FilaAdjunto` del adjunto vigente (no a las del historial):

```tsx
onSubirVersion={canManage ? handleUpload : undefined}
```

El `adjunto.id` que `onSubirVersion` reenvía como segundo argumento es lo que termina en `replaces_id` a través de `registrarAdjunto`.

- [ ] **Step 3: Verificar el gate completo**

Run: `npm run typecheck && npm run lint && npm run test && npm run test:integration`
Expected: todo verde.

- [ ] **Step 4: Verificación manual**

Sobre un adjunto vigente, pulsar "Subir nueva versión" y elegir otro archivo. El nuevo debe quedar como vigente y el anterior plegado bajo él como "1 versión anterior". Intentar subir una segunda versión del mismo archivo anterior debe fallar por la restricción `unique` — ese camino ya está cubierto por la prueba de integración de la Tarea 1.

- [ ] **Step 5: Commit**

```bash
git add components/AttachmentUploader.tsx
git commit -m "feat: replace a specific attachment with a new version"
```

---

## Cierre

- [ ] **Actualizar el README**

En la sección de pruebas o en una nueva sección "Adjuntos", documentar: tope de 200 MB, los ocho tipos permitidos, que `.mov` se acepta pero puede no reproducirse fuera de Safari, y que las versiones se agrupan por ronda de revisión.

- [ ] **Commit final y push**

```bash
git add README.md
git commit -m "docs: document attachment limits and versioning"
git push origin main
```

CI corre lint, typecheck, unitarias, integración y build sobre Node 22. Vercel despliega desde `main` automáticamente.
