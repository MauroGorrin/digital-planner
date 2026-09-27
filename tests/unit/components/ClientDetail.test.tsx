import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientDetail } from '@/components/ClientDetail';
import type { Client, Profile } from '@/types/database';
import { crearUsuario } from '@/app/admin-actions';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Todas las Server Actions que importa ClientDetail, mockeadas: la prueba es sobre el panel de la
// clave, y una prueba unitaria nunca toca Supabase.
vi.mock('@/app/admin-actions', () => ({
  assignTeamMember: vi.fn().mockResolvedValue(undefined),
  crearUsuario: vi.fn(),
  removeClientContact: vi.fn().mockResolvedValue(undefined),
  removeTeamAssignment: vi.fn().mockResolvedValue(undefined),
  updateClientEntity: vi.fn().mockResolvedValue(undefined),
  updateNotificationSettings: vi.fn().mockResolvedValue(undefined),
  setClientCalendarMapping: vi.fn().mockResolvedValue(undefined),
  removeClientCalendarMapping: vi.fn().mockResolvedValue(undefined),
}));

const CLAVE = 'Ns8#vKq5mRt2wZb7yPcJ';

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

function crearCliente(overrides: Partial<Client> = {}): Client {
  return {
    id: 'client-1',
    name: 'Cliente Uno',
    agency_id: 'agency-1',
    brand_name: 'Marca Uno',
    timezone: 'America/Caracas',
    logo_url: null,
    notes: null,
    archived: false,
    billing_mode: 'libre',
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderFicha(profile: Profile = crearPerfil()) {
  return render(
    <ClientDetail
      profile={profile}
      client={crearCliente()}
      assignments={[]}
      contacts={[]}
      team={[]}
      notificationSettings={null}
      calendarMapping={null}
      connections={[]}
    />
  );
}

/** Portapapeles falso: jsdom no trae navigator.clipboard. Devuelve el espía para comprobarlo. */
function mockearPortapapeles() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

/** Llena el formulario de contacto de la marca y lo envía. */
function enviarFormulario(correo = 'contacto@cliente.test') {
  fireEvent.change(screen.getByPlaceholderText('Nombre completo'), { target: { value: 'Carla Cliente' } });
  fireEvent.change(screen.getByPlaceholderText('correo@cliente.com'), { target: { value: correo } });
  fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
}

describe('ClientDetail — panel de la clave generada al crear un contacto', () => {
  beforeEach(() => {
    vi.mocked(crearUsuario).mockReset();
  });

  it('tras crear la cuenta muestra el correo, la clave y el aviso de que no se vuelve a mostrar', async () => {
    vi.mocked(crearUsuario).mockResolvedValue({ userId: 'u-1', clave: CLAVE, yaExistia: false });
    renderFicha();

    expect(screen.queryByText(CLAVE)).not.toBeInTheDocument();
    enviarFormulario();

    await waitFor(() => expect(screen.getByText(CLAVE)).toBeInTheDocument());
    expect(screen.getByText('contacto@cliente.test')).toBeInTheDocument();
    expect(screen.getByText(/se muestra una sola vez/i)).toBeInTheDocument();
  });

  it('crea el contacto vinculado a la marca y con rol de cliente', async () => {
    vi.mocked(crearUsuario).mockResolvedValue({ userId: 'u-1', clave: CLAVE, yaExistia: false });
    renderFicha();

    enviarFormulario();

    await waitFor(() =>
      expect(crearUsuario).toHaveBeenCalledWith({
        email: 'contacto@cliente.test',
        full_name: 'Carla Cliente',
        role: 'client',
        client_id: 'client-1',
      })
    );
  });

  it('cuando la cuenta ya existía no muestra ninguna clave, solo que quedó vinculada a la marca', async () => {
    vi.mocked(crearUsuario).mockResolvedValue({ userId: 'u-1', yaExistia: true });
    renderFicha();

    enviarFormulario('repetido@cliente.test');

    await waitFor(() => expect(screen.getByText(/ya tenía cuenta/i)).toBeInTheDocument());
    expect(screen.queryByTestId('clave-generada')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copiar clave/i })).not.toBeInTheDocument();
    expect(screen.getByText(/su clave no se cambió/i)).toBeInTheDocument();
  });

  it('el botón de copiar pone la clave en el portapapeles y lo confirma', async () => {
    const writeText = mockearPortapapeles();
    vi.mocked(crearUsuario).mockResolvedValue({ userId: 'u-1', clave: CLAVE, yaExistia: false });
    renderFicha();

    enviarFormulario();
    await waitFor(() => expect(screen.getByText(CLAVE)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Copiar clave' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CLAVE));
    expect(await screen.findByRole('button', { name: 'Clave copiada' })).toBeInTheDocument();
  });

  it('el panel solo se va cuando la persona lo cierra, no por su cuenta', async () => {
    vi.mocked(crearUsuario).mockResolvedValue({ userId: 'u-1', clave: CLAVE, yaExistia: false });
    renderFicha();

    enviarFormulario();
    await waitFor(() => expect(screen.getByText(CLAVE)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /ya la guardé/i }));
    expect(screen.queryByText(CLAVE)).not.toBeInTheDocument();
  });

  it('quien no es administrador no ve el formulario ni ningún panel de clave', () => {
    renderFicha(crearPerfil({ role: 'agency_member' }));

    expect(screen.queryByRole('button', { name: 'Crear cuenta' })).not.toBeInTheDocument();
    expect(screen.getByText(/solo un administrador puede crear cuentas de contacto/i)).toBeInTheDocument();
  });
});
