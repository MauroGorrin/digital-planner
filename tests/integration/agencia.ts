import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * La agencia que crea el backfill de `0009_agencias.sql` al aplicarse.
 *
 * `npm run test:integration` hace `supabase db reset`, que aplica las migraciones sobre una base
 * vacía, así que después de cada reset existe exactamente una agencia y es ésta. Todo fixture de
 * integración cuelga de ella a propósito, por dos razones que no son de comodidad:
 *
 * - `clients.agency_id` es `not null`: una marca de prueba tiene que declarar su agencia.
 * - El check `profiles_agency_id_rol_check` exige que un perfil con rol de agencia traiga
 *   `agency_id`, y en el MISMO update que el rol — si lo partes en dos escrituras, la primera
 *   rebota con `23514`.
 *
 * Un fixture que se inventara su propia agencia haría fallar las pruebas de `agencias.test.ts`, que
 * comprueban que todo lo que hay en la base quedó en una sola agencia (criterio de aceptación 6 del
 * spec). Si alguna suite futura necesita de verdad una segunda agencia, créala ahí y no la pueble:
 * es lo que hace `agencias.test.ts` con su agencia señuelo.
 */
export async function agenciaDelBackfill(admin: SupabaseClient): Promise<string> {
  const { data, error } = await admin.from('agencies').select('id').eq('name', 'Agencia').single();
  if (error) throw error;
  return data.id as string;
}
