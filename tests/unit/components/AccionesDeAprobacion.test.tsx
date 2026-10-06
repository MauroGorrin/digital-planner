import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccionesDeAprobacion } from '@/components/AccionesDeAprobacion';
import { approvePiece, requestPieceChanges } from '@/app/actions';

const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock('@/app/actions', () => ({
  approvePiece: vi.fn(),
  requestPieceChanges: vi.fn(),
}));

describe('AccionesDeAprobacion', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('aprueba la pieza tras confirmar', async () => {
    vi.mocked(approvePiece).mockResolvedValue(undefined);
    render(<AccionesDeAprobacion piezaId="pieza-1" />);

    fireEvent.click(screen.getByRole('button', { name: '✓ Aprobar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }));

    await waitFor(() => expect(approvePiece).toHaveBeenCalledWith('pieza-1'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('pedir cambios exige una nota antes de habilitar "Enviar solicitud"', () => {
    render(<AccionesDeAprobacion piezaId="pieza-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Solicitar cambios' }));
    expect(screen.getByRole('button', { name: 'Enviar solicitud' })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Explica qué te gustaría modificar…'), {
      target: { value: 'Cambia el color del fondo' },
    });
    expect(screen.getByRole('button', { name: 'Enviar solicitud' })).toBeEnabled();
  });

  it('envía la solicitud de cambios con la nota escrita', async () => {
    vi.mocked(requestPieceChanges).mockResolvedValue(undefined);
    render(<AccionesDeAprobacion piezaId="pieza-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Solicitar cambios' }));
    fireEvent.change(screen.getByPlaceholderText('Explica qué te gustaría modificar…'), {
      target: { value: 'Cambia el color del fondo' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }));

    await waitFor(() => expect(requestPieceChanges).toHaveBeenCalledWith('pieza-1', 'Cambia el color del fondo'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('enlaza a la ficha completa de la pieza', () => {
    render(<AccionesDeAprobacion piezaId="pieza-1" />);

    expect(screen.getByRole('link', { name: /Ver detalle completo/ })).toHaveAttribute('href', '/piezas/pieza-1');
  });
});
