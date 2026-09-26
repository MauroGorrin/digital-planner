# Comentarios anclados al video — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un comentario pueda nombrar un archivo de video y un segundo, que el hilo lo muestre con esa marca, y que al pulsarla el reproductor de esa versión salte a ese momento.

**Architecture:** Dos columnas aditivas en `comments` más un trigger que impide anclar a un adjunto de otra pieza. La creación vive junto al reproductor, dentro de `FilaAdjunto`; la lectura en `CommentThread`. El salto entre ambos componentes —que son hermanos sin estado compartido— se hace por el DOM: cada `<video>` lleva `id="video-<attachmentId>"` y una función pura recibe el elemento ya resuelto, para poder probarla sin navegador.

**Tech Stack:** Next.js 14 (App Router, Server Actions) · TypeScript 5.5 strict · Supabase (Postgres + RLS) · Vitest 5 + jsdom · Tailwind 3.4

**Spec:** `docs/superpowers/specs/2026-09-25-comentarios-anclados-al-video-design.md`

## Global Constraints

- Los textos de interfaz van en español, **sin voseo** (tú con tilde: "Descárgalo", "Vuelve", "Elige").
- `review_round` nunca se envía desde el cliente; lo asigna un trigger de Postgres.
- `SUPABASE_SERVICE_ROLE_KEY` es solo de servidor y jamás se toca desde un componente `"use client"`.
- Nunca editar una migración ya aplicada (`0001`, `0002`, `0003`): los cambios van en `0004`.
- Toda prueba unitaria vive en `tests/unit/**` y nunca toca Postgres real ni la red; solo `tests/integration/**` usa Postgres.
- El proyecto **no tiene pruebas E2E de navegador** y eso es un no-objetivo: no inventar ninguna.
- Gate antes de dar por terminada cualquier tarea: `npm run typecheck && npm run lint && npm run test && npm run test:integration`.

---

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `supabase/migrations/0004_comment_anchors.sql` | Las dos columnas y el trigger de integridad | 1 |
| `types/database.ts` | Los dos campos nuevos en `Comment` | 1 |
| `tests/integration/comment-anchors.test.ts` | Trigger y `on delete set null`, contra Postgres real | 1 |
| `lib/comentarios.ts` | `formatearSegundos`, `estaReemplazado`, `saltarAlSegundo`. Sin React ni JSX | 2, 3 |
| `tests/unit/lib/comentarios.test.ts` | Las tres funciones | 2, 3 |
| `app/actions.ts` | `addComment` acepta un ancla opcional | 4 |
| `components/AttachmentUploader.tsx` | El `id` del `<video>` y el botón "Comentar en M:SS" | 4 |
| `components/ContentPieceDetail.tsx` | Pasa `attachments` a `CommentThread` | 5 |
| `components/CommentThread.tsx` | La marca en cada comentario anclado y el salto | 5 |

---

## Task 1: Migración de anclas y trigger de integridad

**Files:**
- Create: `supabase/migrations/0004_comment_anchors.sql`
- Create: `tests/integration/comment-anchors.test.ts`
- Modify: `types/database.ts:130-138` (interfaz `Comment`)

**Interfaces:**
- Consumes: el esquema de `0001_init.sql` (`comments`, `attachments`, `content_pieces`, `profiles`) y `0003_attachment_versions.sql` (`attachments.replaces_id`).
- Produces: columnas `comments.attachment_id uuid | null` y `comments.video_segundo number | null`; trigger `comments_check_attachment`.

- [ ] **Step 1: Escribir la prueba de integración que falla**

