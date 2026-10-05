'use client';

import { createClient } from '@/lib/supabase/client';

/**
 * Entrar o registrarse con Google. Supabase guarda el código del flujo PKCE en una cookie y manda
 * al navegador a Google; al volver, `/auth/callback` lo canjea por la sesión.
 *
 * El alta con Google no pasa por el captcha: GoTrue solo lo exige en /signup, /token con contraseña,
 * OTP y recuperación (ver "Sobre el captcha" en CLAUDE.md), y el flujo OAuth no es ninguno de ellos.
 */
export function BotonGoogle({ etiqueta }: { etiqueta: string }) {
  async function entrar() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <button
      type="button"
      onClick={entrar}
      className="flex w-full items-center justify-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-50"
    >
      <span aria-hidden="true" className="font-bold text-[#4285F4]">G</span>
      {etiqueta}
    </button>
  );
}
