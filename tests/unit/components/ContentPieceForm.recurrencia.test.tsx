import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContentPieceForm } from '@/components/ContentPieceForm';
import { createContentPieces } from '@/app/actions-lote';
import { fechasRecurrentes } from '@/lib/recurrencia';
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

// ContentPieceForm importa vincularIdeaAPieza incondicionalmente. Sin este mock, Vitest intenta
// cargar el módulo real de @/app/actions-ideas, que a su vez importa @/lib/supabase/server (el
// paquete "server-only" no resuelve en jsdom) — el mismo motivo por el que
// ContentPieceForm.test.tsx ya lo mockea.
vi.mock('@/app/actions-ideas', () => ({
  vincularIdeaAPieza: vi.fn(),
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

  it('elegir un archivo inválido y luego activar "Repetir" no bloquea el envío con un error sobre un archivo que ya no se ve', async () => {
    vi.mocked(createContentPieces).mockResolvedValue({
      creadas: [
        { indice: 0, id: 'id-1' },
        { indice: 1, id: 'id-2' },
      ],
      fallidas: [],
    });

    const { container } = render(<ContentPieceForm clients={crearClientes()} team={[]} defaultClientId="client-a" />);

    fireEvent.change(screen.getByPlaceholderText('Ej. Lanzamiento colección primavera'), {
      target: { value: 'Post semanal' },
    });

    // Un archivo de un tipo no permitido: si `archivos` no se limpia al activar "Repetir", la
    // validación al inicio de handleSubmit lo sigue viendo (aunque la sección de archivos ya esté
    // oculta) y bloquea el envío con un mensaje sobre un archivo que la persona ya no puede ver
    // ni quitar del formulario.
    const inputArchivo = container.querySelector('input[type="file"]') as HTMLInputElement;
    const archivoInvalido = new File(['contenido'], 'nota.txt', { type: 'text/plain' });
    fireEvent.change(inputArchivo, { target: { files: [archivoInvalido] } });

    fireEvent.click(screen.getByLabelText('Repetir esta pieza'));
    fireEvent.change(screen.getByLabelText('¿Cuántas veces?'), { target: { value: '2' } });

    fireEvent.click(screen.getByRole('button', { name: 'Crear como borrador' }));

    await waitFor(() => expect(createContentPieces).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/no permitido/i)).not.toBeInTheDocument();
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

  it('activar "Repetir" con la fecha vacía no marca ningún día ni muestra "Invalid Date" en el resumen', () => {
    const { container } = render(<ContentPieceForm clients={crearClientes()} team={[]} defaultClientId="client-a" />);

    const fechaInput = container.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(fechaInput, { target: { value: '' } });

    fireEvent.click(screen.getByLabelText('Repetir esta pieza'));

    const botonesDeDia = Array.from(container.querySelectorAll('button[aria-pressed]'));
    expect(botonesDeDia.every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Se crearán/)).not.toBeInTheDocument();
  });

  it('cambiar los días marcados (no solo la cantidad) cambia las fechas que se envían', async () => {
    vi.mocked(createContentPieces).mockResolvedValue({
      creadas: [
        { indice: 0, id: 'id-1' },
        { indice: 1, id: 'id-2' },
      ],
      fallidas: [],
    });

    const { container } = render(<ContentPieceForm clients={crearClientes()} team={[]} defaultClientId="client-a" />);

    fireEvent.change(screen.getByPlaceholderText('Ej. Lanzamiento colección primavera'), {
      target: { value: 'Post semanal' },
    });
    fireEvent.click(screen.getByLabelText('Repetir esta pieza'));
    fireEvent.change(screen.getByLabelText('¿Cuántas veces?'), { target: { value: '2' } });

    const fechaInput = container.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    const fechaBase = new Date(fechaInput.value);
    const diaOriginal = fechaBase.getDay();
    const diaNuevo = (diaOriginal + 2) % 7;

    // Orden fijo en que el componente pinta los botones de día (DIAS_DE_LA_SEMANA: L M M J V S D,
    // que en números de Date#getDay() es [1,2,3,4,5,6,0]). Son los únicos botones con aria-pressed
    // en el formulario, así que se ubican por posición en ese orden.
    const ORDEN_DE_DIAS = [1, 2, 3, 4, 5, 6, 0];
    const botonesDeDia = Array.from(container.querySelectorAll('button[aria-pressed]'));
    fireEvent.click(botonesDeDia[ORDEN_DE_DIAS.indexOf(diaOriginal)]); // desmarca el día por defecto
    fireEvent.click(botonesDeDia[ORDEN_DE_DIAS.indexOf(diaNuevo)]); // marca uno distinto

    fireEvent.click(screen.getByRole('button', { name: 'Crear como borrador' }));

    await waitFor(() => expect(createContentPieces).toHaveBeenCalledTimes(1));
    const items = vi.mocked(createContentPieces).mock.calls[0][0];
    const esperadas = fechasRecurrentes(fechaBase, [diaNuevo], 2);
    expect(items.map((i) => i.scheduled_at)).toEqual(esperadas.map((f) => f.toISOString()));
  });

  it('si createContentPieces devuelve alguna fila fallida, nombra la fecha que falló, no navega, refresca y no deja reenviar', async () => {
    vi.mocked(createContentPieces).mockResolvedValue({
      creadas: [{ indice: 0, id: 'id-1' }],
      fallidas: [{ indice: 1, mensaje: 'No se pudo crear esta pieza.' }],
    });

    const { container } = render(<ContentPieceForm clients={crearClientes()} team={[]} defaultClientId="client-a" />);

    fireEvent.change(screen.getByPlaceholderText('Ej. Lanzamiento colección primavera'), {
      target: { value: 'Post semanal' },
    });
    fireEvent.click(screen.getByLabelText('Repetir esta pieza'));
    fireEvent.change(screen.getByLabelText('¿Cuántas veces?'), { target: { value: '2' } });

    // Se recalcula la misma serie que arma el componente (misma fecha base, mismo día de semana,
    // misma cantidad) para saber cómo debería verse formateada la segunda fecha -- la que el
    // resultado mockeado marca como fallida (índice 1) -- sin hardcodear "hoy".
    const fechaInput = container.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    const fechaBase = new Date(fechaInput.value);
    const fechasEsperadas = fechasRecurrentes(fechaBase, [fechaBase.getDay()], 2);
    const fechaFallidaEsperada = fechasEsperadas[1].toLocaleDateString('es-MX', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Crear como borrador' }));

    let bloqueError: HTMLElement;
    await waitFor(() => {
      bloqueError = screen.getByText(/Se crearon 1 de 2 piezas/);
      expect(bloqueError).toBeInTheDocument();
    });
    // La fecha real, no solo el índice ni el mensaje genérico repetido sin contexto. Se compara
    // dentro del bloque de error (no con getByText a secas) porque el mismo texto de fecha
    // también aparece en el resumen "Se crearán 2 piezas: …" de más arriba.
    expect(bloqueError!.textContent).toContain(fechaFallidaEsperada);
    expect(push).not.toHaveBeenCalledWith('/calendario');
    expect(refresh).toHaveBeenCalled();
    // El botón desaparece: reenviar la misma serie duplicaría la fecha que sí se creó (índice 0).
    expect(screen.queryByRole('button', { name: 'Crear como borrador' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ir al calendario' })).toBeInTheDocument();
  });
});
