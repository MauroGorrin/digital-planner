'use server';

import { revalidatePath } from 'next/cache';
import { requireAgency } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { ContentFormat } from '@/types/database';

/**
 * Define (o actualiza) la cuota mensual de un formato para una marca. El cliente nunca llega
 * aquí: la RLS de `client_packages` ya rechaza su escritura, pero `requireAgency()` evita
 * ofrecerle el botón en primer lugar.
 */
export async function definirCuotaDeFormato(clientId: string, format: ContentFormat, monthlyQuota: number) {
  await requireAgency();
  const supabase = createClient();
  const { error } = await supabase
    .from('client_packages')
    .upsert({ client_id: clientId, format, monthly_quota: monthlyQuota }, { onConflict: 'client_id,format' });
  if (error) throw new Error(error.message);
  revalidatePath('/metricas');
}

/**
 * Quita un formato del paquete. No es una cuota en cero -- el check de la tabla la rechaza
 * a propósito, porque cero y "no contratado" son cosas distintas (ver 0006_client_packages.sql).
 * Quitar el formato es borrar la fila.
 */
export async function quitarFormatoDelPaquete(clientId: string, format: ContentFormat) {
  await requireAgency();
  const supabase = createClient();
  const { error } = await supabase.from('client_packages').delete().eq('client_id', clientId).eq('format', format);
  if (error) throw new Error(error.message);
  revalidatePath('/metricas');
}
