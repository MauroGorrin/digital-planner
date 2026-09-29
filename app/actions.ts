'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireProfile, requireAgency } from '@/lib/auth';
import { dispatchWebhookEvent, buildWebhookPayload } from '@/lib/webhooks/dispatch';
import { syncPieceToGoogleCalendar } from '@/lib/google-calendar/sync';
import { enlaceDeReferenciaValidado } from '@/lib/url-segura';
import type { ContentFormat, ContentPiece, PlatformType } from '@/types/database';
import { errorParaElCliente } from '@/lib/errores';

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}

async function loadPieceWithClient(pieceId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('content_pieces')
    .select('*, clients(id,name,brand_name,timezone)')
    .eq('id', pieceId)
    .single();
  return data as (ContentPiece & { clients: { id: string; name: string; brand_name: string; timezone: string } }) | null;
}

async function maybeSyncCalendar(piece: ContentPiece & { clients: { name: string; timezone: string } }) {
  if (piece.status === 'aprobado' || piece.status === 'programado') {
    await syncPieceToGoogleCalendar(piece, getBaseUrl(), piece.clients.name, piece.clients.timezone);
  }
}

export async function createContentPiece(input: {
  client_id: string;
  platform: PlatformType;
  format: ContentFormat;
  title: string;
  copy_text: string;
  reference_link?: string;
  scheduled_at: string;
  assignee_id?: string;
}) {
  const profile = await requireAgency();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_pieces')
    // Sin `status`: la columna tiene default 'borrador' not null, y `authenticated` ya no tiene
    // privilegio de insert sobre ella (0007_endurecimiento_privilegios.sql). Mandarla, aunque fuera
    // con el mismo valor del default, haría fallar el insert con un 42501.
    // El enlace se valida aqui y no solo en el navegador: el 'type=url' del formulario es del
    // navegador y de todos modos acepta 'javascript:' (CN-008). El CHECK de 0007 cubre la base de
    // datos; esta linea es la mitad de aplicacion, y lanza en espanol en vez de anular en silencio
    // un enlace que la persona escribio.
    .insert({ ...input, reference_link: enlaceDeReferenciaValidado(input.reference_link), created_by: profile.id })
    .select('id')
    .single();
  if (error) throw errorParaElCliente(error, 'createContentPiece');
  revalidatePath('/calendario');
  revalidatePath('/pendientes');
  return data.id as string;
}

// Los campos de contenido que la agencia sí edita directamente. `status` y `client_id` no están y no
// deben estar: el estado lo mueven las RPC de transición (que dejan status_history y approvals) y la
// marca de una pieza no cambia nunca.
const CAMPOS_EDITABLES: string[] = [
  'platform',
  'format',
  'title',
  'copy_text',
  'reference_link',
  'scheduled_at',
  'assignee_id',
];

export async function updateContentPiece(
  id: string,
  input: Partial<{
    platform: PlatformType;
    format: ContentFormat;
    title: string;
    copy_text: string;
    reference_link: string | null;
    scheduled_at: string;
    assignee_id: string | null;
  }>
) {
  await requireAgency();
  const supabase = await createClient();
  // Lista explícita en vez de esparcir el objeto del llamador. Una Server Action es un endpoint HTTP
  // y el `Partial<…>` de arriba se borra al compilar, así que el tipo NO es un control: quien llame
  // manda las claves que quiera, incluidas `status` y `client_id`. El privilegio de columna de
  // 0007_endurecimiento_privilegios.sql ya rechazaría esas dos, pero eso daría un 42501 crudo en la
  // cara del usuario en vez de ignorar en silencio un campo que nunca debió llegar.
  const limpio = Object.fromEntries(Object.entries(input).filter(([clave]) => CAMPOS_EDITABLES.includes(clave)));
  // Mismo criterio que en createContentPiece (CN-008). Solo si la clave vino: un update parcial que
  // no toca el enlace no debe escribir null encima del que ya estaba guardado.
  if ('reference_link' in limpio) {
    limpio.reference_link = enlaceDeReferenciaValidado(limpio.reference_link as string | null);
  }
  const { error } = await supabase.from('content_pieces').update(limpio).eq('id', id);
  if (error) throw errorParaElCliente(error, 'updateContentPiece');
  revalidatePath('/calendario');
  revalidatePath(`/piezas/${id}`);
}

