import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Archivo aparte de FormularioDeRegistro.test.tsx a proposito: aquel mockea lib/captcha para
// apagarlo a nivel de modulo, y esta prueba necesita el interruptor real encendido. Igual que la
// prueba del login, las variables se ponen con vi.stubEnv y lib/captcha NO se mockea.

const registrarAgencia = vi.fn();
vi.mock('@/app/registro-actions', () => ({ registrarAgencia: (...args: unknown[]) => registrarAgencia(...args) }));

import { FormularioDeRegistro } from '@/components/FormularioDeRegistro';

/** Turnstile falso: `render` entrega un token al instante, como si la persona hubiera resuelto el desafio. */
function turnstileFalso(tokens: string[]) {
  const render = vi.fn((_el: HTMLElement, opciones: { callback: (t: string) => void }) => {
    opciones.callback(tokens.shift() ?? 'token-agotado');
    return 'widget';
  });
  (window as unknown as { turnstile?: unknown }).turnstile = { render };
  return render;
}

const VALIDOS: Record<string, string> = {
  Nombre: 'Mauro',
  Apellido: 'Gorrin',
  'Teléfono': '+584141234567',
  'Correo electrónico': 'mauro@ejemplo.com',
  'Contraseña': 'una-clave-larga-123',
  'Nombre de tu agencia': 'Estudio Norte',
};

describe('/registro y el captcha', () => {
  beforeEach(() => {
    registrarAgencia.mockReset();
    vi.stubEnv('NEXT_PUBLIC_CAPTCHA_PROVIDER', 'turnstile');
    vi.stubEnv('NEXT_PUBLIC_CAPTCHA_SITE_KEY', 'clave-de-sitio-de-prueba');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete (window as unknown as { turnstile?: unknown }).turnstile;
  });

  it('tras un alta rechazada pide un token NUEVO: el primero ya lo gasto Supabase', async () => {
    // El caso real: alguien se registra con un correo que ya tiene cuenta, corrige y reintenta.
    // Si el formulario reusara el token del primer intento, el segundo rebotaria por el captcha y
    // la persona no entenderia por que.
    const renderWidget = turnstileFalso(['token-1', 'token-2']);
    registrarAgencia.mockResolvedValueOnce({ ok: false, mensaje: 'Ese correo ya tiene una cuenta.' });
    registrarAgencia.mockResolvedValueOnce({ ok: true, necesitaConfirmacion: true });
    render(<FormularioDeRegistro />);

    for (const [etiqueta, valor] of Object.entries(VALIDOS)) {
      fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Crear mi cuenta' }));

    expect(await screen.findByText('Ese correo ya tiene una cuenta.')).toBeInTheDocument();
    expect(registrarAgencia.mock.calls[0][0]).toMatchObject({ captchaToken: 'token-1' });
    await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: 'Crear mi cuenta' }));
    await waitFor(() => expect(registrarAgencia).toHaveBeenCalledTimes(2));
    expect(registrarAgencia.mock.calls[1][0]).toMatchObject({ captchaToken: 'token-2' });
  });
});
