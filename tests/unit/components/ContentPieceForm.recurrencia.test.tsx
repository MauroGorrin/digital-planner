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
