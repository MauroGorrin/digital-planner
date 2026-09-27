import 'server-only';

// Este modulo lee SUPABASE_SERVICE_ROLE_KEY. Hoy es de servidor por construccion -- se traza el
// grafo de imports y ningun archivo "use client" llega hasta aqui -- pero nada lo IMPONIA, y un
// import accidental desde un componente de cliente mandaria la llave de servicio al navegador.
// 'server-only' convierte ese error en un fallo de compilacion en vez de una fuga (CN-016).
// Viene con Next; no agrega ninguna dependencia.
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

// En Next 15 `cookies()` devuelve una promesa, asi que esta funcion pasa a ser async y cada llamada
// la espera. No se usa el atajo `UnsafeUnwrappedCookies` que propuso el codemod: ese acceso
// sincrono esta deprecado y se quita en la proxima version mayor, y aqui no solo se LEEN las cookies
// de sesion de Supabase, tambien se ESCRIBEN. Si un dia deja de funcionar sin avisar, se cae la
// sesion de todo el mundo.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Se llama desde un Server Component; el middleware refresca la sesión.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch {
            // ídem
          }
        },
      },
    }
  );
}

/** Cliente con service role para operaciones de servidor (webhooks, Google Calendar). Nunca exponer al navegador. */
export function createServiceClient() {
  const { createClient: createSupabaseClient } = require('@supabase/supabase-js');
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
