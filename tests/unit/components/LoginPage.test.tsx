import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// /login con y sin captcha. Lo que se vigila es la frontera que deja fuera a todo el mundo si se
// rompe: con la protección de Supabase encendida, GoTrue exige `captcha_token` también en
// `signInWithPassword` (verificado contra la Supabase local; ver CLAUDE.md, "Sobre el captcha").
//
// Las variables se ponen con `vi.stubEnv` y NO se mockea lib/captcha: así se prueba el interruptor
// real ("están las dos o no hay captcha"), el mismo que usa /registro.

const signInWithPassword = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signInWithPassword } }),
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import LoginPage from '@/app/login/page';

/** Turnstile falso: `render` entrega un token al instante, como si la persona hubiera resuelto el desafío. */
function turnstileFalso(tokens: string[]) {
  const render = vi.fn((_el: HTMLElement, opciones: { callback: (t: string) => void }) => {
    opciones.callback(tokens.shift() ?? 'token-agotado');
    return 'widget';
  });
  (window as unknown as { turnstile?: unknown }).turnstile = { render };
  return render;
}

function llenarYEnviar() {
  const [correo, clave] = [
    document.querySelector<HTMLInputElement>('input[type="email"]')!,
    document.querySelector<HTMLInputElement>('input[type="password"]')!,
  ];
  fireEvent.change(correo, { target: { value: 'duena@agencia.test' } });
  fireEvent.change(clave, { target: { value: 'una-clave-larga-123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
}

describe('/login y el captcha', () => {
  beforeEach(() => {
    signInWithPassword.mockReset();
    push.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete (window as unknown as { turnstile?: unknown }).turnstile;
  });

  describe('sin las variables (el estado de hoy)', () => {
    beforeEach(() => {
      vi.stubEnv('NEXT_PUBLIC_CAPTCHA_PROVIDER', '');
      vi.stubEnv('NEXT_PUBLIC_CAPTCHA_SITE_KEY', '');
    });

    it('no dibuja el widget', () => {
      render(<LoginPage />);
      expect(screen.queryByTestId('captcha')).not.toBeInTheDocument();
    });

    it('llama a signInWithPassword exactamente como antes: correo y clave, sin captchaToken', async () => {
      signInWithPassword.mockResolvedValue({ error: null });
      render(<LoginPage />);

      llenarYEnviar();

      await waitFor(() => expect(signInWithPassword).toHaveBeenCalledTimes(1));
      expect(signInWithPassword).toHaveBeenCalledWith({ email: 'duena@agencia.test', password: 'una-clave-larga-123' });
      expect(push).toHaveBeenCalledWith('/');
    });
  });

  describe('con las dos variables puestas', () => {
    beforeEach(() => {
      vi.stubEnv('NEXT_PUBLIC_CAPTCHA_PROVIDER', 'turnstile');
      vi.stubEnv('NEXT_PUBLIC_CAPTCHA_SITE_KEY', 'clave-de-sitio-de-prueba');
    });

    it('dibuja el widget y manda el token en options.captchaToken', async () => {
      turnstileFalso(['token-1']);
      signInWithPassword.mockResolvedValue({ error: null });
      render(<LoginPage />);

      expect(screen.getByTestId('captcha')).toBeInTheDocument();
      llenarYEnviar();

      await waitFor(() => expect(signInWithPassword).toHaveBeenCalledTimes(1));
      expect(signInWithPassword).toHaveBeenCalledWith({
        email: 'duena@agencia.test',
        password: 'una-clave-larga-123',
        options: { captchaToken: 'token-1' },
      });
    });

    it('sin token resuelto no llama a Supabase y pide resolver el captcha', async () => {
      // Sin `window.turnstile` el script nunca "carga" en jsdom: el widget no entrega token.
      render(<LoginPage />);

      llenarYEnviar();

      expect(await screen.findByText('Resuelve el captcha antes de continuar.')).toBeInTheDocument();
      expect(signInWithPassword).not.toHaveBeenCalled();
    });

    it('tras una contraseña incorrecta pide un token NUEVO: el primero ya lo gastó Supabase', async () => {
      const renderWidget = turnstileFalso(['token-1', 'token-2']);
      signInWithPassword.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } });
      signInWithPassword.mockResolvedValueOnce({ error: null });
      render(<LoginPage />);

      llenarYEnviar();
      expect(await screen.findByText('No pudimos iniciar sesión. Verifica tu correo y contraseña.')).toBeInTheDocument();
      await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(2));

      fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
      await waitFor(() => expect(signInWithPassword).toHaveBeenCalledTimes(2));
      expect(signInWithPassword.mock.calls[1][0]).toMatchObject({ options: { captchaToken: 'token-2' } });
    });
  });
});
