import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PendingList } from '@/components/PendingList';
import type { ContentPiece, Idea, Profile } from '@/types/database';

function crearPerfil(overrides: Partial<Profile> = {}): Profile {
  const rol = overrides.role ?? 'agency_admin';
  return {
    id: 'profile-1',
    full_name: 'Ana Agencia',
    email: 'ana@agencia.test',
    role: rol,
    // Un contacto de cliente no pertenece a ninguna agencia: se conecta por client_contacts.
    // El personal de agencia siempre pertenece a una. Es la misma regla que amarra el check
    // profiles_agency_id_rol_check de 0009_agencias.sql, y se deriva del rol para que un
    // override de `role` en una prueba no fabrique un perfil imposible.
    agency_id: rol === 'client' ? null : 'agency-1',
    phone: null,
    avatar_url: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function crearIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    id: 'idea-1',
    client_id: 'client-1',
    title: 'Serie de reels con testimonios',
    description: 'Tres reels cortos con clientes reales.',
    reference_link: null,
    suggested_platform: null,
    suggested_format: null,
    status: 'pendiente_cliente',
    created_by: null,
    content_piece_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    clients: { id: 'client-1', name: 'Cliente Uno', brand_name: 'Marca Uno' },
    ...overrides,
  };
}

function crearPieza(overrides: Partial<ContentPiece> = {}): ContentPiece {
  return {
    id: 'pieza-1',
    client_id: 'client-1',
    platform: 'instagram',
    format: 'post',
    title: 'Post de lanzamiento',
    copy_text: 'Copy de prueba',
    reference_link: null,
    scheduled_at: '2026-10-01T15:00:00.000Z',
    status: 'pendiente_revision',
    assignee_id: null,
    created_by: null,
    duplicated_from: null,
    cancelled_reason: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    clients: { id: 'client-1', name: 'Cliente Uno', brand_name: 'Marca Uno', timezone: 'UTC' },
    ...overrides,
  };
}

describe('PendingList — sección de ideas según el rol', () => {
  it('como cliente: título correcto, solo lista pendiente_cliente y no muestra columna de marca', () => {
    const ideaPendiente = crearIdea({ id: 'idea-pendiente', title: 'Idea pendiente del cliente', status: 'pendiente_cliente' });
    const ideaEnCorreccion = crearIdea({ id: 'idea-correccion', title: 'Idea en corrección del cliente', status: 'correccion_cliente' });

    render(
      <PendingList
        profile={crearPerfil({ role: 'client' })}
        pieces={[]}
        ideas={[ideaPendiente, ideaEnCorreccion]}
      />
    );

    expect(screen.getByRole('heading', { name: 'Ideas esperando tu revisión' })).toBeInTheDocument();
    expect(screen.getByText('Idea pendiente del cliente')).toBeInTheDocument();
    expect(screen.queryByText('Idea en corrección del cliente')).not.toBeInTheDocument();
    expect(screen.queryByText('Cliente')).not.toBeInTheDocument();
    expect(screen.queryByText('Marca Uno')).not.toBeInTheDocument();
  });

  it('como agencia: título correcto, lista ambos estados, muestra la marca y correccion_cliente va primero', () => {
    const ideaPendiente = crearIdea({ id: 'idea-pendiente', title: 'Idea pendiente del cliente', status: 'pendiente_cliente' });
    const ideaEnCorreccion = crearIdea({ id: 'idea-correccion', title: 'Idea en corrección del cliente', status: 'correccion_cliente' });

    render(
      <PendingList
        profile={crearPerfil({ role: 'agency_admin' })}
        pieces={[]}
        // El orden de entrada es a propósito pendiente-antes-que-corrección, para que solo un
        // ordenamiento correcto dentro del componente lo invierta.
        ideas={[ideaPendiente, ideaEnCorreccion]}
      />
    );

    expect(screen.getByRole('heading', { name: 'Ideas esperando respuesta del cliente' })).toBeInTheDocument();
    expect(screen.getByText('Idea pendiente del cliente')).toBeInTheDocument();
    expect(screen.getByText('Idea en corrección del cliente')).toBeInTheDocument();
    expect(screen.getAllByText('Marca Uno').length).toBeGreaterThan(0);

    const filas = screen.getAllByRole('row').filter((fila) => within(fila).queryByRole('link'));
    const titulosEnOrden = filas.map((fila) => within(fila).getByRole('link').textContent);
    expect(titulosEnOrden).toEqual(['Idea en corrección del cliente', 'Idea pendiente del cliente']);
  });

  it('cuando el rol no tiene ideas que ver, la sección no se renderiza (ni encabezado ni tabla vacía)', () => {
    const ideaEnCorreccion = crearIdea({ id: 'idea-correccion', title: 'Idea en corrección del cliente', status: 'correccion_cliente' });

    render(
      <PendingList
        profile={crearPerfil({ role: 'client' })}
        pieces={[]}
        // El cliente no ve 'correccion_cliente', así que no tiene ninguna idea que mostrar.
        ideas={[ideaEnCorreccion]}
      />
    );

    expect(screen.queryByRole('heading', { name: 'Ideas esperando tu revisión' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ideas esperando respuesta del cliente' })).not.toBeInTheDocument();
    expect(screen.queryByText('Idea en corrección del cliente')).not.toBeInTheDocument();
  });

  it('las secciones de piezas siguen funcionando con ideas presentes', () => {
    const ideaPendiente = crearIdea();
    const piezaPendiente = crearPieza({ id: 'pieza-pendiente', title: 'Pieza pendiente de revisión', status: 'pendiente_revision' });

    render(
      <PendingList
        profile={crearPerfil({ role: 'agency_admin' })}
        pieces={[piezaPendiente]}
        ideas={[ideaPendiente]}
      />
    );

    expect(screen.getByText('Pieza pendiente de revisión')).toBeInTheDocument();
  });
});
