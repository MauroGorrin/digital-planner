import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NombreDeAgencia } from '@/components/NombreDeAgencia';
import { renombrarMiAgencia } from '@/app/admin-actions';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// La Server Action se mockea: aquí se prueba la UI. Que un `agency_member` no pueda renombrar lo
// decide la base y lo prueba tests/integration/renombrar-agencia.test.ts.
vi.mock('@/app/admin-actions', () => ({
  renombrarMiAgencia: vi.fn(),
}));

describe('NombreDeAgencia', () => {
  beforeEach(() => {
    vi.mocked(renombrarMiAgencia).mockReset();
  });

  it('a un agency_admin le muestra el nombre actual con su campo para cambiarlo', () => {
    render(<NombreDeAgencia rol="agency_admin" nombre="Agencia" />);

    expect(screen.getByRole('heading', { name: 'Nombre de la agencia' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre de la agencia')).toHaveValue('Agencia');
    expect(screen.getByRole('button', { name: 'Guardar nombre' })).toBeInTheDocument();
  });

  it('a un agency_member no le dibuja nada', () => {
    const { container } = render(<NombreDeAgencia rol="agency_member" nombre="Agencia" />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: 'Guardar nombre' })).not.toBeInTheDocument();
  });

  it('guardar llama a la Server Action con el nombre escrito', async () => {
    vi.mocked(renombrarMiAgencia).mockResolvedValue(undefined);
    render(<NombreDeAgencia rol="agency_admin" nombre="Agencia" />);

    fireEvent.change(screen.getByLabelText('Nombre de la agencia'), { target: { value: 'Estudio Norte' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nombre' }));

    await waitFor(() => expect(renombrarMiAgencia).toHaveBeenCalledWith('Estudio Norte'));
    expect(await screen.findByText('Nombre guardado.')).toBeInTheDocument();
  });

  it('un nombre vacío no sale del navegador y muestra el mismo mensaje que el alta', async () => {
    render(<NombreDeAgencia rol="agency_admin" nombre="Agencia" />);

    fireEvent.change(screen.getByLabelText('Nombre de la agencia'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nombre' }));

    expect(await screen.findByText('Escribe el nombre de tu agencia.')).toBeInTheDocument();
    expect(renombrarMiAgencia).not.toHaveBeenCalled();
  });

  it('muestra el mensaje de la base cuando la Server Action rechaza', async () => {
    vi.mocked(renombrarMiAgencia).mockRejectedValue(new Error('Solo el administrador de la agencia puede cambiarle el nombre.'));
    render(<NombreDeAgencia rol="agency_admin" nombre="Agencia" />);

    fireEvent.click(screen.getByRole('button', { name: 'Guardar nombre' }));

    expect(await screen.findByText('Solo el administrador de la agencia puede cambiarle el nombre.')).toBeInTheDocument();
  });
});