export async function duplicateContentPiece(id: string) {
  const profile = await requireAgency();
  const supabase = await createClient();
  const { data: original } = await supabase.from('content_pieces').select('*').eq('id', id).single();
  if (!original) throw new Error('Pieza no encontrada');
  const { data, error } = await supabase
    .from('content_pieces')
    .insert({
      client_id: original.client_id,
      platform: original.platform,
      format: original.format,
      title: `${original.title} (copia)`,
      copy_text: original.copy_text,
      reference_link: original.reference_link,
      scheduled_at: original.scheduled_at,
      assignee_id: original.assignee_id,
      created_by: profile.id,
      // Igual que en createContentPiece: el default de la columna pone 'borrador' y mandarlo aquí
      // fallaría con 42501. Una copia nace en borrador aunque el original estuviera aprobado, que es
      // justo lo que hacía esta línea explícita.
      duplicated_from: id,
    })
    .select('id')
    .single();
  if (error) throw errorParaElCliente(error, 'duplicateContentPiece');
  revalidatePath('/calendario');
  return data.id as string;
}

export async function deleteContentPiece(id: string) {
  await requireAgency();
  const supabase = await createClient();
  const { error } = await supabase.from('content_pieces').delete().eq('id', id);
  if (error) throw errorParaElCliente(error, 'deleteContentPiece');
  revalidatePath('/calendario');
}

export async function rescheduleContentPiece(id: string, newScheduledAt: string) {
  const profile = await requireAgency();
  const supabase = await createClient();
  const { error } = await supabase.rpc('reschedule_content_piece', {
    p_content_piece_id: id,
    p_new_scheduled_at: newScheduledAt,
  });
  if (error) throw errorParaElCliente(error, 'rescheduleContentPiece');

  const piece = await loadPieceWithClient(id);
  if (piece) {
    await dispatchWebhookEvent(
      buildWebhookPayload('fecha_cambiada', piece, profile.full_name, getBaseUrl(), piece.clients.brand_name)
    );
    await maybeSyncCalendar(piece);
  }
  revalidatePath('/calendario');
  revalidatePath(`/piezas/${id}`);
}

export async function submitForReview(id: string) {
  const profile = await requireAgency();
  const supabase = await createClient();
  const { error } = await supabase.rpc('submit_for_review', { p_content_piece_id: id });
  if (error) throw errorParaElCliente(error, 'submitForReview');
  const piece = await loadPieceWithClient(id);
  if (piece) {
    await dispatchWebhookEvent(
      buildWebhookPayload('pieza_creada_revision', piece, profile.full_name, getBaseUrl(), piece.clients.brand_name)
    );
  }
  revalidatePath('/calendario');
  revalidatePath('/pendientes');
  revalidatePath(`/piezas/${id}`);
}

export async function submitForInternalReview(id: string) {
  const profile = await requireAgency();
  const supabase = await createClient();
  const { error } = await supabase.rpc('submit_for_internal_review', { p_content_piece_id: id });
  if (error) throw errorParaElCliente(error, 'submitForInternalReview');
  const piece = await loadPieceWithClient(id);
  if (piece) {
    await dispatchWebhookEvent(
      buildWebhookPayload('pieza_enviada_a_revision_interna', piece, profile.full_name, getBaseUrl(), piece.clients.brand_name)
    );
  }
  revalidatePath('/calendario');
  revalidatePath('/pendientes');
  revalidatePath(`/piezas/${id}`);
}

export async function approveInternalReview(id: string) {
  const profile = await requireAgency();
  const supabase = await createClient();
  const { error } = await supabase.rpc('approve_internal_review', { p_content_piece_id: id });
  if (error) throw errorParaElCliente(error, 'approveInternalReview');
  const piece = await loadPieceWithClient(id);
  if (piece) {
    // Mismo evento que submitForReview: es el mismo momento semántico (el cliente se entera),
    // solo que ahora se llega aquí después del visto bueno interno.
    await dispatchWebhookEvent(
      buildWebhookPayload('pieza_creada_revision', piece, profile.full_name, getBaseUrl(), piece.clients.brand_name)
    );
  }
  revalidatePath('/calendario');
  revalidatePath('/pendientes');
  revalidatePath(`/piezas/${id}`);
}

export async function requestInternalChanges(id: string, note: string) {
  await requireAgency();
  const supabase = await createClient();
  const { error } = await supabase.rpc('request_internal_changes', { p_content_piece_id: id, p_note: note });
  if (error) throw errorParaElCliente(error, 'requestInternalChanges');
  revalidatePath('/calendario');
  revalidatePath('/pendientes');
  revalidatePath(`/piezas/${id}`);
}

