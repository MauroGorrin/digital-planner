import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContentPieceForm } from '@/components/ContentPieceForm';
import type { Client } from '@/types/database';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/app/actions', () => ({
  createContentPiece: vi.fn(),
  updateContentPiece: vi.fn(),
}));

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
      brand_name: 'Marca A',
      timezone: 'UTC',
      logo_url: null,
      notes: null,
      archived: false,
      created_by: null,
      created_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'client-b',
      name: 'Cliente B',
      brand_name: 'Marca B',
      timezone: 'UTC',
      logo_url: null,
      notes: null,
      archived: false,
      created_by: null,
      created_at: '2026-01-01T00:00:00.000Z',
    },
  ];
}

// El <select> de marca no tiene htmlFor/id asociado a su <label>, así que getByLabelText no
// funciona aquí: se ubica por el texto de la etiqueta y se busca el control dentro de su mismo
// contenedor, tal como lo vería alguien leyendo la pantalla de arriba hacia abajo.
function controlDe(etiqueta: string): HTMLElement {
  const contenedor = screen.getByText(etiqueta).closest('div');
  if (!contenedor) throw new Error(`No se encontró el contenedor de "${etiqueta}"`);
  return within(contenedor).getByRole('combobox');
}

describe('ContentPieceForm — origen desde una idea', () => {
  it('con ideaOrigen: prellena título, copy, plataforma y formato; deshabilita la marca y explica por qué', () => {
    render(
      <ContentPieceForm
        clients={crearClientes()}
        team={[]}
        defaultClientId="client-a"
        ideaOrigen={{
          id: 'idea-1',
          client_id: 'client-a',
          title: 'Serie de reels con testimonios',
          description: 'Tres reels cortos con clientes reales.',
          suggested_platform: 'tiktok',
          suggested_format: 'reel',
        }}
      />
    );

    expect(screen.getByPlaceholderText('Ej. Lanzamiento colección primavera')).toHaveValue(
      'Serie de reels con testimonios'
    );
    expect(screen.getByPlaceholderText('Escribe el texto de la publicación…')).toHaveValue(
      'Tres reels cortos con clientes reales.'
    );
    expect(controlDe('Plataforma')).toHaveValue('tiktok');
    expect(controlDe('Formato')).toHaveValue('reel');
    expect(controlDe('Cliente / Marca')).toBeDisabled();
    expect(
      screen.getByText((_, elemento) =>
        elemento?.tagName === 'P' &&
        (elemento.textContent ?? '').includes('Esta pieza viene de la idea') &&
        (elemento.textContent ?? '').includes('Serie de reels con testimonios') &&
        (elemento.textContent ?? '').includes('su marca queda fija, tomada de esa idea')
      )
    ).toBeInTheDocument();
  });

  it('sin ideaOrigen: la marca queda habilitada y no hay nada prellenado desde una idea', () => {
    render(<ContentPieceForm clients={crearClientes()} team={[]} />);

    expect(controlDe('Cliente / Marca')).toBeEnabled();
    expect(screen.getByPlaceholderText('Ej. Lanzamiento colección primavera')).toHaveValue('');
    expect(screen.getByPlaceholderText('Escribe el texto de la publicación…')).toHaveValue('');
    expect(controlDe('Plataforma')).toHaveValue('instagram');
    expect(controlDe('Formato')).toHaveValue('post');
    expect(screen.queryByText(/su marca queda fija, tomada de esa idea/)).not.toBeInTheDocument();
  });
});
