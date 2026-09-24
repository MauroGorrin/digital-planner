import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/AppShell';
import { CalendarBoard } from '@/components/CalendarBoard';
import { getMonthGridRange, getWeekRange } from '@/lib/date-utils';
import type { Client, ContentPiece } from '@/types/database';

export default async function CalendarioPage({
  searchParams,
}: {
  searchParams: { view?: string; date?: string };
}) {
  const profile = await requireProfile();
  const supabase = createClient();

  const view = searchParams.view === 'semana' ? 'semana' : 'mes';
  const anchor = searchParams.date ? new Date(searchParams.date) : new Date();
  const { start, end } = view === 'semana' ? getWeekRange(anchor) : getMonthGridRange(anchor);

  const [{ data: clients }, { data: pieces }] = await Promise.all([
    supabase.from('clients').select('id,name,brand_name,timezone,archived').eq('archived', false).order('name'),
    supabase
      .from('content_pieces')
      .select('*, clients(id,name,brand_name,timezone), assignee:profiles!content_pieces_assignee_id_fkey(id,full_name)')
      .gte('scheduled_at', start.toISOString())
      .lte('scheduled_at', end.toISOString())
      .order('scheduled_at'),
  ]);

  return (
    <AppShell profile={profile}>
      <CalendarBoard
        profile={profile}
        clients={(clients ?? []) as Client[]}
        pieces={(pieces ?? []) as ContentPiece[]}
        view={view}
        anchorDate={anchor.toISOString()}
      />
    </AppShell>
  );
}
