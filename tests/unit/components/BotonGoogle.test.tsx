import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BotonGoogle } from '@/components/BotonGoogle';

const signInWithOAuth = vi.fn().mockResolvedValue({ error: null });

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signInWithOAuth } }),
}));

describe('BotonGoogle', () => {
  beforeEach(() => {
    signInWithOAuth.mockClear();
  });

  it('inicia el flujo de Google y vuelve a /auth/callback', async () => {
    render(<BotonGoogle etiqueta="Entrar con Google" />);
    fireEvent.click(screen.getByRole('button', { name: /Entrar con Google/ }));

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  });
});
