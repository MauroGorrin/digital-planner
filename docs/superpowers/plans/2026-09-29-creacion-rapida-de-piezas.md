# Creación más rápida de piezas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar crear varias piezas de contenido de una sola vez en `digital-planner`, de dos formas: subiendo una tanda de archivos (una pieza por archivo) y marcando que una pieza se repita en días fijos de la semana.

**Architecture:** Una función de servidor nueva, `createContentPieces`, reutiliza la ya existente `createContentPiece` en un bucle, capturando el éxito o el fallo de cada ítem sin revertir nada. Una función pura, `fechasRecurrentes`, calcula las fechas de una serie recurrente. Dos superficies de UI la consumen: una sección nueva dentro del formulario de creación existente (`ContentPieceForm`) para la recurrencia, y una pantalla nueva (`/piezas/nueva-multiple`) para la carga de un lote de archivos.

**Tech Stack:** Next.js 15 (App Router, Server Actions) · TypeScript 5.5 (strict) · React (`'use client'` components) · Tailwind CSS 3.4 · Vitest 5 + jsdom + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-29-creacion-rapida-de-piezas-design.md` — léelo completo antes de empezar. Incluye la corrección de que A1 (duplicar) ya está construido y no se toca.

## Global Constraints

- **No hay ninguna migración de base de datos en este plan.** Las cuatro tareas reutilizan `content_pieces` y `attachments` tal cual están hoy.
- **Tope de lote: 12 ítems**, verificado dentro de `createContentPieces` antes de crear nada. Ninguna interfaz debe poder pedir más — carga múltiple limita a 10 archivos en su propia pantalla, y recurrencia a 12 repeticiones.
- **Fallo parcial nunca revierte lo que sí se creó.** Si un ítem de un lote falla, los demás quedan creados; se reporta cuál falló y por qué.
- **`createContentPieces` reutiliza `createContentPiece`** (`app/actions.ts:32-60`) llamándola en un bucle — no reimplementa el insert, la validación del link de referencia ni el scoping por agencia.
- **No se prueba `createContentPieces` como integración.** Es una Server Action (usa `cookies()` de `next/headers` vía `createClient()` de `lib/supabase/server.ts`), que no existe fuera de una request de Next. Se prueba unitario, mockeando `createContentPiece`.
- **Cada ocurrencia de una serie recurrente nace independiente.** Sin concepto de "serie" después de creada: editar o borrar una no afecta a las demás.
- **Ni la recurrencia ni la carga múltiple copian adjuntos.** Los archivos se suben aparte, después, desde la ficha de cada pieza (carga múltiple es la excepción parcial: sube el archivo que corresponde a CADA pieza nueva, no copia nada entre piezas).
- **Gate obligatorio antes de dar cualquier tarea por terminada:** `npm run typecheck && npm run lint && npm run test` deben pasar en cero. (`npm run test:integration` no se toca en este plan porque ninguna tarea agrega SQL ni RLS nuevos, pero no debe quedar roto si ya pasaba antes.)

---

### Task 1: `lib/recurrencia.ts` — cálculo de fechas de una serie recurrente

**Files:**
- Create: `lib/recurrencia.ts`
- Test: `tests/unit/lib/recurrencia.test.ts`

**Interfaces:**
- Consumes: nada — función pura, sin dependencias.
- Produces: `fechasRecurrentes(fechaInicial: Date, diasDeLaSemana: number[], cantidad: number): Date[]`. `diasDeLaSemana` usa la convención de `Date#getDay()`: `0` domingo … `6` sábado. Task 3 (`ContentPieceForm`) y Task 4 (`ContentPiecesMultipleForm`, indirectamente vía Task 2) importan esta función.

- [ ] **Step 1: Escribe las pruebas, en `tests/unit/lib/recurrencia.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { fechasRecurrentes } from '@/lib/recurrencia';

// Días de Date#getDay(): 0 domingo, 1 lunes ... 6 sábado.
const LUNES = 1;
const JUEVES = 4;

function fecha(iso: string): Date {
  return new Date(iso);
}

function comoISO(fechas: Date[]): string[] {
  return fechas.map((f) => f.toISOString());
}

describe('fechasRecurrentes', () => {
  it('con un martes de inicio y días [lunes, jueves], devuelve 4 fechas en orden con la hora del original', () => {
    // 2026-09-29 es martes.
    const inicio = fecha('2026-09-29T15:30:00.000Z');
    const resultado = fechasRecurrentes(inicio, [LUNES, JUEVES], 4);

    expect(comoISO(resultado)).toEqual([
      '2026-09-29T15:30:00.000Z', // el propio martes de inicio, siempre primero
      '2026-10-01T15:30:00.000Z', // jueves siguiente
      '2026-10-05T15:30:00.000Z', // lunes siguiente
      '2026-10-08T15:30:00.000Z', // jueves siguiente
    ]);
  });

  it('con cantidad 1 devuelve solo la fecha inicial, sin importar qué días estén marcados', () => {
    const inicio = fecha('2026-09-29T09:00:00.000Z');
    const resultado = fechasRecurrentes(inicio, [LUNES], 1);

    expect(comoISO(resultado)).toEqual(['2026-09-29T09:00:00.000Z']);
  });

  it('la fecha inicial siempre es la primera devuelta, aunque su día no esté en diasDeLaSemana', () => {
    // 2026-09-29 es martes; no está en [lunes, jueves], pero debe salir igual como la primera.
    const inicio = fecha('2026-09-29T12:00:00.000Z');
    const resultado = fechasRecurrentes(inicio, [LUNES, JUEVES], 2);

    expect(resultado[0].toISOString()).toBe('2026-09-29T12:00:00.000Z');
    expect(resultado).toHaveLength(2);
  });

  it('una serie que cruza un cambio de mes no salta ni repite un día', () => {
    // 2026-01-29 es jueves. Con días [jueves], las siguientes son 5 y 12 de febrero.
    const inicio = fecha('2026-01-29T10:00:00.000Z');
    const resultado = fechasRecurrentes(inicio, [JUEVES], 3);

    expect(comoISO(resultado)).toEqual([
      '2026-01-29T10:00:00.000Z',
      '2026-02-05T10:00:00.000Z',
      '2026-02-12T10:00:00.000Z',
    ]);
  });

  it('con cantidad 0 devuelve una lista vacía', () => {
    const inicio = fecha('2026-09-29T12:00:00.000Z');
    expect(fechasRecurrentes(inicio, [LUNES], 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Corre las pruebas y confirma que fallan**

Run: `npx vitest run tests/unit/lib/recurrencia.test.ts`
Expected: FAIL — `Cannot find module '@/lib/recurrencia'` (el archivo todavía no existe).

- [ ] **Step 3: Escribe `lib/recurrencia.ts`**

```ts
/**
 * Calcula las fechas de una pieza recurrente.
 *
 * `fechaInicial` es SIEMPRE la primera fecha devuelta, caiga en el día que caiga — es la fecha que
 * la persona ya eligió a propósito en el formulario. `diasDeLaSemana` decide las siguientes:
 * camina día por día desde `fechaInicial` (sin incluirla dos veces) y junta las fechas cuyo día de
 * la semana esté en la lista, hasta juntar `cantidad` en total. La hora se copia de `fechaInicial`
 * en cada una, porque el objeto de partida es un `Date` completo y solo se le cambia el día.
 *
 * `diasDeLaSemana` usa la convención de `Date#getDay()`: 0 = domingo … 6 = sábado.
 */
