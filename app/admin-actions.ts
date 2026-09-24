'use server';

import { revalidatePath } from 'next/cache';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireAgency, requireAgencyAdmin } from '@/lib/auth';
import type { UserRole } from '@/types/database';

export async function createClientEntity(input: { name: string; brand_name: string; timezone: string; notes?: string }) {
  const profile = await requireAgency();
  const supabase = createClient();
  const { data, error } = await supabase
    .from('clients')
    .insert({ ...input, created_by: profile.id })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  revalidatePath('/clientes');
  return data.id as string;
}

export async function updateClientEntity(
  id: string,
  input: Partial<{ name: string; brand_name: string; timezone: string; notes: string; archived: boolean }>
) {
  await requireAgency();
  const supabase = createClient();
  const { error } = await supabase.from('clients').update(input).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/clientes');
  revalidatePath(`/clientes/${id}`);
}

/**
 * Invita a una persona por correo (equipo de agencia o contacto de cliente).
 * Usa el service role para crear el usuario en Supabase Auth; requiere SMTP configurado
 * en el proyecto Supabase para que el correo de invitación se envíe.
 */
export async function inviteUser(input: { email: string; full_name: string; role: UserRole; client_id?: string }) {
  await requireAgencyAdmin();
  const admin = createServiceClient();

  const { data: existing } = await admin.from('profiles').select('id').eq('email', input.email).maybeSingle();

  let userId = existing?.id as string | undefined;

  if (!userId) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email, {
      data: { full_name: input.full_name, role: input.role },
    });
    if (error) throw new Error(error.message);
    userId = data.user?.id;
  }
  if (!userId) throw new Error('No se pudo crear el usuario.');

  if (input.client_id) {
    const table = input.role === 'client' ? 'client_contacts' : 'client_assignments';
    await admin.from(table).upsert({ client_id: input.client_id, profile_id: userId }, { onConflict: 'client_id,profile_id' });
  }

  revalidatePath(`/clientes/${input.client_id ?? ''}`);
  return userId;
}

export async function removeClientContact(clientId: string, profileId: string) {
  await requireAgency();
  const supabase = createClient();
  const { error } = await supabase.from('client_contacts').delete().eq('client_id', clientId).eq('profile_id', profileId);
  if (error) throw new Error(error.message);
  revalidatePath(`/clientes/${clientId}`);
}

export async function removeTeamAssignment(clientId: string, profileId: string) {
  await requireAgency();
  const supabase = createClient();
  const { error } = await supabase.from('client_assignments').delete().eq('client_id', clientId).eq('profile_id', profileId);
  if (error) throw new Error(error.message);
  revalidatePath(`/clientes/${clientId}`);
}

export async function assignTeamMember(clientId: string, profileId: string) {
  await requireAgency();
  const supabase = createClient();
  const { error } = await supabase.from('client_assignments').upsert({ client_id: clientId, profile_id: profileId }, { onConflict: 'client_id,profile_id' });
  if (error) throw new Error(error.message);
  revalidatePath(`/clientes/${clientId}`);
}

export async function updateNotificationSettings(
  clientId: string,
  input: { email_on_pending_review: boolean; email_on_client_response: boolean; reminder_after_days: number }
) {
  await requireAgency();
  const supabase = createClient();
  const { error } = await supabase
    .from('notification_settings')
    .upsert({ client_id: clientId, ...input, updated_at: new Date().toISOString() }, { onConflict: 'client_id' });
  if (error) throw new Error(error.message);
  revalidatePath(`/clientes/${clientId}`);
}

export async function setClientCalendarMapping(clientId: string, connectionId: string) {
  await requireAgencyAdmin();
  const supabase = createClient();
  const { error } = await supabase
    .from('client_calendar_mappings')
    .upsert({ client_id: clientId, connection_id: connectionId }, { onConflict: 'client_id' });
  if (error) throw new Error(error.message);
  revalidatePath(`/clientes/${clientId}`);
}

export async function removeClientCalendarMapping(clientId: string) {
  await requireAgencyAdmin();
  const supabase = createClient();
  const { error } = await supabase.from('client_calendar_mappings').delete().eq('client_id', clientId);
  if (error) throw new Error(error.message);
  revalidatePath(`/clientes/${clientId}`);
}

export async function saveWebhookConfig(input: { name: string; url: string; secret: string; events: string[] }) {
  await requireAgencyAdmin();
  const supabase = createClient();
  const { error } = await supabase.from('webhook_configs').insert(input);
  if (error) throw new Error(error.message);
  revalidatePath('/ajustes');
}

export async function toggleWebhookConfig(id: string, active: boolean) {
  await requireAgencyAdmin();
  const supabase = createClient();
  const { error } = await supabase.from('webhook_configs').update({ active }).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/ajustes');
}

export async function deleteWebhookConfig(id: string) {
  await requireAgencyAdmin();
  const supabase = createClient();
  const { error } = await supabase.from('webhook_configs').delete().eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/ajustes');
}
