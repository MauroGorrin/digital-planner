import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/AppShell';
import { PendingList } from '@/components/PendingList';
import type { ContentPiece, Idea } from '@/types/database';

export default async function PendientesPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const [{ data: pieces }, { data: ideas }] = await Promise.all([
    supabase
      .from('content_pieces')
      .select('*, clients(id,name,brand_name,timezone), assignee:profiles!content_pieces_assignee_id_fkey(id,full_name)')
      .in('status', ['pendiente_revision_interna', 'pendiente_revision', 'cambios_solicitados', 'aprobado', 'programado'])
      .order('scheduled_at'),
    supabase
      .from('ideas')
      .select('*, clients(id,name,brand_name)')
      .in('status', ['pendiente_cliente', 'correccion_cliente'])
      .order('created_at', { ascending: false }),
  ]);

  return (
    <AppShell profile={profile}>
      <PendingList profile={profile} pieces={(pieces ?? []) as ContentPiece[]} ideas={(ideas ?? []) as Idea[]} />
    </AppShell>
  );
}
