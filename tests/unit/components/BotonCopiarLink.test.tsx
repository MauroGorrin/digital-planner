import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BotonCopiarLink } from '@/components/BotonCopiarLink';

describe('BotonCopiarLink', () => {
  const writeText = vi.fn();

  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('al hacer clic, copia la URL exacta al portapapeles', async () => {
    render(<BotonCopiarLink url="https://app.ejemplo.com/reportes/client-1/2026/10?firma=abc" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copiar link para compartir' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://app.ejemplo.com/reportes/client-1/2026/10?firma=abc'));
  });

  it('muestra "¡Copiado!" tras el clic y vuelve a su texto normal pasado un rato', async () => {
    vi.useFakeTimers();
    render(<BotonCopiarLink url="https://app.ejemplo.com/x" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copiar link para compartir' }));
    // writeText es async; se deja correr la microtarea antes de avanzar los timers falsos.
    await vi.waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('¡Copiado!'));

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('button')).toHaveTextContent('Copiar link para compartir');
  });

  it('acepta una etiqueta distinta a la de por defecto', () => {
    render(<BotonCopiarLink url="https://app.ejemplo.com/x" etiqueta="Copiar" />);

    expect(screen.getByRole('button', { name: 'Copiar' })).toBeInTheDocument();
  });

  it('si el portapapeles rechaza la copia, no revienta ni finge haber copiado', async () => {
    writeText.mockRejectedValueOnce(new Error('Permiso denegado'));
    render(<BotonCopiarLink url="https://app.ejemplo.com/x" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copiar link para compartir' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button')).toHaveTextContent('Copiar link para compartir');
  });
});
