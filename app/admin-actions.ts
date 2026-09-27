'use server';

import { revalidatePath } from 'next/cache';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireAgency, requireAgencyAdmin } from '@/lib/auth';
import type { ClientBillingMode, ContentFormat, UserRole } from '@/types/database';
import { errorParaElCliente } from '@/lib/errores';
import { urlDeWebhookValidada } from '@/lib/webhooks/url-valida';

export async function createClientEntity(input: {
  name: string;
  brand_name: string;
  timezone: string;
  notes?: string;
  billing_mode: ClientBillingMode;
  quotas?: Partial<Record<ContentFormat, number>>;
}) {
  const profile = await requireAgency();
  const supabase = await createClient();
  const { name, brand_name, timezone, notes, billing_mode, quotas } = input;

  const { data, error } = await supabase
    .from('clients')
    .insert({ name, brand_name, timezone, notes, billing_mode, created_by: profile.id })
    .select('id')
    .single();
  if (error) throw errorParaElCliente(error, 'createClientEntity');
  const clientId = data.id as string;

  // Las cuotas se guardan en una escritura aparte a proposito: `clients` y `client_packages` son
  // dos tablas y Supabase-js no ofrece una transaccion entre ambas desde el cliente. Si esta
  // segunda escritura falla, la marca ya existe -- no tiene sentido tragarse el error, pero
  // tampoco deshacer la creacion ni bloquear la navegacion a una marca que sí se creó: se devuelve
  // como advertencia y la agencia puede definir el paquete despues desde la ficha del cliente
  // (EditorDePaquete llama al mismo upsert).
  let quotaWarning: string | undefined;
  if (billing_mode === 'paquete' && quotas) {
    const filas = Object.entries(quotas)
      .filter(([, cantidad]) => typeof cantidad === 'number' && Number.isInteger(cantidad) && cantidad > 0)
      .map(([format, monthly_quota]) => ({ client_id: clientId, format: format as ContentFormat, monthly_quota }));

    if (filas.length > 0) {
      const { error: errorPaquete } = await supabase.from('client_packages').insert(filas);
      if (errorPaquete) {
        quotaWarning = `El cliente se creó, pero no se pudieron guardar sus cuotas: ${errorParaElCliente(errorPaquete, 'createClientEntity:quotas').message} Puedes definirlas desde la ficha del cliente.`;
      }
    }
  }

  revalidatePath('/clientes');
  return { id: clientId, quotaWarning };
}

export async function updateClientEntity(
  id: string,
  input: Partial<{
    name: string;
    brand_name: string;
    timezone: string;
    notes: string;
    archived: boolean;
    billing_mode: ClientBillingMode;
  }>
) {
  await requireAgency();
  const supabase = await createClient();
  const { error } = await supabase.from('clients').update(input).eq('id', id);
  if (error) throw errorParaElCliente(error, 'updateClientEntity');
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
      // El rol ya NO viaja aquí. Esta metadata acaba en `raw_user_meta_data`, que también rellena
      // verbatim el endpoint público de signup, así que `handle_new_user()` dejó de leerla y crea
      // todo perfil como 'client' (ver 0007_endurecimiento_privilegios.sql). Este cambio y el de esa
      // migración son dos mitades de lo mismo: si mandas el rol otra vez aquí nadie lo lee, y si
      // quitas el update de abajo cada miembro de agencia invitado queda convertido en cliente.
      data: { full_name: input.full_name },
    });
    if (error) throw errorParaElCliente(error, 'inviteUser');
    userId = data.user?.id;
    if (!userId) throw new Error('No se pudo crear el usuario.');

    // El rol se fija desde este camino, que ya pasó por requireAgencyAdmin(), y con el cliente de
    // servicio, el único rol que conserva el privilegio sobre `profiles.role`.
    //
    // Se comprueba el error a propósito: un fallo silencioso aquí dejaría al invitado con el
    // 'client' del default de la columna, y un miembro de agencia se encontraría sin permisos sin
    // que nada lo reportara -- exactamente el tipo de fallo mudo que costó caro en CN-015.
    const { error: rolError } = await admin.from('profiles').update({ role: input.role }).eq('id', userId);
    if (rolError) throw errorParaElCliente(rolError, 'inviteUser');
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
  const supabase = await createClient();
  const { error } = await supabase.from('client_contacts').delete().eq('client_id', clientId).eq('profile_id', profileId);
  if (error) throw errorParaElCliente(error, 'removeClientContact');
  revalidatePath(`/clientes/${clientId}`);
}

