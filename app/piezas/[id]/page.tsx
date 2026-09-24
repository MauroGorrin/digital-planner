import { notFound } from 'next/navigation';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/AppShell';
import { ContentPieceDetail } from '@/components/ContentPieceDetail';
import type { Attachment, Client, Comment, ContentPiece, StatusHistoryEntry } from '@/types/database';

export default async function ContentPiecePage({ params }: { params: { id: string } }) {
  const profile = await requireProfile();
  const supabase = createClient();

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

  const isClientContact = profile.role === 'client';

  return (
    <AppShell profile={profile}>
      <ContentPieceDetail
        profile={profile}
        piece={piece as ContentPiece & { clients: Client }}
        attachments={(attachments ?? []) as Attachment[]}
        comments={(comments ?? []) as Comment[]}
        history={(history ?? []) as StatusHistoryEntry[]}
        isClientContact={isClientContact}
      />
    </AppShell>
  );
}
