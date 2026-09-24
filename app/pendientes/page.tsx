import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/AppShell';
import { PendingList } from '@/components/PendingList';
import type { ContentPiece } from '@/types/database';

export default async function PendientesPage() {
  const profile = await requireProfile();
  const supabase = createClient();

  const { data: pieces } = await supabase
    .from('content_pieces')
    .select('*, clients(id,name,brand_name,timezone), assignee:profiles!content_pieces_assignee_id_fkey(id,full_name)')
    .in('status', ['pendiente_revision', 'cambios_solicitados', 'aprobado', 'programado'])
    .order('scheduled_at');

  return (
    <AppShell profile={profile}>
      <PendingList profile={profile} pieces={(pieces ?? []) as ContentPiece[]} />
    </AppShell>
  );
}
