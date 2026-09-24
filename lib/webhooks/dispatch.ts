import crypto from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';
import type { ContentPiece } from '@/types/database';

export type WebhookEventType =
  | 'pieza_creada_revision'
  | 'pieza_aprobada'
  | 'cambios_solicitados'
  | 'comentario_agregado'
  | 'fecha_cambiada'
  | 'pieza_programada'
  | 'pieza_publicada';

interface DispatchPayload {
  event: WebhookEventType;
  piece_id: string;
  client_id: string;
  client_name?: string;
  title: string;
  status: string;
  scheduled_at: string;
  platform: string;
  copy_text: string;
  changed_by: string;
  content_url: string;
  note?: string;
}

/**
 * Envía el evento a todos los webhooks activos suscritos a ese tipo de evento.
 * Se ejecuta únicamente en el servidor: la clave secreta nunca llega al navegador.
 * Firma el payload con HMAC-SHA256 en el header X-Planner-Signature para que Make (u otro
 * receptor) pueda verificar la autenticidad.
 */
export async function dispatchWebhookEvent(payload: DispatchPayload) {
  const supabase = createServiceClient();
  const { data: configs } = await supabase
    .from('webhook_configs')
    .select('id, url, secret, active, events')
    .eq('active', true);

  if (!configs || configs.length === 0) return;

  const relevant = configs.filter((c: { events: string[] }) => c.events.includes(payload.event));
  const body = JSON.stringify(payload);

  await Promise.all(
    relevant.map(async (config: { id: string; url: string; secret: string }) => {
      const signature = crypto.createHmac('sha256', config.secret).update(body).digest('hex');
      let responseStatus: number | null = null;
      let error: string | null = null;
      try {
        const res = await fetch(config.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Planner-Signature': signature,
            'X-Planner-Event': payload.event,
          },
          body,
        });
        responseStatus = res.status;
      } catch (err) {
        error = err instanceof Error ? err.message : 'Error desconocido';
      }
      await supabase.from('webhook_deliveries').insert({
        webhook_config_id: config.id,
        event_type: payload.event,
        payload,
        response_status: responseStatus,
        error,
      });
    })
  );
}

export function buildWebhookPayload(
  event: WebhookEventType,
  piece: Pick<ContentPiece, 'id' | 'client_id' | 'title' | 'status' | 'scheduled_at' | 'platform' | 'copy_text'>,
  changedBy: string,
  baseUrl: string,
  clientName?: string,
  note?: string
): DispatchPayload {
  return {
    event,
    piece_id: piece.id,
    client_id: piece.client_id,
    client_name: clientName,
    title: piece.title,
    status: piece.status,
    scheduled_at: piece.scheduled_at,
    platform: piece.platform,
    copy_text: piece.copy_text,
    changed_by: changedBy,
    content_url: `${baseUrl}/piezas/${piece.id}`,
    note,
  };
}