export async function removeTeamAssignment(clientId: string, profileId: string) {
  await requireAgency();
  const supabase = await createClient();
  const { error } = await supabase.from('client_assignments').delete().eq('client_id', clientId).eq('profile_id', profileId);
  if (error) throw errorParaElCliente(error, 'removeTeamAssignment');
  revalidatePath(`/clientes/${clientId}`);
}

export async function assignTeamMember(clientId: string, profileId: string) {
  await requireAgency();
  const supabase = await createClient();
  const { error } = await supabase.from('client_assignments').upsert({ client_id: clientId, profile_id: profileId }, { onConflict: 'client_id,profile_id' });
  if (error) throw errorParaElCliente(error, 'assignTeamMember');
  revalidatePath(`/clientes/${clientId}`);
}

export async function updateNotificationSettings(
  clientId: string,
  input: { email_on_pending_review: boolean; email_on_client_response: boolean; reminder_after_days: number }
) {
  await requireAgency();
  const supabase = await createClient();
  const { error } = await supabase
    .from('notification_settings')
    .upsert({ client_id: clientId, ...input, updated_at: new Date().toISOString() }, { onConflict: 'client_id' });
  if (error) throw errorParaElCliente(error, 'updateNotificationSettings');
  revalidatePath(`/clientes/${clientId}`);
}

export async function setClientCalendarMapping(clientId: string, connectionId: string) {
  await requireAgencyAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from('client_calendar_mappings')
    .upsert({ client_id: clientId, connection_id: connectionId }, { onConflict: 'client_id' });
  if (error) throw errorParaElCliente(error, 'setClientCalendarMapping');
  revalidatePath(`/clientes/${clientId}`);
}

export async function removeClientCalendarMapping(clientId: string) {
  await requireAgencyAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from('client_calendar_mappings').delete().eq('client_id', clientId);
  if (error) throw errorParaElCliente(error, 'removeClientCalendarMapping');
  revalidatePath(`/clientes/${clientId}`);
}

export async function saveWebhookConfig(input: { name: string; url: string; secret: string; events: string[] }) {
  await requireAgencyAdmin();
  const supabase = await createClient();

  // Lista explicita en vez de esparcir `input`. Una Server Action es un endpoint HTTP y el tipo del
  // parametro se borra al compilar, asi que quien llame manda las claves que quiera: `active`, `id`,
  // `created_at`, lo que exista en la tabla (CN-009, CWE-915).
  const { name, url, secret, events } = input;

  // El destino se valida al guardar y no al enviar: en el envio ya es tarde para avisarle a nadie, y
  // `dispatchWebhookEvent` corre con el cliente de servicio detras de una transicion de estado.
  const destino = urlDeWebhookValidada(url);

  const { error } = await supabase.from('webhook_configs').insert({ name, url: destino, secret, events });
  if (error) throw errorParaElCliente(error, 'saveWebhookConfig');
  revalidatePath('/ajustes');
}

export async function toggleWebhookConfig(id: string, active: boolean) {
  await requireAgencyAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from('webhook_configs').update({ active }).eq('id', id);
  if (error) throw errorParaElCliente(error, 'toggleWebhookConfig');
  revalidatePath('/ajustes');
}

export async function deleteWebhookConfig(id: string) {
  await requireAgencyAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from('webhook_configs').delete().eq('id', id);
  if (error) throw errorParaElCliente(error, 'deleteWebhookConfig');
  revalidatePath('/ajustes');
}
