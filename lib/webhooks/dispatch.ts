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
  | 'pieza_publicada'
  // Se dispara al entrar a revisión interna (antes de que la vea el cliente). Nadie lo recibe
  // salvo que lo agregue a mano al array `events` de su webhook -- ver
  // docs/superpowers/specs/2026-09-29-revision-interna-de-piezas-design.md.
  | 'pieza_enviada_a_revision_interna';

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

  // La agencia dueña de la marca de la pieza. Se resuelve aquí y no se recibe por parámetro porque
  // quien llama es una Server Action -- un endpoint HTTP -- y un `agency_id` que viajara en la
  // llamada sería un dato que el navegador puede cambiar.
  //
  // POR QUÉ ESTO NO ES OPCIONAL: esta función corre con el cliente de SERVICIO, que salta la RLS. El
  // aislamiento de `0010_aislamiento_por_agencia.sql` no la alcanza. Sin este filtro, una pieza de la
  // agencia A se enviaba, firmada y completa (título, copy, estado, marca), al endpoint de Make de
  // TODAS las demás agencias -- una fuga entre inquilinos que además sale del producto.
  const { data: marca } = await supabase
    .from('clients')
    .select('agency_id')
    .eq('id', payload.client_id)
    .maybeSingle();
  const agencyId = marca?.agency_id as string | null | undefined;
  // Sin agencia no hay a quién avisar. Se corta en vez de enviar a todos: en la duda no se manda.
  if (!agencyId) return;

  const { data: configs } = await supabase
    .from('webhook_configs')
    .select('id, url, secret, active, events, agency_id')
    .eq('active', true);

  if (!configs || configs.length === 0) return;

  const relevant = configs.filter(
    (c: { events: string[]; agency_id?: string | null }) =>
      c.agency_id === agencyId && c.events.includes(payload.event)
  );
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
          // Sin timeout, un destino que no responde cuelga el Promise.all de abajo y con el la
          // Server Action que disparo la transicion: el problema de disponibilidad de CN-009, que
          // es independiente del SSRF. Diez segundos es de sobra para un webhook.
          signal: AbortSignal.timeout(10_000),
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
