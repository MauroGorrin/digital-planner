import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BotonCopiarInvitacion } from '@/components/BotonCopiarInvitacion';

describe('BotonCopiarInvitacion', () => {
  const writeText = vi.fn();

  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('copia la invitación sin credenciales (el contacto ya existe)', async () => {
    render(<BotonCopiarInvitacion fullName="Ana Pérez" email="ana@cliente.com" marca="Mamalactea" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copiar invitación' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const mensaje = writeText.mock.calls[0][0] as string;
    expect(mensaje).toContain('Ana Pérez');
    expect(mensaje).toContain('Mamalactea');
    expect(mensaje).not.toMatch(/clave/i);
  });

  it('muestra "¡Copiado!" y vuelve a su texto normal', async () => {
    vi.useFakeTimers();
    render(<BotonCopiarInvitacion fullName="Ana" email="ana@cliente.com" marca="Mamalactea" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copiar invitación' }));
    await vi.waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('¡Copiado!'));

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('button')).toHaveTextContent('Copiar invitación');
  });
});