export function fechasRecurrentes(fechaInicial: Date, diasDeLaSemana: number[], cantidad: number): Date[] {
  if (cantidad <= 0) return [];

  const resultado: Date[] = [new Date(fechaInicial)];
  const cursor = new Date(fechaInicial);

  while (resultado.length < cantidad) {
    cursor.setDate(cursor.getDate() + 1);
    if (diasDeLaSemana.includes(cursor.getDay())) {
      resultado.push(new Date(cursor));
    }
  }

  return resultado;
}
```

- [ ] **Step 4: Corre las pruebas y confirma que pasan**

Run: `npx vitest run tests/unit/lib/recurrencia.test.ts`
Expected: PASS — 5 pruebas.

- [ ] **Step 5: Typecheck y commit**

Run: `npm run typecheck`
Expected: exit 0.

```bash
git add lib/recurrencia.ts tests/unit/lib/recurrencia.test.ts
git commit -m "feat: calcular las fechas de una pieza recurrente

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `app/actions-lote.ts` — crear varias piezas de una vez

**Files:**
- Create: `app/actions-lote.ts`
- Test: `tests/unit/actions-lote.test.ts`

**Interfaces:**
- Consumes: `createContentPiece` de `app/actions.ts:32-60`, cuya firma es:
  ```ts
  function createContentPiece(input: {
    client_id: string;
    platform: PlatformType;
    format: ContentFormat;
    title: string;
    copy_text: string;
    reference_link?: string;
    scheduled_at: string;
    assignee_id?: string;
  }): Promise<string>
  ```
- Produces: `createContentPieces(items: ItemDeLote[]): Promise<ResultadoDeLote>`, con:
  ```ts
  interface ItemDeLote {
    client_id: string;
    platform: PlatformType;
    format: ContentFormat;
    title: string;
    copy_text: string;
    reference_link?: string;
    scheduled_at: string;
    assignee_id?: string;
  }
  interface ResultadoDeLote {
    creadas: { indice: number; id: string }[];
    fallidas: { indice: number; mensaje: string }[];
  }
  ```
  Task 3 y Task 4 importan `createContentPieces`, `ItemDeLote` y `ResultadoDeLote` de `@/app/actions-lote`.

- [ ] **Step 1: Escribe las pruebas, en `tests/unit/actions-lote.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import type { ItemDeLote } from '@/app/actions-lote';

const createContentPiece = vi.fn();
vi.mock('@/app/actions', () => ({
  createContentPiece: (...args: unknown[]) => createContentPiece(...args),
}));

import { createContentPieces } from '@/app/actions-lote';

function item(overrides: Partial<ItemDeLote> = {}): ItemDeLote {
  return {
    client_id: 'client-a',
    platform: 'instagram',
    format: 'post',
    title: 'Pieza de prueba',
    copy_text: '',
    scheduled_at: '2026-10-05T15:00:00.000Z',
    ...overrides,
  };
}

describe('createContentPieces', () => {
  it('crea las piezas de todos los ítems cuando ninguna falla, en el mismo orden', async () => {
    createContentPiece.mockReset();
    createContentPiece.mockResolvedValueOnce('id-1').mockResolvedValueOnce('id-2').mockResolvedValueOnce('id-3');

    const resultado = await createContentPieces([item(), item(), item()]);

    expect(resultado.creadas).toEqual([
      { indice: 0, id: 'id-1' },
      { indice: 1, id: 'id-2' },
      { indice: 2, id: 'id-3' },
    ]);
    expect(resultado.fallidas).toEqual([]);
    expect(createContentPiece).toHaveBeenCalledTimes(3);
  });

  it('un ítem que falla no detiene ni descarta los que sí se crearon', async () => {
    createContentPiece.mockReset();
    createContentPiece
      .mockResolvedValueOnce('id-1')
      .mockRejectedValueOnce(new Error('Esa marca no existe o no pertenece a tu agencia.'))
      .mockResolvedValueOnce('id-3');

    const resultado = await createContentPieces([item(), item({ client_id: 'client-ajeno' }), item()]);

    expect(resultado.creadas).toEqual([
      { indice: 0, id: 'id-1' },
      { indice: 2, id: 'id-3' },
    ]);
    expect(resultado.fallidas).toEqual([{ indice: 1, mensaje: 'Esa marca no existe o no pertenece a tu agencia.' }]);
  });

  it('un ítem que falla con un error sin mensaje usa un mensaje genérico', async () => {
    createContentPiece.mockReset();
    createContentPiece.mockRejectedValueOnce('fallo sin forma de Error');

    const resultado = await createContentPieces([item()]);

    expect(resultado.fallidas).toEqual([{ indice: 0, mensaje: 'No se pudo crear esta pieza.' }]);
  });

  it('rechaza un lote de más de 12 ítems sin llamar a createContentPiece ni una vez', async () => {
    createContentPiece.mockReset();
    const items = Array.from({ length: 13 }, () => item());

    await expect(createContentPieces(items)).rejects.toThrow(/12/);
    expect(createContentPiece).not.toHaveBeenCalled();
  });

  it('acepta un lote de exactamente 12 ítems', async () => {
    createContentPiece.mockReset();
    createContentPiece.mockResolvedValue('id-x');
    const items = Array.from({ length: 12 }, () => item());

    const resultado = await createContentPieces(items);

    expect(resultado.creadas).toHaveLength(12);
    expect(resultado.fallidas).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Corre las pruebas y confirma que fallan**

Run: `npx vitest run tests/unit/actions-lote.test.ts`
Expected: FAIL — `Cannot find module '@/app/actions-lote'`.

- [ ] **Step 3: Escribe `app/actions-lote.ts`**

```ts
'use server';

