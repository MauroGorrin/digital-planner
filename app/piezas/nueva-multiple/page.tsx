import { requireAgency } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/AppShell';
import { ContentPiecesMultipleForm } from '@/components/ContentPiecesMultipleForm';
import type { Client } from '@/types/database';

export default async function NuevaPiezaMultiplePage() {
  const profile = await requireAgency();
  const supabase = await createClient();
  const { data: clients } = await supabase.from('clients').select('*').eq('archived', false).order('name');

  return (
    <AppShell profile={profile}>
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-4 text-xl font-semibold text-slate-900">Varias piezas de una tanda</h1>
        <ContentPiecesMultipleForm clients={(clients ?? []) as Client[]} />
      </div>
    </AppShell>
  );
}