Crear `tests/integration/comment-anchors.test.ts`. El encabezado de credenciales es el mismo patrón que `tests/integration/attachment-versions.test.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';
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

const sufijo = Date.now();
const correoAgencia = `anc-agencia-${sufijo}@prueba.local`;

const ids = {
  agencia: '',
  clienteA: '',
  clienteB: '',
  piezaA: '',
  piezaB: '',
  adjuntoA: '',
  adjuntoB: '',
};

async function crearPieza(clientId: string, titulo: string) {
  const { data, error } = await admin
    .from('content_pieces')
    .insert({
      client_id: clientId,
      platform: 'instagram',
      format: 'reel',
      title: titulo,
      scheduled_at: new Date().toISOString(),
      created_by: ids.agencia,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

async function crearAdjunto(clientId: string, piezaId: string, nombre: string) {
  const { data, error } = await admin
    .from('attachments')
    .insert({
      content_piece_id: piezaId,
      file_path: `${clientId}/${piezaId}/${nombre}`,
      file_name: nombre,
      file_type: 'video/mp4',
      file_size: 1024,
      uploaded_by: ids.agencia,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

beforeAll(async () => {
  const { data: usuario, error } = await admin.auth.admin.createUser({
    email: correoAgencia,
    password: 'contrasena-de-prueba-1234',
    email_confirm: true,
  });
  if (error) throw error;
  ids.agencia = usuario.user.id;
  await admin.from('profiles').update({ role: 'agency_admin' }).eq('id', ids.agencia);

  const { data: marcaA } = await admin
    .from('clients')
    .insert({ name: `Marca A ${sufijo}`, brand_name: 'A', timezone: 'America/Mexico_City', created_by: ids.agencia })
    .select('id')
    .single();
  const { data: marcaB } = await admin
    .from('clients')
    .insert({ name: `Marca B ${sufijo}`, brand_name: 'B', timezone: 'America/Mexico_City', created_by: ids.agencia })
    .select('id')
    .single();
  ids.clienteA = marcaA!.id;
  ids.clienteB = marcaB!.id;

  ids.piezaA = await crearPieza(ids.clienteA, 'Pieza A');
  ids.piezaB = await crearPieza(ids.clienteB, 'Pieza B');
  ids.adjuntoA = await crearAdjunto(ids.clienteA, ids.piezaA, 'a.mp4');
  ids.adjuntoB = await crearAdjunto(ids.clienteB, ids.piezaB, 'b.mp4');
});

afterAll(async () => {
  await admin.from('clients').delete().eq('id', ids.clienteA);
  await admin.from('clients').delete().eq('id', ids.clienteB);
  if (ids.agencia) await admin.auth.admin.deleteUser(ids.agencia);
});

describe('anclas de comentarios', () => {
  it('acepta un comentario anclado a un adjunto de su propia pieza', async () => {
    const { data, error } = await admin
      .from('comments')
      .insert({
        content_piece_id: ids.piezaA,
        author_id: ids.agencia,
        body: 'En 0:12 el logo esta cortado',
        attachment_id: ids.adjuntoA,
        video_segundo: 12,
      })
      .select('id, video_segundo')
      .single();

    expect(error).toBeNull();
    expect(data!.video_segundo).toBe(12);
  });

  it('rechaza un comentario anclado a un adjunto de otra pieza', async () => {
    const { error } = await admin.from('comments').insert({
      content_piece_id: ids.piezaA,
      author_id: ids.agencia,
      body: 'Ancla invalida',
      attachment_id: ids.adjuntoB,
      video_segundo: 5,
    });

    expect(error).not.toBeNull();
  });

  it('conserva el comentario cuando se borra el adjunto al que apuntaba', async () => {
    const adjunto = await crearAdjunto(ids.clienteA, ids.piezaA, 'efimero.mp4');
    const { data: comentario } = await admin
      .from('comments')
      .insert({
        content_piece_id: ids.piezaA,
        author_id: ids.agencia,
        body: 'Sobrevive al borrado',
        attachment_id: adjunto,
        video_segundo: 30,
      })
      .select('id')
      .single();

    await admin.from('attachments').delete().eq('id', adjunto);

    const { data: despues } = await admin
      .from('comments')
      .select('id, body, attachment_id, video_segundo')
      .eq('id', comentario!.id)
      .single();

    expect(despues).not.toBeNull();
    expect(despues!.body).toBe('Sobrevive al borrado');
    expect(despues!.attachment_id).toBeNull();
    expect(despues!.video_segundo).toBe(30);
  });
});
```

