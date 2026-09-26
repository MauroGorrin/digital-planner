import { requireAgency } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/AppShell';
import { ContentPieceForm } from '@/components/ContentPieceForm';
import { ideaSirveComoOrigenDePieza } from '@/lib/ideas';
import type { Client, Idea, Profile } from '@/types/database';

export default async function NuevaPiezaPage({
  searchParams,
}: {
  searchParams: { client?: string; idea?: string };
}) {
  const profile = await requireAgency();
  const supabase = createClient();
  const [{ data: clients }, { data: team }, { data: idea }] = await Promise.all([
    supabase.from('clients').select('*').eq('archived', false).order('name'),
    supabase.from('profiles').select('*').in('role', ['agency_admin', 'agency_member']).order('full_name'),
    searchParams.idea
      ? supabase.from('ideas').select('*').eq('id', searchParams.idea).single()
      : Promise.resolve({ data: null }),
  ]);

  // Un enlace viejo (idea ya convertida, o todavia en propuesta) no debe ofrecer un formulario
  // prellenado que convert_idea_to_piece va a rechazar: degrada a un formulario en blanco.
  const ideaCargada = idea as Idea | null;
  const ideaOrigen = ideaCargada && ideaSirveComoOrigenDePieza(ideaCargada) ? ideaCargada : null;

  return (
    <AppShell profile={profile}>
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-4 text-xl font-semibold text-slate-900">Nueva pieza de contenido</h1>
        <ContentPieceForm
          clients={(clients ?? []) as Client[]}
          team={(team ?? []) as Profile[]}
          defaultClientId={ideaOrigen?.client_id ?? searchParams.client}
          ideaOrigen={
            ideaOrigen
              ? {
                  id: ideaOrigen.id,
                  client_id: ideaOrigen.client_id,
                  title: ideaOrigen.title,
                  description: ideaOrigen.description,
                  suggested_platform: ideaOrigen.suggested_platform,
                  suggested_format: ideaOrigen.suggested_format,
                }
              : undefined
          }
        />
      </div>
    </AppShell>
  );
}
