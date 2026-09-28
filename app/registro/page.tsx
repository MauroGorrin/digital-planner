import Link from 'next/link';
import { FormularioDeRegistro } from '@/components/FormularioDeRegistro';

export const metadata = {
  title: 'Crea tu agencia — Planner de Contenido',
};

/**
 * Alta pública. Es una de las dos rutas que se ven SIN sesión (la otra es `/login`), y está en la
 * lista de rutas públicas de lib/supabase/middleware.ts — sin eso, el middleware mandaría a
 * `/login` a quien viniera a registrarse, que es el bucle exacto que deja el alta inalcanzable.
 */
export default function RegistroPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50 px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-ink-900 text-lg font-semibold text-white">
              P
            </div>
            <h1 className="text-xl font-semibold text-slate-900">
              Crea tu <span className="title-accent">agencia</span>
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Tu espacio de trabajo nace vacío y sólo lo ves tú y quien invites.
            </p>
          </div>
          <FormularioDeRegistro />
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">
          ¿Ya tienes cuenta?{' '}
          <Link href="/login" className="font-medium text-slate-700 underline">
            Inicia sesión
          </Link>
        </p>
      </div>
    </main>
  );
}
