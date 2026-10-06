import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModoDePrueba } from '@/components/ModoDePrueba';
import { activarModoDePrueba, desactivarModoDePrueba } from '@/app/admin-actions';

const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock('@/app/admin-actions', () => ({
  activarModoDePrueba: vi.fn(),
  desactivarModoDePrueba: vi.fn(),
}));

describe('ModoDePrueba', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('inactivo: el botón activa tras confirmar', async () => {
    vi.mocked(activarModoDePrueba).mockResolvedValue(undefined);
    render(<ModoDePrueba activo={false} />);

    expect(screen.getByRole('button', { name: 'Activar modo de prueba' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desactivar modo de prueba' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Activar modo de prueba' }));
    fireEvent.click(screen.getByRole('button', { name: 'Activar' }));

    await waitFor(() => expect(activarModoDePrueba).toHaveBeenCalled());
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('activo: el botón desactiva tras confirmar', async () => {
    vi.mocked(desactivarModoDePrueba).mockResolvedValue(undefined);
    render(<ModoDePrueba activo />);

    expect(screen.getByRole('button', { name: 'Desactivar modo de prueba' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Desactivar modo de prueba' }));
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar' }));

    await waitFor(() => expect(desactivarModoDePrueba).toHaveBeenCalled());
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('muestra el error si la acción falla', async () => {
    vi.mocked(activarModoDePrueba).mockRejectedValue(new Error('No se pudo activar.'));
    render(<ModoDePrueba activo={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Activar modo de prueba' }));
    fireEvent.click(screen.getByRole('button', { name: 'Activar' }));

    expect(await screen.findByText('No se pudo activar.')).toBeInTheDocument();
  });
});
