import crypto from 'node:crypto';

import { NextResponse } from 'next/server';
import { requireAgencyAdmin } from '@/lib/auth';
import {
  COOKIE_ESTADO,
  COOKIE_ETIQUETA,
  ETIQUETA_POR_DEFECTO,
  OPCIONES_COOKIE,
} from '@/lib/google-calendar/oauth-estado';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

export async function GET(request: Request) {
  await requireAgencyAdmin();
  const { searchParams, origin } = new URL(request.url);
  const etiqueta = searchParams.get('label') || ETIQUETA_POR_DEFECTO;

  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? `${origin}/api/google-calendar/callback`;
  const clientId = process.env.GOOGLE_CLIENT_ID;

  if (!clientId) {
    return NextResponse.redirect(new URL('/ajustes?error=google_no_configurado', origin));
  }

  // `state` es un nonce aleatorio de un solo uso, no la etiqueta que escribe la persona. Antes
  // viajaba la etiqueta y el callback la leía únicamente para volver a usarla como etiqueta, sin
  // compararla con nada: el flujo no tenía token CSRF (CN-005). Bastaba que un atacante iniciara su
  // propio consentimiento con este client_id, se guardara el `code` y llevara a un admin logueado a
  // cargar el callback -- un <img> alcanza, porque es un GET -- para que la agencia guardara el
  // access_token y el refresh_token DEL ATACANTE como conexión de calendario. Desde ahí, cada pieza
  // aprobada le sincroniza título y copy completo al calendario del atacante.
  //
  // El nonce va en una cookie httpOnly: el navegador lo devuelve al volver de Google, pero ni el
  // JavaScript de la página ni el atacante pueden leerlo para fabricar un `state` que cuadre.
  const nonce = crypto.randomBytes(32).toString('hex');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: 'https://www.googleapis.com/auth/calendar',
    state: nonce,
  });

  const respuesta = NextResponse.redirect(`${AUTH_URL}?${params.toString()}`);
  // Las cookies se escriben sobre la respuesta y no con `cookies().set()`: en un Route Handler que
  // termina en redirección, escribirlas en el objeto que se devuelve es lo que no depende de que
  // Next las mezcle a tiempo. Si no llegaran, el callback rechazaría cada conexión legítima.
  respuesta.cookies.set(COOKIE_ESTADO, nonce, OPCIONES_COOKIE);
  respuesta.cookies.set(COOKIE_ETIQUETA, etiqueta, OPCIONES_COOKIE);
  return respuesta;
}
