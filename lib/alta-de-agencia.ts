import { createClient } from '@/lib/supabase/server';
import type { Profile } from '@/types/database';

/**
 * ¿A esta persona le falta terminar su alta?
 *
 * Es la MISMA pregunta que responde `crear_mi_agencia()` dentro de Postgres, hecha desde el
 * servidor para decidir a qué pantalla mandarla. No es el control — el control es la función, que
 * la vuelve a responder contra los datos reales antes de crear nada. Aquí sólo se usa para elegir
 * un destino, y elegir mal no da ningún permiso: manda a /bienvenida a alguien que después verá
 * rebotar la promoción con un mensaje claro.
 *
 * LAS TRES CONDICIONES SON LAS TRES DE LA FUNCIÓN, y la tercera es la que no se ve: un contacto de
 * cliente invitado tiene exactamente el mismo perfil que un recién registrado (`role = 'client'` y
 * `agency_id` nulo). Lo único que los distingue es la fila en `client_contacts`. Sin esa consulta,
 * cada contacto de cliente entraría a la app por una pantalla que le ofrece crear una agencia.
 *
 * La consulta la hace el cliente SUJETO A RLS, y eso alcanza: la política `client_contacts_select`
 * de `0010_aislamiento_por_agencia.sql` deja a cualquiera ver sus propias filas
 * (`profile_id = auth.uid()`).
 */
export async function altaDeAgenciaPendiente(profile: Profile): Promise<boolean> {
  if (profile.role !== 'client') return false;
  if (profile.agency_id) return false;

  const supabase = await createClient();
  const { count, error } = await supabase
    .from('client_contacts')
    .select('client_id', { count: 'exact', head: true })
    .eq('profile_id', profile.id);

  // Ante un fallo de la consulta se responde "no hay alta pendiente". Es la respuesta conservadora:
  // la otra llevaría a un contacto de cliente a una pantalla que no es suya cada vez que la red
  // tosiera, y no ver /bienvenida nunca impide nada que no se pueda reintentar entrando de nuevo.
  if (error) {
    console.error('[altaDeAgenciaPendiente]', error);
    return false;
  }
  return (count ?? 0) === 0;
}

/**
 * El nombre de agencia que la persona escribió al registrarse, si todavía está en su metadata.
 *
 * Sólo sirve para prellenar el campo de /bienvenida. No decide nada: `crear_mi_agencia()` lee esa
 * misma metadata por su cuenta y un nombre no otorga ningún permiso (el porqué largo está en el
 * comentario de la función, en supabase/migrations/0011_alta_de_agencia.sql).
 */
export async function nombreDeAgenciaSugerido(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const sugerido = user?.user_metadata?.agency_name;
  return typeof sugerido === 'string' ? sugerido.trim() : '';
}
