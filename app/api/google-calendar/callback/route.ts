import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { requireAgencyAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import {
  COOKIE_ESTADO,
  COOKIE_ETIQUETA,
  ETIQUETA_POR_DEFECTO,
  estadoCoincide,
} from '@/lib/google-calendar/oauth-estado';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_LIST_URL = 'https://www.googleapis.com/calendar/v3/users/me/calendarList/primary';

/** Redirige a /ajustes borrando las cookies del flujo: el nonce es de un solo uso, gane o pierda. */
function terminar(destino: string, origin: string) {
  const respuesta = NextResponse.redirect(new URL(destino, origin));
  respuesta.cookies.delete(COOKIE_ESTADO);
  respuesta.cookies.delete(COOKIE_ETIQUETA);
  return respuesta;
}

export async function GET(request: Request) {
  const profile = await requireAgencyAdmin();
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  // Validar el `state` ANTES de canjear el código: es el único punto del flujo donde se distingue
  // una vuelta de nuestra propia redirección de un callback que alguien provocó desde fuera
  // (CN-005). requireAgencyAdmin() no protege de nada aquí -- la víctima es el admin.
  const almacen = await cookies();
  const esperado = almacen.get(COOKIE_ESTADO)?.value;
  const recibido = searchParams.get('state') ?? '';
  if (!estadoCoincide(esperado, recibido)) {
    return terminar('/ajustes?error=estado_invalido', origin);
  }

  // La etiqueta viaja en su propia cookie, no en `state`. Es texto libre que la persona escribió en
  // /ajustes y no autentica nada; separarla es lo que deja a `state` ser un nonce de verdad.
  const etiqueta = almacen.get(COOKIE_ETIQUETA)?.value || ETIQUETA_POR_DEFECTO;

  if (!code) {
    return terminar('/ajustes?error=google_sin_codigo', origin);
  }

  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? `${origin}/api/google-calendar/callback`;

  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    return terminar('/ajustes?error=google_token_invalido', origin);
  }
  const tokens = await tokenRes.json();

  const calRes = await fetch(CALENDAR_LIST_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const calendarId = calRes.ok ? (await calRes.json()).id : 'primary';

  const supabase = await createClient();
  const { error } = await supabase.from('google_calendar_connections').insert({
    label: etiqueta,
    calendar_id: calendarId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    connected_by: profile.id,
  });

  if (error) {
    // Código estable, nunca `error.message`. El mensaje crudo de PostgREST trae nombres de
    // restricción y de esquema, y aquí acababa en la barra de direcciones, en el historial del
    // navegador y en el log de accesos de cualquier proxy en el camino (CN-014). El detalle se queda
    // del lado del servidor, donde sirve para depurar y no lo lee nadie más.
    console.error('[google-calendar/callback] no se pudo guardar la conexión:', error);
    return terminar('/ajustes?error=google_no_guardado', origin);
  }

  return terminar('/ajustes?google=conectado', origin);
}
