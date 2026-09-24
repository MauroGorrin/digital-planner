import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildWebhookPayload, dispatchWebhookEvent } from '@/lib/webhooks/dispatch';
import { createServiceClient } from '@/lib/supabase/server';
import type { ContentPiece } from '@/types/database';

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}));

const SECRET = 'test-secret-please-ignore';

type PayloadPiece = Pick<
  ContentPiece,
  'id' | 'client_id' | 'title' | 'status' | 'scheduled_at' | 'platform' | 'copy_text'
>;

const fixturePiece: PayloadPiece = {
  id: 'piece-1',
  client_id: 'client-1',
  title: 'Reel de lanzamiento',
  status: 'aprobado',
  scheduled_at: '2026-10-01T15:00:00.000Z',
  platform: 'instagram',
  copy_text: 'Ya viene algo nuevo.',
};

function mockSupabase(configs: Array<Record<string, unknown>>) {
  const insert = vi.fn().mockResolvedValue({ data: null, error: null });
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'webhook_configs') {
        return { select: () => ({ eq: () => Promise.resolve({ data: configs }) }) };
      }
      return { insert };
    }),
  };
  vi.mocked(createServiceClient).mockReturnValue(client as never);
  return { insert };
}

function activeConfig(events: string[]) {
  return { id: 'wh-1', url: 'https://example.com/hook', secret: SECRET, active: true, events };
}

function payloadFor(event: 'pieza_aprobada') {
  return buildWebhookPayload(event, fixturePiece, 'Ana Agencia', 'https://planner.test', 'Marca X');
}

describe('dispatchWebhookEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('firma el body con HMAC-SHA256 en X-Planner-Signature usando el secreto del webhook', async () => {
    mockSupabase([activeConfig(['pieza_aprobada'])]);
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const payload = payloadFor('pieza_aprobada');
    await dispatchWebhookEvent(payload);

    const expected = crypto
      .createHmac('sha256', SECRET)
      .update(JSON.stringify(payload))
      .digest('hex');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.com/hook');
    expect(init.headers['X-Planner-Signature']).toBe(expected);
    expect(init.body).toBe(JSON.stringify(payload));
  });

  it('envía los headers X-Planner-Event y Content-Type', async () => {
    mockSupabase([activeConfig(['pieza_aprobada'])]);
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await dispatchWebhookEvent(payloadFor('pieza_aprobada'));

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['X-Planner-Event']).toBe('pieza_aprobada');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('registra la entrega con response_status 200 y error null cuando el receptor responde 200', async () => {
    const { insert } = mockSupabase([activeConfig(['pieza_aprobada'])]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }));

    await dispatchWebhookEvent(payloadFor('pieza_aprobada'));

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        webhook_config_id: 'wh-1',
        event_type: 'pieza_aprobada',
        response_status: 200,
        error: null,
      })
    );
  });

  it('no llama a fetch para un webhook que no está suscrito a ese evento', async () => {
    mockSupabase([activeConfig(['comentario_agregado'])]);
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await dispatchWebhookEvent(payloadFor('pieza_aprobada'));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('registra el error de red sin propagarlo cuando fetch falla', async () => {
    const { insert } = mockSupabase([activeConfig(['pieza_aprobada'])]);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket hang up')));

    await expect(dispatchWebhookEvent(payloadFor('pieza_aprobada'))).resolves.toBeUndefined();

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        response_status: null,
        error: 'socket hang up',
      })
    );
  });
});
