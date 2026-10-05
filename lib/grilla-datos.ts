import type { SupabaseClient } from '@supabase/supabase-js';
import { adjuntoDePortada } from '@/lib/attachments';
import type { VistaPieza } from '@/lib/grilla';
import type { Attachment, ContentPiece } from '@/types/database';

/** Solo estados públicos para la grilla. Nunca aparecen aquí los de revisión. */
export const ESTADOS_EN_GRILLA = ['aprobado', 'programado', 'publicado'];

type Cliente = { brand_name: string; timezone: string };

type FilaPieza = Pick<
  ContentPiece,
  'id' | 'client_id' | 'platform' | 'format' | 'title' | 'copy_text' | 'scheduled_at' | 'status'
> & { clients: Cliente | Cliente[] | null };

export interface FiltrosDeGrilla {
  /** Solo una marca. Sin esto, la sesión de agencia ve todas sus marcas. */
  clientId?: string;
  /** Rango [desde, hasta) en ISO. */
  desde?: string;
  hasta?: string;
  orden: 'asc' | 'desc';
}

/**
 * Carga las piezas públicas de la grilla y les firma la portada. Recibe el cliente de Supabase ya
 * elegido por quien llama: sesión (la RLS decide) en la app, servicio en la ruta pública (la firma
 * del enlace es el control de acceso). Esta función no decide permisos por sí misma.
 */
export async function cargarVistasDeGrilla(
  supabase: SupabaseClient,
  filtros: FiltrosDeGrilla
): Promise<VistaPieza[]> {
  let consulta = supabase
    .from('content_pieces')
    .select('id,client_id,platform,format,title,copy_text,scheduled_at,status,clients(brand_name,timezone)')
    .in('status', ESTADOS_EN_GRILLA)
    .order('scheduled_at', { ascending: filtros.orden === 'asc' });
  if (filtros.clientId) consulta = consulta.eq('client_id', filtros.clientId);
  if (filtros.desde) consulta = consulta.gte('scheduled_at', filtros.desde);
  if (filtros.hasta) consulta = consulta.lt('scheduled_at', filtros.hasta);

  const { data: filas } = await consulta;
  const piezas = (filas ?? []) as unknown as FilaPieza[];
  const ids = piezas.map((p) => p.id);

  const porPieza = new Map<string, Attachment[]>();
  if (ids.length > 0) {
    const { data: adjuntos } = await supabase.from('attachments').select('*').in('content_piece_id', ids);
    for (const adjunto of (adjuntos ?? []) as Attachment[]) {
      const lista = porPieza.get(adjunto.content_piece_id) ?? [];
      lista.push(adjunto);
      porPieza.set(adjunto.content_piece_id, lista);
    }
  }

  const portadas = new Map<string, Attachment>();
  for (const [pieceId, lista] of porPieza) {
    const portada = adjuntoDePortada(lista);
    if (portada) portadas.set(pieceId, portada);
  }

  // Una sola llamada para firmar todas las portadas (TTL de una hora).
  const urlsFirmadas: Record<string, string> = {};
  const conPortada = [...portadas.entries()].filter(([, portada]) => !portada.file_type?.startsWith('video/'));
  if (conPortada.length > 0) {
    const { data: firmadas } = await supabase.storage
      .from('attachments')
      .createSignedUrls(
        conPortada.map(([, portada]) => portada.file_path),
        3600
      );
    (firmadas ?? []).forEach((firmada, i) => {
      if (firmada.signedUrl) urlsFirmadas[conPortada[i][0]] = firmada.signedUrl;
    });
  }

  return piezas.map((fila) => {
    const cliente = Array.isArray(fila.clients) ? fila.clients[0] : fila.clients;
    const portada = portadas.get(fila.id) ?? null;
    const esVideo = portada?.file_type?.startsWith('video/') ?? false;
    return {
      id: fila.id,
      client_id: fila.client_id,
      title: fila.title,
      copy_text: fila.copy_text,
      platform: fila.platform,
      format: fila.format,
      scheduled_at: fila.scheduled_at,
      status: fila.status,
      brand_name: cliente?.brand_name ?? '',
      timezone: cliente?.timezone ?? 'UTC',
      portadaUrl: esVideo ? null : (urlsFirmadas[fila.id] ?? null),
      portadaEsVideo: esVideo,
    };
  });
}
