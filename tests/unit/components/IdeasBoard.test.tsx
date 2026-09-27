import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdeasBoard } from '@/components/IdeasBoard';
import type { Idea, Profile } from '@/types/database';
import { aprobarIdea } from '@/app/actions-ideas';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/app/actions-ideas', () => ({
  aprobarIdea: vi.fn().mockResolvedValue(undefined),
  descartarIdea: vi.fn().mockResolvedValue(undefined),
  enviarIdeaAlCliente: vi.fn().mockResolvedValue(undefined),
  pedirCorreccionDelCliente: vi.fn().mockResolvedValue(undefined),
  pedirCorreccionInterna: vi.fn().mockResolvedValue(undefined),
  reenviarIdea: vi.fn().mockResolvedValue(undefined),
}));

function crearPerfil(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'profile-cliente',
    full_name: 'Carla Cliente',
    email: 'carla@cliente.test',
    role: 'client',
    phone: null,
    avatar_url: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function crearIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    id: 'idea-1',
    client_id: 'client-a',
    title: 'Idea de marca A',
    description: 'Descripción de la idea.',
    reference_link: null,
    suggested_platform: null,
    suggested_format: null,
    status: 'pendiente_cliente',
    created_by: null,
    content_piece_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    clients: { id: 'client-a', name: 'Cliente A', brand_name: 'Marca A' },
    ...overrides,
  };
}

function renderBoard({
  profile = crearPerfil(),
  ideas,
  marcasDondeEsContacto = [],
}: {
  profile?: Profile;
  ideas: Idea[];
  marcasDondeEsContacto?: string[];
}) {
  return render(
    <IdeasBoard
      profile={profile}
      ideas={ideas}
      clients={[]}
      marcasDondeEsContacto={marcasDondeEsContacto}
      historialPorIdea={{}}
    />
  );
}

// Busca la tarjeta (contenedor) de una idea a partir de su título, para poder acotar (within)
// las consultas de botones/errores a esa tarjeta y no a la página entera.
function tarjetaDe(titulo: string): HTMLElement {
  const nodo = screen.getByText(titulo).closest('div');
  if (!nodo) throw new Error(`No se encontró la tarjeta de "${titulo}"`);
  return nodo as HTMLElement;
}

describe('IdeasBoard — acciones calculadas por marca', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('un cliente contacto de la marca A ve acciones en la idea de A pero no en la de B', () => {
    const ideaA = crearIdea({ id: 'idea-a', client_id: 'client-a', title: 'Idea de marca A', status: 'pendiente_cliente' });
    const ideaB = crearIdea({
      id: 'idea-b',
      client_id: 'client-b',
      title: 'Idea de marca B',
      status: 'pendiente_cliente',
      clients: { id: 'client-b', name: 'Cliente B', brand_name: 'Marca B' },
    });

    renderBoard({ ideas: [ideaA, ideaB], marcasDondeEsContacto: ['client-a'] });

    expect(within(tarjetaDe('Idea de marca A')).getByRole('button', { name: 'Aprobar' })).toBeInTheDocument();
    expect(within(tarjetaDe('Idea de marca B')).queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
  });

  it('una acción con nota mantiene el botón de confirmación deshabilitado hasta que hay texto real', () => {
    const idea = crearIdea({ status: 'pendiente_cliente' });
    renderBoard({ ideas: [idea], marcasDondeEsContacto: ['client-a'] });

    fireEvent.click(screen.getByRole('button', { name: 'Pedir cambios' }));

    const textarea = screen.getByPlaceholderText('Escribe una nota…');
    const botonConfirmar = screen.getByRole('button', { name: 'Pedir cambios' });

    expect(botonConfirmar).toBeDisabled();

    fireEvent.change(textarea, { target: { value: '   ' } });
    expect(botonConfirmar).toBeDisabled();

    fireEvent.change(textarea, { target: { value: 'Cambien el copy del segundo párrafo.' } });
    expect(botonConfirmar).toBeEnabled();
  });

  it('un error de una acción aparece dentro de la tarjeta de la idea que falló, no en otra', async () => {
    const ideaA = crearIdea({ id: 'idea-a', client_id: 'client-a', title: 'Idea de marca A', status: 'pendiente_cliente' });
    const ideaB = crearIdea({
      id: 'idea-b',
      client_id: 'client-b',
      title: 'Idea de marca B',
      status: 'pendiente_cliente',
      clients: { id: 'client-b', name: 'Cliente B', brand_name: 'Marca B' },
    });

    vi.mocked(aprobarIdea).mockImplementation((id: string) =>
      id === 'idea-b' ? Promise.reject(new Error('No se pudo aprobar la idea de marca B.')) : Promise.resolve()
    );

    renderBoard({ ideas: [ideaA, ideaB], marcasDondeEsContacto: ['client-a', 'client-b'] });

    fireEvent.click(within(tarjetaDe('Idea de marca B')).getByRole('button', { name: 'Aprobar' }));

    await waitFor(() => {
      expect(within(tarjetaDe('Idea de marca B')).getByText('No se pudo aprobar la idea de marca B.')).toBeInTheDocument();
    });

    expect(within(tarjetaDe('Idea de marca A')).queryByText('No se pudo aprobar la idea de marca B.')).not.toBeInTheDocument();
    expect(screen.getAllByText('No se pudo aprobar la idea de marca B.')).toHaveLength(1);
  });

  it('mientras una acción está en vuelo, los botones de esa tarjeta se deshabilitan', async () => {
    let liberar!: () => void;
    const pendiente = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    vi.mocked(aprobarIdea).mockReturnValue(pendiente);

    const idea = crearIdea({ status: 'pendiente_cliente' });
    renderBoard({ ideas: [idea], marcasDondeEsContacto: ['client-a'] });

    const botonAprobar = screen.getByRole('button', { name: 'Aprobar' });
    fireEvent.click(botonAprobar);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Aprobar' })).toBeDisabled();
    });
    expect(screen.getByRole('button', { name: 'Pedir cambios' })).toBeDisabled();

    liberar();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Aprobar' })).toBeEnabled();
    });
  });
});
