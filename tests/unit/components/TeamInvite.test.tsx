import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamInvite } from '@/components/TeamInvite';
import type { Profile } from '@/types/database';
import { crearUsuario } from '@/app/admin-actions';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// La Server Action se mockea: en una prueba unitaria no hay servidor ni Supabase, y lo que se está
// probando es lo que hace la UI con el resultado, no la creación en sí.
vi.mock('@/app/admin-actions', () => ({
  crearUsuario: vi.fn(),
}));

const CLAVE = 'Hk7$rTm2pQw9zXvB4nLd';

function crearPerfil(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'profile-1',
    full_name: 'Ana Agencia',
    email: 'ana@agencia.test',
    role: 'agency_admin',
    phone: null,
    avatar_url: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Portapapeles falso: jsdom no trae navigator.clipboard. Devuelve el espía para comprobarlo. */
function mockearPortapapeles() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

/** Llena el formulario y lo envía. */
function enviarFormulario(correo = 'nuevo@agencia.test') {
  fireEvent.change(screen.getByPlaceholderText('Nombre completo'), { target: { value: 'Nuevo Miembro' } });
  fireEvent.change(screen.getByPlaceholderText('correo@agencia.com'), { target: { value: correo } });
  fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
}

describe('TeamInvite — panel de la clave generada', () => {
  beforeEach(() => {
    vi.mocked(crearUsuario).mockReset();
  });

  it('tras crear la cuenta muestra el correo, la clave y el aviso de que no se vuelve a mostrar', async () => {
    vi.mocked(crearUsuario).mockResolvedValue({ userId: 'u-1', clave: CLAVE, yaExistia: false });
    render(<TeamInvite team={[crearPerfil()]} />);

    expect(screen.queryByText(CLAVE)).not.toBeInTheDocument();
    enviarFormulario();

    await waitFor(() => expect(screen.getByText(CLAVE)).toBeInTheDocument());
    expect(screen.getByText('nuevo@agencia.test')).toBeInTheDocument();
    expect(screen.getByText(/se muestra una sola vez/i)).toBeInTheDocument();
  });

  it('cuando la cuenta ya existía no muestra ninguna clave, solo que quedó vinculada', async () => {
    vi.mocked(crearUsuario).mockResolvedValue({ userId: 'u-1', yaExistia: true });
    render(<TeamInvite team={[crearPerfil()]} />);

    enviarFormulario('repetido@agencia.test');

    await waitFor(() => expect(screen.getByText(/ya tenía cuenta/i)).toBeInTheDocument());
    expect(screen.queryByTestId('clave-generada')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copiar clave/i })).not.toBeInTheDocument();
    expect(screen.getByText(/su clave no se cambió/i)).toBeInTheDocument();
  });

  it('el botón de copiar pone la clave en el portapapeles y lo confirma', async () => {
    const writeText = mockearPortapapeles();
    vi.mocked(crearUsuario).mockResolvedValue({ userId: 'u-1', clave: CLAVE, yaExistia: false });
    render(<TeamInvite team={[crearPerfil()]} />);

    enviarFormulario();
    await waitFor(() => expect(screen.getByText(CLAVE)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Copiar clave' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CLAVE));
    expect(await screen.findByRole('button', { name: 'Clave copiada' })).toBeInTheDocument();
  });

  it('el panel solo se va cuando la persona lo cierra, no por su cuenta', async () => {
    vi.mocked(crearUsuario).mockResolvedValue({ userId: 'u-1', clave: CLAVE, yaExistia: false });
    render(<TeamInvite team={[crearPerfil()]} />);

    enviarFormulario();
    await waitFor(() => expect(screen.getByText(CLAVE)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /ya la guardé/i }));
    expect(screen.queryByText(CLAVE)).not.toBeInTheDocument();
  });

  it('al empezar una creación nueva limpia el panel de la anterior, para no confundir de quién es la clave', async () => {
    vi.mocked(crearUsuario).mockResolvedValue({ userId: 'u-1', clave: CLAVE, yaExistia: false });
    render(<TeamInvite team={[crearPerfil()]} />);

    enviarFormulario('primero@agencia.test');
    await waitFor(() => expect(screen.getByText(CLAVE)).toBeInTheDocument());

    // La segunda creación nunca resuelve: así se observa el estado intermedio, que es justo el
    // momento en el que la clave de la primera persona no debe seguir en pantalla.
    const OTRA_CLAVE = 'Zq4!wEr8tYu3iOp6aSdF';
    vi.mocked(crearUsuario).mockReturnValue(new Promise(() => {}) as ReturnType<typeof crearUsuario>);
    enviarFormulario('segundo@agencia.test');

    await waitFor(() => expect(screen.queryByText(CLAVE)).not.toBeInTheDocument());
    expect(screen.queryByText(OTRA_CLAVE)).not.toBeInTheDocument();
  });

  it('si la creación falla, muestra el error y ninguna clave', async () => {
    vi.mocked(crearUsuario).mockRejectedValue(new Error('No se pudo crear la cuenta.'));
    render(<TeamInvite team={[crearPerfil()]} />);

    enviarFormulario();

    await waitFor(() => expect(screen.getByText('No se pudo crear la cuenta.')).toBeInTheDocument());
    expect(screen.queryByTestId('clave-generada')).not.toBeInTheDocument();
  });
});