- [ ] **Step 2: Correr la prueba y verificar que falla**

Run: `npm run test:integration`
Expected: FAIL. Los tres casos fallan porque la columna `attachment_id` no existe todavía (error de Postgres sobre columna desconocida).

- [ ] **Step 3: Escribir la migración**

Crear `supabase/migrations/0004_comment_anchors.sql`:

```sql
-- Anclaje de comentarios a un momento de un video.
-- Aditiva: un comentario con ambas columnas vacias es un comentario normal.

alter table comments
  add column if not exists attachment_id uuid references attachments (id) on delete set null,
  add column if not exists video_segundo int;

create index if not exists idx_comments_attachment on comments (attachment_id);

-- on delete set null, no cascade: si borrar un archivo se llevara sus comentarios, se perderia
-- parte del registro de por que una pieza se aprobo o se rechazo. El comentario sobrevive y lo
-- que se pierde es el ancla. Consecuencia buscada: puede existir una fila con video_segundo y
-- sin attachment_id, y la interfaz lo dice en vez de disimularlo.

-- Un comentario solo puede anclarse a un adjunto de su propia pieza. Lo impone la base, no la
-- interfaz: attachments.replaces_id ya tiene ese mismo hueco sin cerrar y quedo anotado como
-- deuda; repetirlo en una tabla nueva seria un error conocido cometido dos veces.
create or replace function check_comment_attachment_piece()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.attachment_id is not null then
    if not exists (
      select 1 from attachments
      where id = new.attachment_id
        and content_piece_id = new.content_piece_id
    ) then
      raise exception 'El adjunto % no pertenece a la pieza %', new.attachment_id, new.content_piece_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists comments_check_attachment on comments;
create trigger comments_check_attachment
  before insert or update on comments
  for each row execute function check_comment_attachment_piece();
```

- [ ] **Step 4: Agregar los campos al tipo `Comment`**

En `types/database.ts`, dentro de `interface Comment` (líneas 130-138), agregar después de `parent_comment_id`:

```typescript
  attachment_id: string | null;
  video_segundo: number | null;
```

- [ ] **Step 5: Correr las pruebas y verificar que pasan**

Run: `npm run test:integration`
Expected: PASS, los tres casos nuevos en verde más los existentes.

- [ ] **Step 6: Correr el gate completo**

Run: `npm run typecheck && npm run lint && npm run test && npm run test:integration`
Expected: todo en verde.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0004_comment_anchors.sql tests/integration/comment-anchors.test.ts types/database.ts
git commit -m "feat: anchor comments to an attachment and a second"
```

---

## Task 2: Formateo de segundos y detección de versión reemplazada

**Files:**
- Create: `lib/comentarios.ts`
- Create: `tests/unit/lib/comentarios.test.ts`

**Interfaces:**
- Consumes: el tipo `Attachment` de `types/database.ts`, con `replaces_id`.
- Produces: `formatearSegundos(total: number): string` y `estaReemplazado(attachmentId: string, attachments: Attachment[]): boolean`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/unit/lib/comentarios.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { Attachment } from '@/types/database';
import { estaReemplazado, formatearSegundos } from '@/lib/comentarios';

function adjunto(id: string, replacesId: string | null = null): Attachment {
  return {
    id,
    content_piece_id: 'pieza-1',
    file_path: `cliente-1/pieza-1/${id}.mp4`,
    file_name: `${id}.mp4`,
    file_type: 'video/mp4',
    file_size: 1024,
    uploaded_by: null,
    created_at: '2026-09-25T10:00:00Z',
    replaces_id: replacesId,
    review_round: 1,
  };
}

describe('formatearSegundos', () => {
  it('muestra minutos y segundos con dos digitos', () => {
    expect(formatearSegundos(12)).toBe('0:12');
    expect(formatearSegundos(65)).toBe('1:05');
    expect(formatearSegundos(0)).toBe('0:00');
  });

  it('agrega la hora solo cuando pasa de una hora', () => {
    expect(formatearSegundos(3903)).toBe('1:05:03');
    expect(formatearSegundos(3599)).toBe('59:59');
  });

  it('trunca decimales y trata un negativo como cero', () => {
    expect(formatearSegundos(12.9)).toBe('0:12');
    expect(formatearSegundos(-5)).toBe('0:00');
  });
});

describe('estaReemplazado', () => {
  it('es verdadero cuando otro adjunto lo declara en replaces_id', () => {
    const lista = [adjunto('v1'), adjunto('v2', 'v1')];
    expect(estaReemplazado('v1', lista)).toBe(true);
  });

  it('es falso para el adjunto vigente', () => {
    const lista = [adjunto('v1'), adjunto('v2', 'v1')];
    expect(estaReemplazado('v2', lista)).toBe(false);
  });

  it('es falso cuando no hay reemplazos', () => {
    expect(estaReemplazado('suelto', [adjunto('suelto')])).toBe(false);
  });
});
```

