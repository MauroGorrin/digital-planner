import { redirect } from 'next/navigation';
import { requireProfile } from '@/lib/auth';
import { altaDeAgenciaPendiente } from '@/lib/alta-de-agencia';

/**
 * La raíz reparte, y esto ya no es un redirect fijo al calendario.
 *
 * `/` es donde cae quien abre el enlace de confirmación del correo: Supabase lo devuelve al
 * `site_url` del proyecto. Si esta ruta mandara siempre al calendario, quien acaba de confirmar
 * entraría a un calendario vacío que además no puede llenar — todavía no tiene agencia ni marcas —
 * y su alta se quedaría a medias sin que nada se lo dijera.
 *
 * Por eso la decisión se toma con el perfil en la mano, y por eso vive aquí y no sólo en el enlace
 * del correo: alguien que cierre la pestaña y vuelva mañana por su cuenta llega igual a
 * /bienvenida.
 */
export default async function Home() {
  const profile = await requireProfile();
  if (await altaDeAgenciaPendiente(profile)) redirect('/bienvenida');
  redirect('/calendario');
}
