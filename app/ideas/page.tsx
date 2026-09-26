import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/AppShell';
import { IdeasBoard } from '@/components/IdeasBoard';
import type { Client, Idea } from '@/types/database';

export default async function IdeasPage() {
  const profile = await requireProfile();
  const supabase = createClient();

  const [{ data: ideas }, { data: clients }, { data: contactos }] = await Promise.all([
    supabase
      .from('ideas')
      .select('*, clients(id,name,brand_name), author:profiles!ideas_created_by_fkey(id,full_name)')
      .order('created_at', { ascending: false }),
    supabase.from('clients').select('id,name,brand_name,timezone,archived').eq('archived', false).order('name'),
    supabase.from('client_contacts').select('client_id').eq('profile_id', profile.id),
  ]);

  // De que marcas es contacto este usuario. Decide que botones ve, pero no que datos recibe: eso
  // ya lo filtro la politica de lectura.
  const marcasDondeEsContacto = new Set((contactos ?? []).map((c) => c.client_id));

  return (
    <AppShell profile={profile}>
      <IdeasBoard
        profile={profile}
        ideas={(ideas ?? []) as Idea[]}
        clients={(clients ?? []) as Client[]}
        marcasDondeEsContacto={[...marcasDondeEsContacto]}
      />
    </AppShell>
  );
}