- [ ] **Step 2: Correr la prueba y verificar que falla**

Run: `npx vitest run tests/unit/lib/comentarios.test.ts`
Expected: FAIL con un error de módulo no encontrado sobre `@/lib/comentarios`.

- [ ] **Step 3: Escribir las dos funciones**

Crear `lib/comentarios.ts`:

```typescript
import type { Attachment } from '@/types/database';

/**
 * Segundos a texto de reproductor: 0:12, 1:05, y 1:05:03 cuando pasa de la hora.
 * Trunca decimales porque currentTime del navegador es fraccionario.
 */
export function formatearSegundos(total: number): string {
  const enteros = Math.max(0, Math.floor(total));
  const horas = Math.floor(enteros / 3600);
  const minutos = Math.floor((enteros % 3600) / 60);
  const segundos = enteros % 60;
  const dosDigitos = (n: number) => String(n).padStart(2, '0');

  return horas > 0
    ? `${horas}:${dosDigitos(minutos)}:${dosDigitos(segundos)}`
    : `${minutos}:${dosDigitos(segundos)}`;
}

/**
 * Un adjunto esta reemplazado cuando otro lo declara en su replaces_id. Se deriva de los datos
 * que ya hay en vez de guardar un segundo estado que pueda desincronizarse — el mismo criterio
 * que usa agruparPorRonda para decidir cual es el vigente.
 */
export function estaReemplazado(attachmentId: string, attachments: Attachment[]): boolean {
  return attachments.some((a) => a.replaces_id === attachmentId);
}
```

- [ ] **Step 4: Correr la prueba y verificar que pasa**

Run: `npx vitest run tests/unit/lib/comentarios.test.ts`
Expected: PASS, 6 pruebas.

- [ ] **Step 5: Correr el gate completo**

Run: `npm run typecheck && npm run lint && npm run test && npm run test:integration`
Expected: todo en verde.

- [ ] **Step 6: Commit**

```bash
git add lib/comentarios.ts tests/unit/lib/comentarios.test.ts
git commit -m "feat: format player timestamps and detect superseded attachments"
```

---

## Task 3: Saltar el reproductor a un segundo

**Files:**
- Modify: `lib/comentarios.ts` (agregar al final)
- Modify: `tests/unit/lib/comentarios.test.ts` (agregar al final)

**Interfaces:**
- Consumes: nada de tareas anteriores más allá del módulo donde vive.
- Produces: `saltarAlSegundo(video: HTMLVideoElement | null, segundo: number): boolean`.

