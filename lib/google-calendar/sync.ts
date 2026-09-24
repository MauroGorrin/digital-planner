import { createServiceClient } from '@/lib/supabase/server';
import type { ContentPiece } from '@/types/database';
import { PLATFORM_LABELS, FORMAT_LABELS } from '@/types/database';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const EVENTS_BASE = 'https://www.googleapis.com/calendar/v3/calendars';

async function getFreshAccessToken(connectionId: string) {
  const supabase = createServiceClient();
  const { data: conn } = await supabase
    .from('google_calendar_connections')
    .select('*')
    .eq('id', connectionId)
    .single();
  if (!conn) return null;

  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (conn.access_token && expiresAt > Date.now() + 60_000) {
    return conn.access_token as string;
  }

  if (!conn.refresh_token) return null;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: conn.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const newExpiry = new Date(Date.now() + json.expires_in * 1000).toISOString();
  await supabase
    .from('google_calendar_connections')
    .update({ access_token: json.access_token, token_expires_at: newExpiry })
    .eq('id', connectionId);
  return json.access_token as string;
}

/**
 * Crea o actualiza el evento de Google Calendar correspondiente a una pieza aprobada/programada.
 * Usa calendar_event_links para evitar duplicados: si ya existe un evento, hace PATCH en vez de crear uno nuevo.
 */
export async function syncPieceToGoogleCalendar(
  piece: Pick<ContentPiece, 'id' | 'client_id' | 'title' | 'copy_text' | 'platform' | 'format' | 'scheduled_at'>,
  baseUrl: string,
  clientName: string,
  clientTimezone: string
) {
  const supabase = createServiceClient();

  const { data: mapping } = await supabase
    .from('client_calendar_mappings')
    .select('connection_id')
    .eq('client_id', piece.client_id)
    .maybeSingle();
  if (!mapping) return { skipped: 'sin_calendario_configurado' };

  const accessToken = await getFreshAccessToken(mapping.connection_id);
  if (!accessToken) return { skipped: 'sin_token_valido' };

  const { data: connection } = await supabase
    .from('google_calendar_connections')
    .select('calendar_id')
    .eq('id', mapping.connection_id)
    .single();
  if (!connection) return { skipped: 'sin_calendario' };

  const start = new Date(piece.scheduled_at);
  const end = new Date(start.getTime() + 30 * 60 * 1000);

  const eventBody = {
    summary: `[${clientName}] ${PLATFORM_LABELS[piece.platform]} · ${FORMAT_LABELS[piece.format]} — ${piece.title}`,
    description: `${piece.copy_text}\n\nFicha de contenido: ${baseUrl}/piezas/${piece.id}`,
    start: { dateTime: start.toISOString(), timeZone: clientTimezone },
    end: { dateTime: end.toISOString(), timeZone: clientTimezone },
  };

  const { data: existingLink } = await supabase
    .from('calendar_event_links')
    .select('*')
    .eq('content_piece_id', piece.id)
    .maybeSingle();

  const calendarId = connection.calendar_id;

  if (existingLink) {
    const res = await fetch(`${EVENTS_BASE}/${encodeURIComponent(calendarId)}/events/${existingLink.google_event_id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(eventBody),
    });
    if (!res.ok) return { error: await res.text() };
    await supabase
      .from('calendar_event_links')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', existingLink.id);
    return { updated: true };
  }

  const res = await fetch(`${EVENTS_BASE}/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(eventBody),
  });
  if (!res.ok) return { error: await res.text() };
  const created = await res.json();
  await supabase.from('calendar_event_links').insert({
    content_piece_id: piece.id,
    google_event_id: created.id,
    calendar_id: calendarId,
  });
  return { created: true };
}
