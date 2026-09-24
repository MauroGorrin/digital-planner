import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { syncPieceToGoogleCalendar } from '@/lib/google-calendar/sync';
import { createServiceClient } from '@/lib/supabase/server';
import type { ContentPiece } from '@/types/database';

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}));

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const EVENTS_BASE = 'https://www.googleapis.com/calendar/v3/calendars';

type CalendarPiece = Pick<
  ContentPiece,
  'id' | 'client_id' | 'title' | 'copy_text' | 'platform' | 'format' | 'scheduled_at'
>;

const piece: CalendarPiece = {
  id: 'piece-1',
  client_id: 'client-1',
  title: 'Reel de lanzamiento',
  copy_text: 'Ya viene algo nuevo.',
  platform: 'instagram',
  format: 'reel',
  scheduled_at: '2026-10-01T15:00:00.000Z',
};

interface Scenario {
  mapping?: { connection_id: string } | null;
  connection?: Record<string, unknown> | null;
  existingLink?: Record<string, unknown> | null;
}

function mockSupabase({ mapping = { connection_id: 'conn-1' }, connection, existingLink = null }: Scenario) {
  const conn = connection === undefined
    ? {
        id: 'conn-1',
        calendar_id: 'agenda@example.com',
        access_token: 'token-vigente',
        token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        refresh_token: 'refresh-1',
      }
    : connection;

  const linkInsert = vi.fn().mockResolvedValue({ data: null, error: null });
  const linkUpdate = vi.fn(() => ({ eq: () => Promise.resolve({ data: null, error: null }) }));
  const connUpdate = vi.fn(() => ({ eq: () => Promise.resolve({ data: null, error: null }) }));

  const client = {
    from: vi.fn((table: string) => {
      if (table === 'client_calendar_mappings') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: mapping }) }) }) };
      }
      if (table === 'google_calendar_connections') {
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: conn }) }) }),
          update: connUpdate,
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: existingLink }) }) }),
        insert: linkInsert,
        update: linkUpdate,
      };
    }),
  };

  vi.mocked(createServiceClient).mockReturnValue(client as never);
  return { linkInsert, linkUpdate, connUpdate };
}

function sync() {
  return syncPieceToGoogleCalendar(piece, 'https://planner.test', 'Marca X', 'America/Mexico_City');
}

describe('syncPieceToGoogleCalendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('se salta el cliente que no tiene calendario configurado, sin llamar a la API', async () => {
    mockSupabase({ mapping: null });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(sync()).resolves.toEqual({ skipped: 'sin_calendario_configurado' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('crea el evento con POST y guarda el vínculo cuando la pieza aún no tiene uno', async () => {
    const { linkInsert } = mockSupabase({});
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ id: 'gcal-evt-1' }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(sync()).resolves.toEqual({ created: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(url).toBe(`${EVENTS_BASE}/${encodeURIComponent('agenda@example.com')}/events`);
    expect(linkInsert).toHaveBeenCalledWith(
      expect.objectContaining({ content_piece_id: 'piece-1', google_event_id: 'gcal-evt-1' })
    );
  });

  it('actualiza con PATCH el evento existente y no crea un segundo vínculo al reprogramar', async () => {
    const { linkInsert } = mockSupabase({
      existingLink: { id: 'link-1', google_event_id: 'gcal-evt-1', content_piece_id: 'piece-1' },
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(sync()).resolves.toEqual({ updated: true });

    const [url, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('PATCH');
    expect(url).toBe(
      `${EVENTS_BASE}/${encodeURIComponent('agenda@example.com')}/events/gcal-evt-1`
    );
    expect(linkInsert).not.toHaveBeenCalled();
  });

  it('refresca el token contra el endpoint OAuth antes de llamar al calendario si expiró', async () => {
    mockSupabase({
      connection: {
        id: 'conn-1',
        calendar_id: 'agenda@example.com',
        access_token: 'token-vencido',
        token_expires_at: new Date(Date.now() - 3_600_000).toISOString(),
        refresh_token: 'refresh-1',
      },
    });

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === TOKEN_URL) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ access_token: 'token-nuevo', expires_in: 3600 }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ id: 'gcal-evt-1' }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(sync()).resolves.toEqual({ created: true });

    expect(fetchMock.mock.calls[0][0]).toBe(TOKEN_URL);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer token-nuevo');
  });

  it('devuelve el error del calendario y no escribe el vínculo si la API responde no-OK', async () => {
    const { linkInsert } = mockSupabase({});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, text: async () => 'calendarId no encontrado' })
    );

    await expect(sync()).resolves.toEqual({ error: 'calendarId no encontrado' });
    expect(linkInsert).not.toHaveBeenCalled();
  });
});
