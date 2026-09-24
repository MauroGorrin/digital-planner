import { NextResponse } from 'next/server';
import { requireAgencyAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_LIST_URL = 'https://www.googleapis.com/calendar/v3/users/me/calendarList/primary';

export async function GET(request: Request) {
  const profile = await requireAgencyAdmin();
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const label = searchParams.get('state') || 'Calendario de la agencia';

  if (!code) {
    return NextResponse.redirect(new URL('/ajustes?error=google_sin_codigo', origin));
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
    return NextResponse.redirect(new URL('/ajustes?error=google_token_invalido', origin));
  }
  const tokens = await tokenRes.json();

  const calRes = await fetch(CALENDAR_LIST_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const calendarId = calRes.ok ? (await calRes.json()).id : 'primary';

  const supabase = createClient();
  const { error } = await supabase.from('google_calendar_connections').insert({
    label,
    calendar_id: calendarId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    connected_by: profile.id,
  });

  if (error) {
    return NextResponse.redirect(new URL('/ajustes?error=' + encodeURIComponent(error.message), origin));
  }

  return NextResponse.redirect(new URL('/ajustes?google=conectado', origin));
}