export async function approvePiece(id: string, note?: string) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('approve_content_piece', { p_content_piece_id: id, p_note: note ?? null });
  if (error) throw errorParaElCliente(error, 'approvePiece');
  const piece = await loadPieceWithClient(id);
  if (piece) {
    await dispatchWebhookEvent(
      buildWebhookPayload('pieza_aprobada', piece, profile.full_name, getBaseUrl(), piece.clients.brand_name, note)
    );
    await maybeSyncCalendar(piece);
  }
  revalidatePath('/calendario');
  revalidatePath('/pendientes');
  revalidatePath(`/piezas/${id}`);
}

export async function requestPieceChanges(id: string, note: string) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('request_changes', { p_content_piece_id: id, p_note: note });
  if (error) throw errorParaElCliente(error, 'requestPieceChanges');
  const piece = await loadPieceWithClient(id);
  if (piece) {
    await dispatchWebhookEvent(
      buildWebhookPayload('cambios_solicitados', piece, profile.full_name, getBaseUrl(), piece.clients.brand_name, note)
    );
  }
  revalidatePath('/calendario');
  revalidatePath('/pendientes');
  revalidatePath(`/piezas/${id}`);
}

export async function markPieceScheduled(id: string) {
  const profile = await requireAgency();
  const supabase = await createClient();
  const { error } = await supabase.rpc('mark_scheduled', { p_content_piece_id: id });
  if (error) throw errorParaElCliente(error, 'markPieceScheduled');
  const piece = await loadPieceWithClient(id);
  if (piece) {
    await dispatchWebhookEvent(
      buildWebhookPayload('pieza_programada', piece, profile.full_name, getBaseUrl(), piece.clients.brand_name)
    );
    await maybeSyncCalendar(piece);
  }
  revalidatePath('/calendario');
  revalidatePath(`/piezas/${id}`);
}

export async function markPiecePublished(id: string) {
  const profile = await requireAgency();
  const supabase = await createClient();
  const { error } = await supabase.rpc('mark_published', { p_content_piece_id: id });
  if (error) throw errorParaElCliente(error, 'markPiecePublished');
  const piece = await loadPieceWithClient(id);
  if (piece) {
    await dispatchWebhookEvent(
      buildWebhookPayload('pieza_publicada', piece, profile.full_name, getBaseUrl(), piece.clients.brand_name)
    );
  }
  revalidatePath('/calendario');
  revalidatePath(`/piezas/${id}`);
}

export async function cancelPiece(id: string, reason: string) {
  await requireAgency();
  const supabase = await createClient();
  const { error } = await supabase.rpc('cancel_content_piece', { p_content_piece_id: id, p_reason: reason });
  if (error) throw errorParaElCliente(error, 'cancelPiece');
  revalidatePath('/calendario');
  revalidatePath(`/piezas/${id}`);
}

export async function addComment(
  id: string,
  body: string,
  parentId?: string,
  ancla?: { attachmentId: string; videoSegundo: number }
) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from('comments').insert({
    content_piece_id: id,
    author_id: profile.id,
    body,
    parent_comment_id: parentId ?? null,
    attachment_id: ancla?.attachmentId ?? null,
    video_segundo: ancla?.videoSegundo ?? null,
  });
  if (error) throw errorParaElCliente(error, 'addComment');

  const piece = await loadPieceWithClient(id);
  if (piece) {
    await dispatchWebhookEvent(
      buildWebhookPayload('comentario_agregado', piece, profile.full_name, getBaseUrl(), piece.clients.brand_name, body)
    );
    // Notifica a la contraparte (agencia <-> cliente). Antes esto insertaba en `notifications`
    // directamente y sin comprobar el error: `notifications` no tiene política de INSERT, la RLS
    // denegaba cada fila y la notificación nunca llegaba -- durante meses, sin un solo error visible
    // (CN-015). La RPC deriva los destinatarios en el servidor; la política de INSERT no se agregó a
    // propósito, porque dejaría a cualquier usuario fabricar notificaciones para quien quisiera.
    const { error: notificacionError } = await supabase.rpc('notify_comment', {
      p_content_piece_id: id,
      p_body: body,
    });
    if (notificacionError) throw errorParaElCliente(notificacionError, 'addComment');
  }
  revalidatePath(`/piezas/${id}`);
}

export async function deleteAttachment(attachmentId: string, pieceId: string) {
  await requireAgency();
  const supabase = await createClient();
  const { data: attachment } = await supabase.from('attachments').select('file_path').eq('id', attachmentId).single();
  if (attachment) {
    await supabase.storage.from('attachments').remove([attachment.file_path]);
  }
  const { error } = await supabase.from('attachments').delete().eq('id', attachmentId);
  if (error) throw errorParaElCliente(error, 'deleteAttachment');
  revalidatePath(`/piezas/${pieceId}`);
}
