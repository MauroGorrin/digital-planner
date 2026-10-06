import { notFound } from 'next/navigation';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/AppShell';
import { ContentPieceDetail } from '@/components/ContentPieceDetail';
import type { Attachment, Client, Comment, ContentPiece, StatusHistoryEntry } from '@/types/database';

export default async function ContentPiecePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: piece } = await supabase
    .from('content_pieces')
    .select('*, clients(id,name,brand_name,timezone), assignee:profiles!content_pieces_assignee_id_fkey(id,full_name)')
    .eq('id', params.id)
    .single();

  if (!piece) notFound();

  const [{ data: attachments }, { data: comments }, { data: history }] = await Promise.all([
    supabase.from('attachments').select('*').eq('content_piece_id', params.id).order('created_at'),
    supabase
      .from('comments')
      .select('*, author:profiles(id,full_name,role)')
      .eq('content_piece_id', params.id)
      .order('created_at'),
    supabase
      .from('status_history')
      .select('*, changed_by_profile:profiles(full_name)')
      .eq('content_piece_id', params.id)
      .order('created_at', { ascending: false }),
  ]);

  // Quién puede aprobar o pedir cambios se decide por `client_contacts`, no por el rol: un
  // `agency_admin` en "modo de prueba" (app/admin-actions.ts) también queda en esa tabla, y tiene
  // que ver los mismos botones que vería el cliente real -- la RPC detrás ya lo exige igual
  // (`approve_content_piece` rechaza a cualquiera que no esté en `client_contacts`, sea cual sea su
  // rol), así que esto solo deja de ocultar en la UI lo que la base ya autorizaría.
  const { data: filaDeContacto } = await supabase
    .from('client_contacts')
    .select('id')
    .eq('client_id', piece.client_id)
    .eq('profile_id', profile.id)
    .maybeSingle();
  const isClientContact = filaDeContacto !== null;

  const listaAdjuntos = (attachments ?? []) as Attachment[];

  const urlsFirmadas: Record<string, string> = {};
  if (listaAdjuntos.length > 0) {
    const { data: firmadas } = await supabase.storage
      .from('attachments')
      .createSignedUrls(
        listaAdjuntos.map((a) => a.file_path),
        3600
      );
    for (const [i, firmada] of (firmadas ?? []).entries()) {
      if (firmada.signedUrl) urlsFirmadas[listaAdjuntos[i].id] = firmada.signedUrl;
    }
  }

  return (
    <AppShell profile={profile}>
      <ContentPieceDetail
        profile={profile}
        piece={piece as ContentPiece & { clients: Client }}
        attachments={listaAdjuntos}
        urls={urlsFirmadas}
        comments={(comments ?? []) as Comment[]}
        history={(history ?? []) as StatusHistoryEntry[]}
        isClientContact={isClientContact}
      />
    </AppShell>
  );
}
