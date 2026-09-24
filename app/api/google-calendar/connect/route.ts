import { NextResponse } from 'next/server';
import { requireAgencyAdmin } from '@/lib/auth';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

export async function GET(request: Request) {
  await requireAgencyAdmin();
  const { searchParams, origin } = new URL(request.url);
  const label = searchParams.get('label') || 'Calendario de la agencia';

  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? `${origin}/api/google-calendar/callback`;
  const clientId = process.env.GOOGLE_CLIENT_ID;

  if (!clientId) {
    return NextResponse.redirect(new URL('/ajustes?error=google_no_configurado', origin));
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: 'https://www.googleapis.com/auth/calendar',
    state: label,
  });

  return NextResponse.redirect(`${AUTH_URL}?${params.toString()}`);
}
