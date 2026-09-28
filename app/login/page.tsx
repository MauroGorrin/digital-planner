'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { destinoSeguro } from '@/lib/url-segura';
import { Captcha } from '@/components/Captcha';
import { captchaEsObligatorio } from '@/lib/captcha';

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // El captcha del login es el MISMO que el de /registro (components/Captcha.tsx, lib/captcha.ts) y
  // se enciende con las mismas dos variables. No es un adorno: con la protección activada en el
  // panel de Supabase, GoTrue exige `captcha_token` también en `/token?grant_type=password`, no sólo
  // en `/signup`. Sin este token, encender el captcha en el panel deja fuera a TODO el mundo, dueño
  // incluido. El orden para encenderlo está en "Sobre el captcha" de CLAUDE.md.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  // Un token de captcha sirve UNA vez: Supabase lo gasta aunque la contraseña sea incorrecta. Tras
  // un intento fallido se vuelve a montar el widget (cambiando su `key`) para pedir uno nuevo; si
  // no, el segundo intento rebotaría por el captcha y no por la contraseña.
  const [intentoDeCaptcha, setIntentoDeCaptcha] = useState(0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (captchaEsObligatorio() && !captchaToken) {
      setError('Resuelve el captcha antes de continuar.');
      return;
    }
    setLoading(true);
    const supabase = createClient();
    // Sin captcha configurado la llamada es exactamente la de siempre, sin `options`.
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      ...(captchaToken ? { options: { captchaToken } } : {}),
    });
    setLoading(false);
    if (error) {
      setError('No pudimos iniciar sesión. Verifica tu correo y contraseña.');
      if (captchaToken) {
        setCaptchaToken(null);
        setIntentoDeCaptcha((n) => n + 1);
      }
      return;
    }
    // El parametro 'redirect' lo controla quien arma el enlace, no el middleware (CN-011).
    router.push(destinoSeguro(params.get('redirect')));
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-ink-900 text-lg font-semibold text-white">
            P
          </div>
          <h1 className="text-xl font-semibold text-slate-900">
            Planner de <span className="title-accent">Contenido</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">Inicia sesión para ver tu calendario</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Correo electrónico</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
              placeholder="tucorreo@empresa.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Contraseña</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
              placeholder="••••••••"
            />
          </div>
          <Captcha key={intentoDeCaptcha} onToken={setCaptchaToken} />
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-800 disabled:opacity-60"
          >
            {loading ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
        <p className="mt-6 text-center text-xs text-slate-400">
          ¿Eres cliente y no tienes acceso? Pide a tu agencia que te invite.
        </p>
        <p className="mt-2 text-center text-sm text-slate-500">
          ¿Tienes una agencia?{' '}
          <Link href="/registro" className="font-medium text-slate-700 underline">
            Regístrala aquí
          </Link>
        </p>
      </div>
    </main>
  );
}