**Por qué recibe el elemento y no un id:** la función queda probable sin navegador. El que resuelve el `id` es quien la llama. Y **no** se define una interfaz estructural mínima para el parámetro, como sí se hizo con `ClienteAdjuntos` en `lib/attachments.ts`: la firma real combina métodos repartidos entre `Element` (`closest`), `HTMLMediaElement` (`readyState`, `currentTime`) y `EventTarget` (`addEventListener`), y reconstruir esa combinación a mano en una interfaz propia no simplifica nada frente al tipo real `HTMLVideoElement | null` — solo agrega una superficie que puede desincronizarse del DOM real. (Aclaración sobre `closest` en concreto: con un selector literal de etiqueta como `'details'`, TypeScript ya infiere `HTMLDetailsElement | null` vía `HTMLElementTagNameMap`, sin necesitar ningún cast — no es que devuelva `Element` a secas.) En las pruebas se usa un doble con `as unknown as HTMLVideoElement`, que es honesto sobre lo que es.

- [ ] **Step 1: Escribir las pruebas que fallan**

Primero, **extender los dos imports que ya están arriba del archivo** (no agregar imports al final: `import/first` de ESLint los rechaza):

```typescript
import { describe, expect, it, vi } from 'vitest';
import { estaReemplazado, formatearSegundos, saltarAlSegundo } from '@/lib/comentarios';
```

Después, agregar al final de `tests/unit/lib/comentarios.test.ts`:

```typescript
type VideoDoble = {
  readyState: number;
  currentTime: number;
  closest: ReturnType<typeof vi.fn>;
  scrollIntoView: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
};

function videoDoble(readyState = 1, padre: { open: boolean } | null = null): VideoDoble {
  return {
    readyState,
    currentTime: 0,
    closest: vi.fn(() => padre),
    scrollIntoView: vi.fn(),
    addEventListener: vi.fn(),
  };
}

describe('saltarAlSegundo', () => {
  it('mueve el reproductor cuando los metadatos ya estan cargados', () => {
    const video = videoDoble(1);
    saltarAlSegundo(video as unknown as HTMLVideoElement, 42);

    expect(video.currentTime).toBe(42);
    expect(video.scrollIntoView).toHaveBeenCalled();
    expect(video.addEventListener).not.toHaveBeenCalled();
  });

  it('espera a loadedmetadata cuando todavia no estan cargados', () => {
    const video = videoDoble(0);
    saltarAlSegundo(video as unknown as HTMLVideoElement, 42);

    // Sin metadatos, asignar currentTime no tiene efecto: hay que esperar.
    expect(video.currentTime).toBe(0);
    expect(video.addEventListener).toHaveBeenCalledWith(
      'loadedmetadata',
      expect.any(Function),
      { once: true }
    );

    // Al dispararse el evento, ahora si salta.
    const escucha = video.addEventListener.mock.calls[0][1] as () => void;
    escucha();
    expect(video.currentTime).toBe(42);
  });

  it('despliega el details que contenga al reproductor', () => {
    const padre = { open: false };
    const video = videoDoble(1, padre);
    saltarAlSegundo(video as unknown as HTMLVideoElement, 10);

    expect(video.closest).toHaveBeenCalledWith('details');
    expect(padre.open).toBe(true);
  });

  it('no lanza cuando el reproductor no existe', () => {
    expect(() => saltarAlSegundo(null, 10)).not.toThrow();
  });
});
```

- [ ] **Step 2: Correr la prueba y verificar que falla**

Run: `npx vitest run tests/unit/lib/comentarios.test.ts`
Expected: FAIL con `saltarAlSegundo is not a function` o un error de exportación.

- [ ] **Step 3: Escribir la función**

Agregar al final de `lib/comentarios.ts`:

