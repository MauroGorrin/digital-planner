import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import type { Profile } from '@/types/database';

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  return profile as Profile | null;
}

export async function requireProfile(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  return profile;
}

export async function requireAgency(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role === 'client') redirect('/');
  return profile;
}

export async function requireAgencyAdmin(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== 'agency_admin') redirect('/');
  return profile;
}