import { createContentPiece } from '@/app/actions';
import type { ContentFormat, PlatformType } from '@/types/database';

/** Mismos campos que acepta createContentPiece — createContentPieces no agrega ni quita ninguno. */
export interface ItemDeLote {
  client_id: string;
  platform: PlatformType;
  format: ContentFormat;
  title: string;
  copy_text: string;
  reference_link?: string;
  scheduled_at: string;
  assignee_id?: string;
}

export interface ResultadoDeLote {
  creadas: { indice: number; id: string }[];
  fallidas: { indice: number; mensaje: string }[];
}

/**
 * Tope duro de un lote, verificado antes de crear nada.
 *
 * Ni la carga múltiple (10 archivos) ni la recurrencia (12 repeticiones) pueden pedir más por su
 * propia interfaz — esto es una red de seguridad del lado del servidor, no algo que el uso normal
 * vaya a tocar.
 */
const TOPE_DE_LOTE = 12;

/**
 * Crea varias piezas de contenido de una vez, reutilizando `createContentPiece` ítem por ítem.
 *
 * Por dentro es un bucle sobre `createContentPiece`, a propósito: es la misma validación, el mismo
 * scoping por agencia (`requireAgency()`) y el mismo mensaje de error que ya tiene la creación de
 * una sola pieza, sin lógica nueva de autorización que pueda desalinearse de la original.
 *
 * Si un ítem falla, los que ya se crearon ANTES quedan creados -- no se revierte nada. Es el mismo
 * criterio que ya usa ContentPieceForm hoy para una sola pieza: mejor una pieza de más creada y
 * visible que perder trabajo válido porque una fila tuvo un problema.
 */
export async function createContentPieces(items: ItemDeLote[]): Promise<ResultadoDeLote> {
  if (items.length > TOPE_DE_LOTE) {
    throw new Error(`Un lote no puede pedir más de ${TOPE_DE_LOTE} piezas de una vez.`);
  }

  const creadas: { indice: number; id: string }[] = [];
  const fallidas: { indice: number; mensaje: string }[] = [];

  for (const [indice, item] of items.entries()) {
    try {
      const id = await createContentPiece(item);
      creadas.push({ indice, id });
    } catch (err) {
      fallidas.push({ indice, mensaje: err instanceof Error ? err.message : 'No se pudo crear esta pieza.' });
    }
  }

  return { creadas, fallidas };
}
```

- [ ] **Step 4: Corre las pruebas y confirma que pasan**

Run: `npx vitest run tests/unit/actions-lote.test.ts`
Expected: PASS — 5 pruebas.

- [ ] **Step 5: Typecheck, lint y commit**

Run: `npm run typecheck && npm run lint`
Expected: exit 0.

```bash
git add app/actions-lote.ts tests/unit/actions-lote.test.ts
git commit -m "feat: crear varias piezas de contenido de una sola vez

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: "Repetir esta pieza" en `ContentPieceForm`

**Files:**
- Modify: `components/ContentPieceForm.tsx`
- Test: `tests/unit/components/ContentPieceForm.recurrencia.test.tsx` (archivo nuevo y separado de `ContentPieceForm.test.tsx`, que ya existe y no se toca — mismo criterio que separó `FormularioDeRegistro.captcha.test.tsx` de `FormularioDeRegistro.test.tsx` en este mismo repo: un archivo por comportamiento evita que un test file crezca sin límite)

**Interfaces:**
- Consumes: `fechasRecurrentes` de `@/lib/recurrencia` (Task 1); `createContentPieces` de `@/app/actions-lote` (Task 2).
- Produces: nada que otra tarea consuma — es la última pieza de UI de este archivo.

**Contexto exacto de `components/ContentPieceForm.tsx` en este momento** (léelo antes de tocarlo; los números de línea de abajo son los actuales):
- Línea 5: `import type { Client, ContentFormat, ContentPiece, PlatformType, Profile } from '@/types/database';`
- Línea 7: `import { createContentPiece, updateContentPiece } from '@/app/actions';`
- Línea 62: `const [assigneeId, setAssigneeId] = useState(piece?.assignee_id ?? '');` — último `useState` antes de `handleSubmit`.
- Líneas 96-140: la rama `else` (creación) de `handleSubmit`, que hoy siempre llama a `createContentPiece` una vez.
- Línea 281: `{!piece && (` — abre el bloque de "Archivos (opcional)", que termina en la línea 299.
- Línea 346: `<div className="flex justify-end gap-2 pt-2">` — los botones Cancelar / Guardar, al final del formulario.