```typescript
/**
 * Lleva un reproductor a un segundo concreto. Recibe el elemento ya resuelto para poder probarse
 * sin navegador; quien llama hace el document.getElementById.
 *
 * Tres cosas que no son obvias:
 * - Si el <video> esta dentro de un <details> plegado (el historial de versiones), se despliega
 *   antes: saltar a un reproductor invisible no le sirve a nadie.
 * - Asignar currentTime antes de que carguen los metadatos no tiene efecto, asi que en ese caso
 *   se espera a loadedmetadata.
 * - No se llama a play(): mover el reproductor es lo pedido; arrancar el audio sin que nadie lo
 *   pida es hostil.
 */
export function saltarAlSegundo(video: HTMLVideoElement | null, segundo: number): void {
  if (!video) return;

  const contenedor = video.closest('details');
  if (contenedor) (contenedor as HTMLDetailsElement).open = true;

  if (video.readyState >= 1) {
    video.currentTime = segundo;
  } else {
    video.addEventListener(
      'loadedmetadata',
      () => {
        video.currentTime = segundo;
      },
      { once: true }
    );
  }

  video.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
```

- [ ] **Step 4: Correr la prueba y verificar que pasa**

Run: `npx vitest run tests/unit/lib/comentarios.test.ts`
Expected: PASS, 10 pruebas en el archivo.

- [ ] **Step 5: Correr el gate completo**

Run: `npm run typecheck && npm run lint && npm run test && npm run test:integration`
Expected: todo en verde.

- [ ] **Step 6: Commit**

```bash
git add lib/comentarios.ts tests/unit/lib/comentarios.test.ts
git commit -m "feat: seek a player to a given second"
```

---

## Task 4: Crear el comentario anclado desde el reproductor

**Files:**
- Modify: `app/actions.ts:217` (`addComment`)
- Modify: `components/AttachmentUploader.tsx` (`FilaAdjunto` y el componente principal)

**Interfaces:**
- Consumes: `formatearSegundos` de la Tarea 2.
- Produces: `addComment(id: string, body: string, parentId?: string, ancla?: { attachmentId: string; videoSegundo: number }): Promise<void>`, y el prop `onComentar?: (attachmentId: string, segundo: number, texto: string) => Promise<void>` de `FilaAdjunto`.

- [ ] **Step 1: Extender `addComment`**

En `app/actions.ts`, cambiar la firma y el insert. El cuarto parámetro es un objeto en vez de dos posicionales sueltos, para que la llamada existente en `CommentThread.tsx` siga funcionando sin tocarse:

```typescript
export async function addComment(
  id: string,
  body: string,
  parentId?: string,
  ancla?: { attachmentId: string; videoSegundo: number }
) {
  const profile = await requireProfile();
  const supabase = createClient();
  const { error } = await supabase.from('comments').insert({
    content_piece_id: id,
    author_id: profile.id,
    body,
    parent_comment_id: parentId ?? null,
    attachment_id: ancla?.attachmentId ?? null,
    video_segundo: ancla?.videoSegundo ?? null,
  });
  if (error) throw new Error(error.message);
```

El resto del cuerpo de la función (webhook y notificaciones) queda **exactamente igual**: un comentario anclado sigue siendo un comentario y debe disparar lo mismo.

- [ ] **Step 2: Dar un `id` estable al `<video>`**

En `components/AttachmentUploader.tsx`, dentro de `FilaAdjunto`, agregar `id` al elemento `<video>` que ya existe:

```tsx
<video
  id={`video-${adjunto.id}`}
  controls
  preload="metadata"
  src={url}
  className="mt-1 max-h-64 w-full rounded-md bg-black"
  onError={() => setVideoFallo(true)}
/>
```

Ese `id` es el contrato con la Tarea 5: es como el hilo de comentarios encuentra el reproductor.

- [ ] **Step 3: Agregar el botón y el campo a `FilaAdjunto`**

Sumar a las props de `FilaAdjunto`:

```typescript
  onComentar?: (attachmentId: string, segundo: number, texto: string) => Promise<void>;
```

Y el estado, dentro del componente, junto a `videoFallo`:

```tsx
const [segundoActual, setSegundoActual] = useState(0);
const [comentando, setComentando] = useState<number | null>(null);
const [textoComentario, setTextoComentario] = useState('');
const [enviandoComentario, setEnviandoComentario] = useState(false);
```

