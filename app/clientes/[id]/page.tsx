import { notFound } from 'next/navigation';
import { requireAgency } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/AppShell';
import { ClientDetail } from '@/components/ClientDetail';
import type { Client, Profile } from '@/types/database';

export default async function ClienteDetailPage({ params }: { params: { id: string } }) {
  const profile = await requireAgency();
  const supabase = createClient();

  const [
    { data: client },
    { data: assignments },
    { data: contacts },
    { data: team },
    { data: notificationSettings },
    { data: calendarMapping },
    { data: connections },
  ] = await Promise.all([
    supabase.from('clients').select('*').eq('id', params.id).single(),
    supabase.from('client_assignments').select('profile_id, profiles(id,full_name,email)').eq('client_id', params.id),
    supabase.from('client_contacts').select('profile_id, profiles(id,full_name,email)').eq('client_id', params.id),
    supabase.from('profiles').select('*').in('role', ['agency_admin', 'agency_member']).order('full_name'),
    supabase.from('notification_settings').select('*').eq('client_id', params.id).maybeSingle(),
    supabase.from('client_calendar_mappings').select('connection_id').eq('client_id', params.id).maybeSingle(),
    profile.role === 'agency_admin' ? supabase.from('google_calendar_connections').select('id,label,calendar_id') : Promise.resolve({ data: [] }),
  ]);

  if (!client) notFound();

  return (
    <AppShell profile={profile}>
      <ClientDetail
        profile={profile}
        client={client as Client}
        assignments={(assignments ?? []) as any[]}
        contacts={(contacts ?? []) as any[]}
        team={(team ?? []) as Profile[]}
        notificationSettings={notificationSettings as any}
        calendarMapping={calendarMapping as any}
        connections={(connections ?? []) as any[]}
      />
    </AppShell>
  );
}
