'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireProfile, requireAgency } from '@/lib/auth';
import { dispatchWebhookEvent, buildWebhookPayload } from '@/lib/webhooks/dispatch';
import { syncPieceToGoogleCalendar } from '@/lib/google-calendar/sync';
import type { ContentFormat, ContentPiece, PlatformType } from '@/types/database';

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}

async function loadPieceWithClient(pieceId: string) {
  const supabase = createClient();
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
  const supabase = createClient();
  const { data, error } = await supabase
    .from('content_pieces')
    .insert({ ...input, created_by: profile.id, status: 'borrador' })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  revalidatePath('/calendario');
  revalidatePath('/pendientes');
  return data.id as string;
}

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
  const supabase = createClient();
  const { error } = await supabase.from('content_pieces').update(input).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/calendario');
  revalidatePath(`/piezas/${id}`);
}

export async function duplicateContentPiece(id: string) {
  const profile = await requireAgency();
  const supabase = createClient();
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
      status: 'borrador',
      duplicated_from: id,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  revalidatePath('/calendario');
  return data.id as string;
}

export async function deleteContentPiece(id: string) {
  await requireAgency();
  const supabase = createClient();
  const { error } = await supabase.from('content_pieces').delete().eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/calendario');
}

export async function rescheduleContentPiece(id: string, newScheduledAt: string) {
  const profile = await requireAgency();
  const supabase = createClient();
  const { error } = await supabase.rpc('reschedule_content_piece', {
    p_content_piece_id: id,
    p_new_scheduled_at: newScheduledAt,
  });
  if (error) throw new Error(error.message);

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
  const supabase = createClient();
  const { error } = await supabase.rpc('submit_for_review', { p_content_piece_id: id });
  if (error) throw new Error(error.message);
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

export async function approvePiece(id: string, note?: string) {
  const profile = await requireProfile();
  const supabase = createClient();
  const { error } = await supabase.rpc('approve_content_piece', { p_content_piece_id: id, p_note: note ?? null });
  if (error) throw new Error(error.message);
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
  const supabase = createClient();
  const { error } = await supabase.rpc('request_changes', { p_content_piece_id: id, p_note: note });
  if (error) throw new Error(error.message);
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
  const supabase = createClient();
  const { error } = await supabase.rpc('mark_scheduled', { p_content_piece_id: id });
  if (error) throw new Error(error.message);
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
  const supabase = createClient();
  const { error } = await supabase.rpc('mark_published', { p_content_piece_id: id });
  if (error) throw new Error(error.message);
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
  const supabase = createClient();
  const { error } = await supabase.rpc('cancel_content_piece', { p_content_piece_id: id, p_reason: reason });
  if (error) throw new Error(error.message);
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
  const supabase = createClient();
  const { error } = await supabase.from('comments').insert({
    content_piece_id: id,
    author_id: profile.id,
    body,
    parent_comment_id: parentId ?? null,
    attachment_id: ancla?.attachmentId ?? null,
    video_segundo: ancla?.videoSegundo ?? null,
  });
  if (error) throw new Error(error.message);

  const piece = await loadPieceWithClient(id);
  if (piece) {
    await dispatchWebhookEvent(
      buildWebhookPayload('comentario_agregado', piece, profile.full_name, getBaseUrl(), piece.clients.brand_name, body)
    );
    // Notifica a la contraparte (agencia <-> cliente)
    const { data: contacts } = await supabase.from('client_contacts').select('profile_id').eq('client_id', piece.client_id);
    const { data: assignments } = await supabase
      .from('client_assignments')
      .select('profile_id')
      .eq('client_id', piece.client_id);
    const targets =
      profile.role === 'client'
        ? (assignments ?? []).map((a) => a.profile_id)
        : (contacts ?? []).map((c) => c.profile_id);
    if (targets.length > 0) {
      await supabase.from('notifications').insert(
        targets.map((profile_id) => ({
          profile_id,
          content_piece_id: id,
          type: 'comentario',
          title: `Nuevo comentario de ${profile.full_name}`,
          body: body.slice(0, 140),
        }))
      );
    }
  }
  revalidatePath(`/piezas/${id}`);
}

export async function deleteAttachment(attachmentId: string, pieceId: string) {
  await requireAgency();
  const supabase = createClient();
  const { data: attachment } = await supabase.from('attachments').select('file_path').eq('id', attachmentId).single();
  if (attachment) {
    await supabase.storage.from('attachments').remove([attachment.file_path]);
  }
  const { error } = await supabase.from('attachments').delete().eq('id', attachmentId);
  if (error) throw new Error(error.message);
  revalidatePath(`/piezas/${pieceId}`);
}