**El segundo va en estado, no en un `ref`.** Leer `videoRef.current.currentTime` durante el render no funciona: React no vuelve a renderizar cuando cambia un ref, así que la etiqueta del botón se quedaría congelada en `0:00` mientras el video avanza — y el usuario pulsaría creyendo que ancla en un momento y anclaría en otro. Por eso el `<video>` del paso anterior lleva además:

```tsx
onTimeUpdate={(e) => setSegundoActual(e.currentTarget.currentTime)}
```

`timeupdate` se dispara unas cuatro veces por segundo. Es un re-render barato de una fila y el elemento `<video>` conserva su nodo del DOM, así que la reproducción no se interrumpe.

Debajo del bloque de video, dentro del mismo `<div className="min-w-0 flex-1">`, agregar:

```tsx
{adjunto.file_type?.startsWith('video/') && url && !videoFallo && onComentar && (
  <div className="mt-1">
    {comentando === null ? (
      <button
        type="button"
        onClick={() => setComentando(Math.floor(segundoActual))}
        className="text-xs font-medium text-brand-600 hover:underline"
      >
        Comentar en {formatearSegundos(segundoActual)}
      </button>
    ) : (
      <div className="rounded-md border border-slate-200 bg-white p-2">
        <p className="mb-1 text-[11px] text-slate-500">
          Comentario en {formatearSegundos(comentando)}
        </p>
        <textarea
          value={textoComentario}
          onChange={(e) => setTextoComentario(e.target.value)}
          rows={2}
          placeholder="Que hay que corregir en este momento?"
          className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setComentando(null);
              setTextoComentario('');
            }}
            className="text-xs text-slate-500 hover:underline"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={enviandoComentario || !textoComentario.trim()}
            onClick={async () => {
              setEnviandoComentario(true);
              try {
                await onComentar(adjunto.id, comentando, textoComentario.trim());
                setComentando(null);
                setTextoComentario('');
              } finally {
                setEnviandoComentario(false);
              }
            }}
            className="text-xs font-medium text-brand-600 hover:underline disabled:text-slate-400"
          >
            {enviandoComentario ? 'Enviando...' : 'Comentar'}
          </button>
        </div>
      </div>
    )}
  </div>
)}
```

`formatearSegundos` vive en `@/lib/comentarios`, no en `@/lib/attachments`. Agregar una línea de import nueva junto a las que ya están arriba del archivo:

```typescript
import { formatearSegundos } from '@/lib/comentarios';
```

- [ ] **Step 4: Conectar el callback en el componente principal**

En `AttachmentUploader`, definir la función y pasarla a **todas** las instancias de `FilaAdjunto`, incluidas las del historial — comentar sobre una versión vieja es legítimo:

```tsx
async function comentarEnVideo(attachmentId: string, segundo: number, texto: string) {
  try {
    await addComment(piece.id, texto, undefined, { attachmentId, videoSegundo: segundo });
    router.refresh();
  } catch (err) {
    setError(err instanceof Error ? err.message : 'No se pudo guardar el comentario.');
  }
}
```

Importar `addComment` junto a `deleteAttachment`, que ya se importa de `@/app/actions`.

Pasar `onComentar={comentarEnVideo}` tanto en la `FilaAdjunto` del adjunto vigente como en las del `entrada.reemplazados.map(...)`.

- [ ] **Step 5: Correr el gate completo**

Run: `npm run typecheck && npm run lint && npm run test && npm run test:integration`
Expected: todo en verde. No hay pruebas unitarias nuevas en esta tarea: el proyecto no tiene pruebas de componente y montar esa infraestructura acá sería desproporcionado. Decirlo en el reporte en vez de fabricar evidencia.

- [ ] **Step 6: Commit**

```bash
git add app/actions.ts components/AttachmentUploader.tsx
git commit -m "feat: create a comment anchored to the current second of a video"
```

---

## Task 5: Mostrar la marca en el hilo y saltar al pulsarla

