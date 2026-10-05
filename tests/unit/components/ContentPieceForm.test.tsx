import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContentPieceForm } from '@/components/ContentPieceForm';
import { createContentPiece } from '@/app/actions';
import { vincularIdeaAPieza } from '@/app/actions-ideas';
import { subirArchivoAPieza } from '@/lib/attachments';
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

vi.mock('@/app/actions-ideas', () => ({
  vincularIdeaAPieza: vi.fn(),
}));

// ContentPieceForm importa createContentPieces incondicionalmente (para el camino de "Repetir",
// que este archivo no ejercita -- eso lo cubre ContentPieceForm.recurrencia.test.tsx). Sin este
// mock, Vitest carga el módulo real de @/app/actions-lote, que ahora importa requireAgency de
// @/lib/auth, que a su vez importa @/lib/supabase/server: el mismo problema de "server-only" que
// el comentario de arriba ya describe para @/app/actions-ideas.
vi.mock('@/app/actions-lote', () => ({
  createContentPieces: vi.fn(),
}));

// Se mantienen las validaciones y constantes reales (TIPOS_PERMITIDOS, validarArchivo, etc.) y
// solo se sustituye subirArchivoAPieza, que dispara una subida real por XHR — exactamente lo que
// una prueba unitaria no debe hacer.
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
      slug: 'marca-prueba',
      timezone: 'UTC',
      logo_url: null,
      notes: null,
      archived: false,
      billing_mode: 'paquete',
      created_by: null,
      created_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'client-b',
      name: 'Cliente B',
      agency_id: 'agency-1',
      brand_name: 'Marca B',
      slug: 'marca-prueba-b',
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

// El <select> de marca no tiene htmlFor/id asociado a su <label>, así que getByLabelText no
// funciona aquí: se ubica por el texto de la etiqueta y se busca el control dentro de su mismo
// contenedor, tal como lo vería alguien leyendo la pantalla de arriba hacia abajo.
function controlDe(etiqueta: string): HTMLElement {
  const contenedor = screen.getByText(etiqueta).closest('div');
  if (!contenedor) throw new Error(`No se encontró el contenedor de "${etiqueta}"`);
  return within(contenedor).getByRole('combobox');
}

const ideaOrigenBase = {
  id: 'idea-1',
  client_id: 'client-a',
  title: 'Serie de reels con testimonios',
  description: 'Tres reels cortos con clientes reales.',
  suggested_platform: 'tiktok' as const,
  suggested_format: 'reel' as const,
};

describe('ContentPieceForm — origen desde una idea', () => {
  afterEach(() => vi.clearAllMocks());


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

describe('ContentPieceForm — reintento del vínculo idea→pieza tras un fallo', () => {
  afterEach(() => vi.clearAllMocks());

  async function crearPiezaYFallarVinculo() {
    vi.mocked(createContentPiece).mockResolvedValue('pieza-x');
    vi.mocked(vincularIdeaAPieza).mockRejectedValueOnce(new Error('No se pudo guardar el vínculo.'));

    render(
      <ContentPieceForm
        clients={crearClientes()}
        team={[]}
        defaultClientId="client-a"
        ideaOrigen={ideaOrigenBase}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Crear como borrador' }));

    await waitFor(() => {
      expect(screen.getByText('No se pudo guardar el vínculo.')).toBeInTheDocument();
    });
  }

  it('el botón de reintento aparece cuando la pieza se creó, algo posterior falló y hay una idea de origen', async () => {
    await crearPiezaYFallarVinculo();

    expect(screen.getByRole('button', { name: 'Reintentar vínculo con la idea' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ir a la pieza para continuar desde ahí' })).toBeInTheDocument();
  });

  it('el botón de reintento no aparece cuando el fallo posterior no viene de una idea de origen', async () => {
    vi.mocked(createContentPiece).mockResolvedValue('pieza-y');
    vi.mocked(subirArchivoAPieza).mockRejectedValueOnce(
      new Error('Se cortó la conexión durante la subida.')
    );

    const { container } = render(
      <ContentPieceForm clients={crearClientes()} team={[]} defaultClientId="client-a" />
    );

    fireEvent.change(screen.getByPlaceholderText('Ej. Lanzamiento colección primavera'), {
      target: { value: 'Pieza sin idea' },
    });
    const inputArchivo = container.querySelector('input[type="file"]') as HTMLInputElement;
    const archivo = new File(['contenido'], 'foto.png', { type: 'image/png' });
    fireEvent.change(inputArchivo, { target: { files: [archivo] } });

    fireEvent.click(screen.getByRole('button', { name: 'Crear como borrador' }));

    await waitFor(() => {
      expect(screen.getByText('Se cortó la conexión durante la subida.')).toBeInTheDocument();
    });

    // El banner ámbar sí aparece (la pieza se creó), pero sin ideaOrigen el reintento no tiene
    // sentido: no hay vínculo que reintentar, así que el botón no debe existir.
    expect(screen.getByText(/La pieza sí se creó/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar vínculo con la idea' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ir a la pieza para continuar desde ahí' })).toBeInTheDocument();
  });

  it('el reintento llama a vincularIdeaAPieza con el id de la idea y el de la pieza, y navega al éxito', async () => {
    await crearPiezaYFallarVinculo();
    vi.mocked(vincularIdeaAPieza).mockResolvedValueOnce(undefined);

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar vínculo con la idea' }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/piezas/pieza-x');
    });
    expect(vincularIdeaAPieza).toHaveBeenCalledTimes(2);
    expect(vincularIdeaAPieza).toHaveBeenNthCalledWith(2, 'idea-1', 'pieza-x');
  });

  it('si el reintento vuelve a fallar, muestra el error nuevo y mantiene el escape hatch "Ir a la pieza"', async () => {
    await crearPiezaYFallarVinculo();
    vi.mocked(vincularIdeaAPieza).mockRejectedValueOnce(new Error('La idea ya no está en aprobada.'));

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar vínculo con la idea' }));

    await waitFor(() => {
      expect(screen.getByText('La idea ya no está en aprobada.')).toBeInTheDocument();
    });
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Ir a la pieza para continuar desde ahí' })).toBeInTheDocument();
  });
});
