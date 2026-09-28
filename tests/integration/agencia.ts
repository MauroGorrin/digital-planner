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
 * CUÁNDO NO USAR ESTO: `aislamiento.test.ts` monta sus DOS agencias por su cuenta y no pasa por
 * aquí, a propósito. Probar que la agencia A no ve nada de la B exige dos agencias pobladas, y que
 * ninguna sea la del backfill es lo que le permite a esa suite afirmar conjuntos exactos ("este
 * contacto ve exactamente estas dos marcas") sin que se le cuelen las marcas que crean las demás
 * suites, que sí cuelgan todas de la del backfill. Cualquier suite nueva que no necesite una segunda
 * agencia debe seguir usando ésta: dos agencias sueltas por ahí no prueban nada y sí ensucian las
 * afirmaciones de `agencias.test.ts`.
 */
export async function agenciaDelBackfill(admin: SupabaseClient): Promise<string> {
  const { data, error } = await admin.from('agencies').select('id').eq('name', 'Agencia').single();
  if (error) throw error;
  return data.id as string;
}