**Files:**
- Modify: `components/ContentPieceDetail.tsx:289-290` (pasar `attachments` a `CommentThread`)
- Modify: `components/CommentThread.tsx`

**Interfaces:**
- Consumes: `formatearSegundos`, `estaReemplazado` y `saltarAlSegundo` de las Tareas 2 y 3; el `id="video-<attachmentId>"` de la Tarea 4; los campos `attachment_id` y `video_segundo` de la Tarea 1.
- Produces: nada que consuman otras tareas.

- [ ] **Step 1: Pasar los adjuntos al hilo**

En `components/ContentPieceDetail.tsx`, en la línea donde se renderiza el hilo:

```tsx
<CommentThread pieceId={piece.id} comments={comments} profile={profile} attachments={attachments} />
```

`attachments` ya es un prop de `ContentPieceDetail`; no hay que cargarlo ni pasarlo desde la página.

- [ ] **Step 2: Recibir el prop y agregar los imports**

En `components/CommentThread.tsx`, cambiar la firma:

```tsx
export function CommentThread({
  pieceId,
  comments,
  profile,
  attachments,
}: {
  pieceId: string;
  comments: Comment[];
  profile: Profile;
  attachments: Attachment[];
}) {
```

Y los imports:

```typescript
import type { Attachment, Comment, Profile } from '@/types/database';
import { estaReemplazado, formatearSegundos, saltarAlSegundo } from '@/lib/comentarios';
```

- [ ] **Step 3: Renderizar la marca**

Dentro del `comments.map((c) => ...)`, justo después del `<p>` que muestra `c.body`, insertar:

```tsx
{c.video_segundo !== null && (
  <div className="mt-1">
    {c.attachment_id ? (
      <button
        type="button"
        onClick={() =>
          saltarAlSegundo(
            document.getElementById(`video-${c.attachment_id}`) as HTMLVideoElement | null,
            c.video_segundo!
          )
        }
        className="rounded bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 hover:underline"
      >
        {attachments.find((a) => a.id === c.attachment_id)?.file_name ?? 'Archivo'} ·{' '}
        {formatearSegundos(c.video_segundo)}
        {estaReemplazado(c.attachment_id, attachments) ? ' · versión anterior' : ''}
      </button>
    ) : (
      <span className="text-[11px] text-slate-400">
        Apuntaba a {formatearSegundos(c.video_segundo)} de un archivo que ya fue eliminado
      </span>
    )}
  </div>
)}
```

Las dos ramas importan. La segunda es el caso que el `on delete set null` de la Tarea 1 hace posible a propósito: el comentario sobrevive al borrado del archivo, y la interfaz lo dice en vez de mostrar una marca que no lleva a ninguna parte.

- [ ] **Step 4: Correr el gate completo**

Run: `npm run typecheck && npm run lint && npm run test && npm run test:integration`
Expected: todo en verde.

- [ ] **Step 5: Verificación manual**

El spec declara cuatro de sus seis criterios como manuales. Con `npm run dev` y una sesión real:

1. Subir un video a una pieza, reproducirlo, pausarlo hacia la mitad y pulsar "Comentar en M:SS". Confirmar que el segundo del botón coincide con el del reproductor.
2. Enviar el comentario y confirmar que aparece en el hilo con el nombre del archivo y el segundo.
3. Pulsar la marca y confirmar que el reproductor salta a ese momento.
4. Subir una versión nueva sobre ese archivo. Confirmar que la marca del comentario viejo ahora dice "versión anterior", y que al pulsarla se despliega el historial y salta en el reproductor de esa versión.
5. Confirmar que un adjunto de imagen o PDF no ofrece el botón.

Anotar en el reporte qué se pudo verificar y qué no. **No inventar resultados de una verificación que no se corrió.**

- [ ] **Step 6: Commit**

```bash
git add components/ContentPieceDetail.tsx components/CommentThread.tsx
git commit -m "feat: show the anchor in the thread and seek on click"
```
