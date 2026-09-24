import { notFound } from 'next/navigation';
import { requireAgency } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/AppShell';
import { ContentPieceForm } from '@/components/ContentPieceForm';
import type { Client, ContentPiece, Profile } from '@/types/database';

export default async function EditarPiezaPage({ params }: { params: { id: string } }) {
  const profile = await requireAgency();
  const supabase = createClient();
  const [{ data: piece }, { data: clients }, { data: team }] = await Promise.all([
    supabase.from('content_pieces').select('*').eq('id', params.id).single(),
    supabase.from('clients').select('*').eq('archived', false).order('name'),
    supabase.from('profiles').select('*').in('role', ['agency_admin', 'agency_member']).order('full_name'),
  ]);

  if (!piece) notFound();

  return (
    <AppShell profile={profile}>
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-4 text-xl font-semibold text-slate-900">Editar pieza</h1>
        <ContentPieceForm clients={(clients ?? []) as Client[]} team={(team ?? []) as Profile[]} piece={piece as ContentPiece} />
      </div>
    </AppShell>
  );
}