- [ ] **Step 1: Escribe las pruebas, en `tests/unit/components/ContentPieceForm.recurrencia.test.tsx`**

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContentPieceForm } from '@/components/ContentPieceForm';
import { createContentPieces } from '@/app/actions-lote';
import type { Client } from '@/types/database';

const push = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn(), refresh }),
}));

vi.mock('@/app/actions', () => ({
  createContentPiece: vi.fn(),
  updateContentPiece: vi.fn(),
}));

vi.mock('@/app/actions-lote', () => ({
  createContentPieces: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } }),
}));

function crearClientes(): Client[] {
  return [
    {
      id: 'client-a',
      name: 'Cliente A',
      agency_id: 'agency-1',
      brand_name: 'Marca A',
      timezone: 'UTC',
      logo_url: null,
      notes: null,
      archived: false,
      billing_mode: 'paquete',
      created_by: null,
      created_at: '2026-01-01T00:00:00.000Z',
    },
  ];
}

describe('ContentPieceForm — repetir esta pieza', () => {
  afterEach(() => vi.clearAllMocks());

  it('sin marcar "Repetir esta pieza", no se muestra la sección de días ni el resumen de fechas', () => {
    render(<ContentPieceForm clients={crearClientes()} team={[]} defaultClientId="client-a" />);

    expect(screen.queryByText('¿Cuántas veces?')).not.toBeInTheDocument();
  });

  it('al marcar "Repetir esta pieza", el resumen de fechas se actualiza con la cantidad elegida', async () => {
    render(<ContentPieceForm clients={crearClientes()} team={[]} defaultClientId="client-a" />);

    fireEvent.click(screen.getByLabelText('Repetir esta pieza'));
    expect(screen.getByText('¿Cuántas veces?')).toBeInTheDocument();

    const cantidad = screen.getByLabelText('¿Cuántas veces?');
    fireEvent.change(cantidad, { target: { value: '3' } });

    await waitFor(() => {
      expect(screen.getByText(/Se crearán 3 piezas/)).toBeInTheDocument();
    });
  });

  it('al editar una pieza (con la prop piece) no aparece la opción de repetir', () => {
    render(
      <ContentPieceForm
        clients={crearClientes()}
        team={[]}
        piece={{
          id: 'pieza-1',
          client_id: 'client-a',
          platform: 'instagram',
          format: 'post',
          title: 'Pieza existente',
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
        }}
      />
    );

    expect(screen.queryByLabelText('Repetir esta pieza')).not.toBeInTheDocument();
  });

  it('al enviar con "Repetir" marcado, llama a createContentPieces con un ítem por fecha y navega al calendario', async () => {
    vi.mocked(createContentPieces).mockResolvedValue({
      creadas: [
        { indice: 0, id: 'id-1' },
        { indice: 1, id: 'id-2' },
      ],
      fallidas: [],
    });

    render(<ContentPieceForm clients={crearClientes()} team={[]} defaultClientId="client-a" />);

    fireEvent.change(screen.getByPlaceholderText('Ej. Lanzamiento colección primavera'), {
      target: { value: 'Post semanal' },
    });
    fireEvent.click(screen.getByLabelText('Repetir esta pieza'));
    fireEvent.change(screen.getByLabelText('¿Cuántas veces?'), { target: { value: '2' } });

    fireEvent.click(screen.getByRole('button', { name: 'Crear como borrador' }));

    await waitFor(() => expect(createContentPieces).toHaveBeenCalledTimes(1));
    const items = vi.mocked(createContentPieces).mock.calls[0][0];
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Post semanal');
    expect(items[0].client_id).toBe('client-a');
    expect(items[0].scheduled_at).not.toBe(items[1].scheduled_at);

    await waitFor(() => expect(push).toHaveBeenCalledWith('/calendario'));
  });

  it('si createContentPieces devuelve alguna fila fallida, muestra el error y no navega', async () => {
    vi.mocked(createContentPieces).mockResolvedValue({
      creadas: [{ indice: 0, id: 'id-1' }],
      fallidas: [{ indice: 1, mensaje: 'No se pudo crear esta pieza.' }],
    });

    render(<ContentPieceForm clients={crearClientes()} team={[]} defaultClientId="client-a" />);

    fireEvent.change(screen.getByPlaceholderText('Ej. Lanzamiento colección primavera'), {
      target: { value: 'Post semanal' },
    });
    fireEvent.click(screen.getByLabelText('Repetir esta pieza'));
    fireEvent.change(screen.getByLabelText('¿Cuántas veces?'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear como borrador' }));

    await waitFor(() => {
      expect(screen.getByText(/Se crearon 1 de 2 piezas/)).toBeInTheDocument();
    });
    expect(push).not.toHaveBeenCalledWith('/calendario');
  });
});
```

- [ ] **Step 2: Corre las pruebas y confirma que fallan**

Run: `npx vitest run tests/unit/components/ContentPieceForm.recurrencia.test.tsx`
Expected: FAIL — no existe el texto "Repetir esta pieza" ni el label "¿Cuántas veces?" en el componente todavía.

- [ ] **Step 3a: Agrega los imports y el estado nuevo**

En `components/ContentPieceForm.tsx`, cambia la línea 7:

```ts
import { createContentPiece, updateContentPiece } from '@/app/actions';
```

por:

```ts
import { createContentPiece, updateContentPiece } from '@/app/actions';
import { createContentPieces } from '@/app/actions-lote';
import { fechasRecurrentes } from '@/lib/recurrencia';
```

Después de la línea `const [assigneeId, setAssigneeId] = useState(piece?.assignee_id ?? '');` (línea 62), agrega:

```ts
  // "Repetir esta pieza" solo tiene sentido al crear (nunca al editar, piece es undefined) y no se
  // ofrece junto a ideaOrigen: convertir una idea produce una pieza, no una serie, y combinar los
  // dos casos no lo pidió nadie -- se deja fuera a propósito.
  const [repetir, setRepetir] = useState(false);
  const [diasSeleccionados, setDiasSeleccionados] = useState<number[]>([]);
  const [cantidadDeRepeticiones, setCantidadDeRepeticiones] = useState(2);

  function alternarRepetir() {
    setRepetir((valor) => {
      const activando = !valor;
      // Al activar por primera vez, se marca el día de la fecha ya elegida -- es el día que la
      // persona ya escogió a propósito. No se vuelve a sincronizar después: si cambia la fecha con
      // "Repetir" ya activo, reescribirle los días marcados sería sorprender una elección propia.
      if (activando && diasSeleccionados.length === 0) {
        setDiasSeleccionados([new Date(scheduledAt).getDay()]);
      }
      return activando;
    });
  }

  const DIAS_DE_LA_SEMANA: { valor: number; etiqueta: string }[] = [
    { valor: 1, etiqueta: 'L' },
    { valor: 2, etiqueta: 'M' },
    { valor: 3, etiqueta: 'M' },
    { valor: 4, etiqueta: 'J' },
    { valor: 5, etiqueta: 'V' },
    { valor: 6, etiqueta: 'S' },
    { valor: 0, etiqueta: 'D' },
  ];

  function alternarDia(dia: number) {
    setDiasSeleccionados((dias) => (dias.includes(dia) ? dias.filter((d) => d !== dia) : [...dias, dia]));
  }

  const fechasDeLaSerie =
    repetir && scheduledAt && diasSeleccionados.length > 0
      ? fechasRecurrentes(new Date(scheduledAt), diasSeleccionados, cantidadDeRepeticiones)
      : [];
```

- [ ] **Step 3b: Ramifica `handleSubmit` para el caso recurrente**

Dentro de `handleSubmit`, la rama `else` de creación empieza así (línea 96):

```ts
      } else {
        const id = await createContentPiece({
```

Reemplázala por (el resto de la rama `else`, desde `if (ideaOrigen)` en adelante, no cambia — solo se le agrega el `if` de recurrencia ANTES, con su propio `return`):

```ts
      } else if (repetir && fechasDeLaSerie.length > 1) {
        // Serie recurrente: un ítem por fecha calculada, mismos campos salvo scheduled_at. Sin
        // adjuntos (ver el porqué en el spec) y sin vínculo de idea -- "Repetir" no se ofrece
        // junto a ideaOrigen (Step 3c).
        const items = fechasDeLaSerie.map((fecha) => ({
          client_id: clientId,
          platform,
          format: contentFormat,
          title,
          copy_text: copyText,
          reference_link: referenceLink || undefined,
          scheduled_at: fecha.toISOString(),
          assignee_id: assigneeId || undefined,
        }));
        const resultado = await createContentPieces(items);
        if (resultado.fallidas.length > 0) {
          setError(
            `Se crearon ${resultado.creadas.length} de ${items.length} piezas. ` +
              `Fallaron: ${resultado.fallidas.map((f) => f.mensaje).join('; ')}`
          );
          return;
        }
        router.push('/calendario');
      } else {
        const id = await createContentPiece({
```

- [ ] **Step 3c: Esconde el bloque de adjuntos cuando "Repetir" está activo, y agrega la sección "Repetir esta pieza"**

La línea 281 hoy es:

```tsx
      {!piece && (
```

(el bloque de "Archivos (opcional)"). Cámbiala por:

```tsx
      {!piece && !repetir && (
```

Justo antes de esa línea (es decir, entre el bloque del campo "Enlace de referencia" que termina en la línea 279 y el `{!piece && (` que ahora es `{!piece && !repetir && (`), agrega la sección nueva — **solo si no hay `ideaOrigen`**, por lo dicho en el Step 3a:

```tsx
      {!piece && !ideaOrigen && (
        <div className="rounded-lg border border-slate-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={repetir} onChange={alternarRepetir} />
            Repetir esta pieza
          </label>
          {repetir && (
            <div className="mt-3 space-y-3">
              <div>
                <p className="mb-1 text-xs font-medium text-slate-600">Días de la semana</p>
                <div className="flex flex-wrap gap-1.5">
                  {DIAS_DE_LA_SEMANA.map((d) => (
                    <button
                      key={d.valor}
                      type="button"
                      onClick={() => alternarDia(d.valor)}
                      aria-pressed={diasSeleccionados.includes(d.valor)}
                      className={`h-8 w-8 rounded-full text-xs font-semibold ${
                        diasSeleccionados.includes(d.valor)
                          ? 'bg-brand-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {d.etiqueta}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="cantidad-de-repeticiones" className="mb-1 block text-xs font-medium text-slate-600">
                  ¿Cuántas veces?
                </label>
                <input
                  id="cantidad-de-repeticiones"
                  type="number"
                  min={1}
                  max={12}
                  value={cantidadDeRepeticiones}
                  onChange={(e) => setCantidadDeRepeticiones(Math.min(12, Math.max(1, Number(e.target.value) || 1)))}
                  className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                />
              </div>
              {fechasDeLaSerie.length > 0 && (
                <p className="text-xs text-slate-500">
                  Se crearán {fechasDeLaSerie.length} piezas:{' '}
                  {fechasDeLaSerie
                    .map((f) => f.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }))
                    .join(', ')}
                </p>
              )}
            </div>
          )}
        </div>
      )}

```

Nota sobre el `<label>` del checkbox: usa el texto "Repetir esta pieza" como hijo directo del `<label>` que envuelve el `<input>` — así `getByLabelText('Repetir esta pieza')` en la prueba lo encuentra sin necesitar `htmlFor`/`id`, igual que hace la prueba ya existente `controlDe()` con los `<select>` del formulario.

- [ ] **Step 4: Corre las pruebas y confirma que pasan**

Run: `npx vitest run tests/unit/components/ContentPieceForm.recurrencia.test.tsx`
Expected: PASS — 5 pruebas.

Después corre el archivo de pruebas ya existente para confirmar que no se rompió nada:

Run: `npx vitest run tests/unit/components/ContentPieceForm.test.tsx`
Expected: PASS — las pruebas que ya había siguen pasando sin cambios.

- [ ] **Step 5: Typecheck, lint y commit**

Run: `npm run typecheck && npm run lint`
Expected: exit 0.

```bash
git add components/ContentPieceForm.tsx tests/unit/components/ContentPieceForm.recurrencia.test.tsx
git commit -m "feat: repetir una pieza en días fijos de la semana al crearla

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `/piezas/nueva-multiple` — carga múltiple desde una tanda de archivos

**Files:**
- Create: `components/ContentPiecesMultipleForm.tsx`
- Create: `app/piezas/nueva-multiple/page.tsx`
- Modify: `components/CalendarBoard.tsx:144-150` (agrega el enlace a la pantalla nueva)
- Test: `tests/unit/components/ContentPiecesMultipleForm.test.tsx`

**Interfaces:**
- Consumes: `createContentPieces`, `ItemDeLote`, `ResultadoDeLote` de `@/app/actions-lote` (Task 2); `subirArchivoAPieza`, `validarArchivo`, `TAMANO_MAXIMO_BYTES`, `TIPOS_PERMITIDOS`, `formatearBytes` de `@/lib/attachments` (ya existen, sin cambios); `createClient` de `@/lib/supabase/client` (ya existe).
- Produces: nada que otra tarea de este plan consuma — es la última.

**Contexto exacto de `components/CalendarBoard.tsx` en este momento:**

```tsx
          {profile.role !== 'client' && (
            <Link
              href="/piezas/nueva"
              className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              + Nueva pieza
            </Link>
          )}
```

- [ ] **Step 1: Escribe las pruebas, en `tests/unit/components/ContentPiecesMultipleForm.test.tsx`**

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContentPiecesMultipleForm } from '@/components/ContentPiecesMultipleForm';
import { createContentPieces } from '@/app/actions-lote';
import { subirArchivoAPieza } from '@/lib/attachments';
import type { Client } from '@/types/database';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

vi.mock('@/app/actions-lote', () => ({
  createContentPieces: vi.fn(),
}));

vi.mock('@/lib/attachments', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/attachments')>();
  return { ...real, subirArchivoAPieza: vi.fn() };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } }),
}));

function crearClientes(): Client[] {
  return [
    {
      id: 'client-a',
      name: 'Cliente A',
      agency_id: 'agency-1',
      brand_name: 'Marca A',
      timezone: 'UTC',
      logo_url: null,
      notes: null,
      archived: false,
      billing_mode: 'paquete',
      created_by: null,
      created_at: '2026-01-01T00:00:00.000Z',
    },
  ];
}

function archivo(nombre: string): File {
  return new File(['contenido'], nombre, { type: 'image/png' });
}

function elegirArchivos(archivos: File[]) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: archivos } });
}

describe('ContentPiecesMultipleForm', () => {
  afterEach(() => vi.clearAllMocks());

  it('elegir 3 archivos muestra 3 filas para completar', () => {
    render(<ContentPiecesMultipleForm clients={crearClientes()} />);
    elegirArchivos([archivo('a.png'), archivo('b.png'), archivo('c.png')]);

    expect(screen.getByText('a.png')).toBeInTheDocument();
    expect(screen.getByText('b.png')).toBeInTheDocument();
    expect(screen.getByText('c.png')).toBeInTheDocument();
  });

  it('al enviar, llama a createContentPieces con un ítem por fila y sube cada archivo a su pieza por índice', async () => {
    vi.mocked(createContentPieces).mockResolvedValue({
      creadas: [
        { indice: 0, id: 'pieza-1' },
        { indice: 1, id: 'pieza-2' },
      ],
      fallidas: [],
    });
    vi.mocked(subirArchivoAPieza).mockResolvedValue(undefined);

    render(<ContentPiecesMultipleForm clients={crearClientes()} />);
    elegirArchivos([archivo('a.png'), archivo('b.png')]);

    const titulos = screen.getAllByLabelText('Título');
    fireEvent.change(titulos[0], { target: { value: 'Post A' } });
    fireEvent.change(titulos[1], { target: { value: 'Post B' } });

    fireEvent.click(screen.getByRole('button', { name: /Crear 2 piezas/ }));

    await waitFor(() => expect(createContentPieces).toHaveBeenCalledTimes(1));
    const items = vi.mocked(createContentPieces).mock.calls[0][0];
    expect(items[0].title).toBe('Post A');
    expect(items[1].title).toBe('Post B');

    await waitFor(() => expect(subirArchivoAPieza).toHaveBeenCalledTimes(2));
    const llamadaFilaA = vi.mocked(subirArchivoAPieza).mock.calls.find((c) => c[0].contentPieceId === 'pieza-1');
    const llamadaFilaB = vi.mocked(subirArchivoAPieza).mock.calls.find((c) => c[0].contentPieceId === 'pieza-2');
    expect(llamadaFilaA?.[0].file.name).toBe('a.png');
    expect(llamadaFilaB?.[0].file.name).toBe('b.png');
  });

  it('una fila fallida muestra su error, y la fila que sí se creó sube su archivo igual', async () => {
    vi.mocked(createContentPieces).mockResolvedValue({
      creadas: [{ indice: 0, id: 'pieza-1' }],
      fallidas: [{ indice: 1, mensaje: 'Esa marca no existe o no pertenece a tu agencia.' }],
    });
    vi.mocked(subirArchivoAPieza).mockResolvedValue(undefined);

    render(<ContentPiecesMultipleForm clients={crearClientes()} />);
    elegirArchivos([archivo('a.png'), archivo('b.png')]);
    const titulos = screen.getAllByLabelText('Título');
    fireEvent.change(titulos[0], { target: { value: 'Post A' } });
    fireEvent.change(titulos[1], { target: { value: 'Post B' } });

    fireEvent.click(screen.getByRole('button', { name: /Crear 2 piezas/ }));

    await waitFor(() => {
      expect(screen.getByText('Esa marca no existe o no pertenece a tu agencia.')).toBeInTheDocument();
    });
    expect(subirArchivoAPieza).toHaveBeenCalledTimes(1);
    expect(vi.mocked(subirArchivoAPieza).mock.calls[0][0].contentPieceId).toBe('pieza-1');
  });

  it('elegir más de 10 archivos muestra un error y no arma filas', () => {
    render(<ContentPiecesMultipleForm clients={crearClientes()} />);
    const once = Array.from({ length: 11 }, (_, i) => archivo(`f${i}.png`));

    elegirArchivos(once);

    expect(screen.getByText(/hasta 10 archivos/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Título')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Corre las pruebas y confirma que fallan**

Run: `npx vitest run tests/unit/components/ContentPiecesMultipleForm.test.tsx`
Expected: FAIL — `Cannot find module '@/components/ContentPiecesMultipleForm'`.

- [ ] **Step 3a: Escribe `components/ContentPiecesMultipleForm.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Client, ContentFormat, PlatformType } from '@/types/database';
import { FORMAT_LABELS, PLATFORM_LABELS } from '@/types/database';
import { createContentPieces } from '@/app/actions-lote';
import { createClient } from '@/lib/supabase/client';
import { TAMANO_MAXIMO_BYTES, TIPOS_PERMITIDOS, formatearBytes, subirArchivoAPieza, validarArchivo } from '@/lib/attachments';

const TOPE_DE_ARCHIVOS = 10;

function ahoraLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface FilaDeLote {
  archivo: File;
  title: string;
  copyText: string;
  scheduledAt: string;
}

type EstadoDeFila = { tipo: 'pendiente' } | { tipo: 'creada'; id: string } | { tipo: 'error'; mensaje: string };

/**
 * Carga múltiple: de una tanda de archivos (ej. una sesión de fotos) crea una pieza independiente
 * por archivo, con cliente/plataforma/formato compartidos y título/copy/fecha por fila.
 *
 * Sin link de referencia ni responsable aquí -- quien los necesite los agrega después editando esa
 * pieza. Una fila con diez campos ya es densa; recortar los dos menos usados es lo que la mantiene
 * legible. Ver docs/superpowers/specs/2026-09-29-creacion-rapida-de-piezas-design.md.
 */
export function ContentPiecesMultipleForm({ clients }: { clients: Client[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [platform, setPlatform] = useState<PlatformType>('instagram');
  const [contentFormat, setContentFormat] = useState<ContentFormat>('post');
  const [filas, setFilas] = useState<FilaDeLote[]>([]);
  const [errorDeArchivos, setErrorDeArchivos] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [estados, setEstados] = useState<EstadoDeFila[]>([]);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);

  function elegirArchivos(lista: FileList | null) {
    const archivos = Array.from(lista ?? []);
    setErrorDeArchivos(null);
    setEstados([]);
    if (archivos.length === 0) {
      setFilas([]);
      return;
    }
    if (archivos.length > TOPE_DE_ARCHIVOS) {
      setErrorDeArchivos(`Elige hasta ${TOPE_DE_ARCHIVOS} archivos por tanda.`);
      setFilas([]);
      return;
    }
    for (const a of archivos) {
      const problema = validarArchivo(a);
      if (problema) {
        setErrorDeArchivos(problema);
        setFilas([]);
        return;
      }
    }
    setFilas(archivos.map((archivo) => ({ archivo, title: '', copyText: '', scheduledAt: ahoraLocal() })));
  }

  function actualizarFila(indice: number, cambios: Partial<Omit<FilaDeLote, 'archivo'>>) {
    setFilas((previas) => previas.map((f, i) => (i === indice ? { ...f, ...cambios } : f)));
  }

  const puedeEnviar = filas.length > 0 && filas.every((f) => f.title.trim().length > 0) && !!clientId;

  async function alEnviar(e: React.FormEvent) {
    e.preventDefault();
    if (!puedeEnviar) return;

    setEnviando(true);
    setErrorGeneral(null);
    setEstados(filas.map(() => ({ tipo: 'pendiente' })));

    const items = filas.map((f) => ({
      client_id: clientId,
      platform,
      format: contentFormat,
      title: f.title,
      copy_text: f.copyText,
      scheduled_at: new Date(f.scheduledAt).toISOString(),
    }));

    try {
      const resultado = await createContentPieces(items);
      const nuevosEstados: EstadoDeFila[] = filas.map(() => ({ tipo: 'pendiente' }));
      for (const f of resultado.fallidas) nuevosEstados[f.indice] = { tipo: 'error', mensaje: f.mensaje };
      for (const c of resultado.creadas) nuevosEstados[c.indice] = { tipo: 'creada', id: c.id };
      setEstados(nuevosEstados);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      for (const c of resultado.creadas) {
        try {
          await subirArchivoAPieza({
            supabase,
            clientId,
            contentPieceId: c.id,
            file: filas[c.indice].archivo,
            uploadedBy: user?.id ?? null,
            onProgress: () => {},
          });
        } catch (err) {
          // La pieza ya se creó (está en resultado.creadas); solo falló subirle el archivo. Se
          // deja como "creada" -- el mismo criterio que ContentPieceForm usa para una sola pieza:
          // se puede subir el archivo después desde la ficha, no hace falta bloquear la pantalla.
          console.error('[ContentPiecesMultipleForm] no se pudo subir el archivo de la fila', c.indice, err);
        }
      }
    } catch (err) {
      setErrorGeneral(err instanceof Error ? err.message : 'No pudimos crear las piezas.');
    } finally {
      setEnviando(false);
    }
  }

  const yaHayResultado = estados.some((e) => e.tipo !== 'pendiente');

  return (
    <form onSubmit={alEnviar} className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      {clients.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Aún no tienes clientes. Crea uno en la sección Clientes antes de planificar contenido.
        </p>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Cliente / Marca</label>
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          required
        >
          <option value="" disabled>
            Selecciona un cliente
          </option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.brand_name} ({c.name})
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Plataforma</label>
          <select value={platform} onChange={(e) => setPlatform(e.target.value as PlatformType)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {Object.entries(PLATFORM_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Formato</label>
          <select value={contentFormat} onChange={(e) => setContentFormat(e.target.value as ContentFormat)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {Object.entries(FORMAT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Archivos (hasta {TOPE_DE_ARCHIVOS})</label>
        <input
          type="file"
          multiple
          accept={TIPOS_PERMITIDOS.join(',')}
          disabled={enviando}
          onChange={(e) => elegirArchivos(e.target.files)}
          className="w-full text-sm"
        />
        <p className="mt-1 text-xs text-slate-400">Hasta {formatearBytes(TAMANO_MAXIMO_BYTES)} por archivo.</p>
        {errorDeArchivos && <p className="mt-1 text-xs text-red-700">{errorDeArchivos}</p>}
      </div>

      {filas.length > 0 && (
        <div className="space-y-3">
          {filas.map((fila, i) => {
            const estado = estados[i];
            return (
              <div key={i} className="rounded-lg border border-slate-200 p-3">
                <p className="mb-2 truncate text-xs font-medium text-slate-500">{fila.archivo.name}</p>
                {estado?.tipo === 'creada' ? (
                  <p className="text-sm text-green-700">✓ Creada</p>
                ) : estado?.tipo === 'error' ? (
                  <p className="text-sm text-red-700">{estado.mensaje}</p>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div>
                      <label htmlFor={`titulo-${i}`} className="mb-1 block text-xs font-medium text-slate-600">
                        Título
                      </label>
                      <input
                        id={`titulo-${i}`}
                        type="text"
                        required
                        disabled={enviando}
                        value={fila.title}
                        onChange={(e) => actualizarFila(i, { title: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label htmlFor={`copy-${i}`} className="mb-1 block text-xs font-medium text-slate-600">
                        Copy
                      </label>
                      <input
                        id={`copy-${i}`}
                        type="text"
                        disabled={enviando}
                        value={fila.copyText}
                        onChange={(e) => actualizarFila(i, { copyText: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label htmlFor={`fecha-${i}`} className="mb-1 block text-xs font-medium text-slate-600">
                        Fecha
                      </label>
                      <input
                        id={`fecha-${i}`}
                        type="datetime-local"
                        disabled={enviando}
                        value={fila.scheduledAt}
                        onChange={(e) => actualizarFila(i, { scheduledAt: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {errorGeneral && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorGeneral}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={() => router.back()} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
          {yaHayResultado ? 'Volver' : 'Cancelar'}
        </button>
        {!yaHayResultado && (
          <button
            type="submit"
            disabled={enviando || !puedeEnviar}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {enviando ? 'Creando…' : `Crear ${filas.length} piezas`}
          </button>
        )}
      </div>
    </form>
  );
}
```

- [ ] **Step 3b: Escribe `app/piezas/nueva-multiple/page.tsx`**

```tsx
import { requireAgency } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/AppShell';
import { ContentPiecesMultipleForm } from '@/components/ContentPiecesMultipleForm';
import type { Client } from '@/types/database';

export default async function NuevaPiezaMultiplePage() {
  const profile = await requireAgency();
  const supabase = await createClient();
  const { data: clients } = await supabase.from('clients').select('*').eq('archived', false).order('name');

  return (
    <AppShell profile={profile}>
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-4 text-xl font-semibold text-slate-900">Varias piezas de una tanda</h1>
        <ContentPiecesMultipleForm clients={(clients ?? []) as Client[]} />
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 3c: Agrega el enlace en `components/CalendarBoard.tsx`**

Reemplaza el bloque:

```tsx
          {profile.role !== 'client' && (
            <Link
              href="/piezas/nueva"
              className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              + Nueva pieza
            </Link>
          )}
```

por:

```tsx
          {profile.role !== 'client' && (
            <div className="flex gap-2">
              <Link
                href="/piezas/nueva"
                className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-700"
              >
                + Nueva pieza
              </Link>
              <Link
                href="/piezas/nueva-multiple"
                className="rounded-lg bg-white px-3.5 py-2 text-sm font-semibold text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50"
              >
                + Varias piezas
              </Link>
            </div>
          )}
```

- [ ] **Step 4: Corre las pruebas y confirma que pasan**

Run: `npx vitest run tests/unit/components/ContentPiecesMultipleForm.test.tsx`
Expected: PASS — 4 pruebas.

- [ ] **Step 5: Typecheck, lint y commit**

Run: `npm run typecheck && npm run lint`
Expected: exit 0.

```bash
git add components/ContentPiecesMultipleForm.tsx app/piezas/nueva-multiple/page.tsx components/CalendarBoard.tsx tests/unit/components/ContentPiecesMultipleForm.test.tsx
git commit -m "feat: crear varias piezas de una tanda de archivos

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Al terminar las 4 tareas

Corre el gate completo una vez más sobre todo el árbol:

```bash
npm run typecheck && npm run lint && npm run test
```

Expected: exit 0 en los tres. `npm run test:integration` no debería haberse afectado (ninguna tarea tocó SQL ni RLS), pero es honesto correrlo también si hay tiempo — ninguna tarea de este plan debería cambiar su resultado.
