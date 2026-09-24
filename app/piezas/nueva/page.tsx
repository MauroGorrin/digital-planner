import { requireAgency } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/AppShell';
import { ContentPieceForm } from '@/components/ContentPieceForm';
import type { Client, Profile } from '@/types/database';

export default async function NuevaPiezaPage({ searchParams }: { searchParams: { client?: string } }) {
  const profile = await requireAgency();
  const supabase = createClient();
  const [{ data: clients }, { data: team }] = await Promise.all([
    supabase.from('clients').select('*').eq('archived', false).order('name'),
    supabase.from('profiles').select('*').in('role', ['agency_admin', 'agency_member']).order('full_name'),
  ]);

  return (
    <AppShell profile={profile}>
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-4 text-xl font-semibold text-slate-900">Nueva pieza de contenido</h1>
        <ContentPieceForm
          clients={(clients ?? []) as Client[]}
          team={(team ?? []) as Profile[]}
          defaultClientId={searchParams.client}
        />
      </div>
    </AppShell>
  );
}
