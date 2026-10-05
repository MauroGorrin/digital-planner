import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Vuelta de Google. Canjea el `code` por la sesión (las cookies las escribe el cliente de servidor)
 * y manda a la raíz, que reparte: a /bienvenida si la cuenta todavía no tiene agencia, o al calendario.
 * Sin código o con error, vuelve a /login con un aviso.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/`);
  }

  return NextResponse.redirect(`${origin}/login?error=google`);
}
