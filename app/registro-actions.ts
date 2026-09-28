'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireProfile } from '@/lib/auth';
import { errorParaElCliente } from '@/lib/errores';
import { captchaEsObligatorio } from '@/lib/captcha';
import {
  componerNombreCompleto,
  registroEsValido,
  validarNombreDeAgencia,
  validarRegistro,
  type DatosDeRegistro,
  type ErroresDeRegistro,
} from '@/lib/validacion-registro';

export interface ResultadoDeRegistro {
  ok: boolean;
  /** Un mensaje por campo mal formado. Sólo viene cuando `ok` es false. */
  errores?: ErroresDeRegistro;
  /** Un mensaje que no pertenece a ningún campo (captcha, límite de envíos, fallo del proveedor). */
  mensaje?: string;
  /**
   * `true` cuando el alta quedó a la espera del correo de confirmación, que es como está el
   * proyecto de producción. En la Supabase local de las pruebas la confirmación está apagada y el
   * alta devuelve sesión, así que este booleano es lo que distingue los dos casos sin adivinar.
   */
  necesitaConfirmacion?: boolean;
}

const MENSAJE_DE_ALTA_FALLIDA =
  'No pudimos crear tu cuenta. Revisa los datos e inténtalo de nuevo en un momento.';

/**
 * Alta pública: crea la cuenta de auth y deja el resto en manos del correo de confirmación.
 *
 * **Esto NO crea la agencia.** Aquí sólo nace un usuario, y nace como `role = 'client'` sin agencia,
 * porque eso es lo que hace `handle_new_user()` desde `0007_endurecimiento_privilegios.sql` y no se
 * toca. La agencia y el rol de administrador los pone `crear_mi_agencia()`
 * (supabase/migrations/0011_alta_de_agencia.sql) cuando la persona entra por primera vez con el
 * correo ya confirmado — ver `completarAltaDeAgencia` abajo y app/bienvenida/page.tsx.
 *
 * Partirlo en dos no es un rodeo: si esta acción pudiera dar el rol, volvería a existir un camino
 * público que reparte permisos, que es exactamente la vulnerabilidad que cerró `0007`.
 *
 * SOBRE `options.data`: ese objeto acaba verbatim en `raw_user_meta_data`. Ahí van el nombre
 * completo, el teléfono y el nombre de la agencia — tres datos de presentación que **no deciden
 * ningún permiso**. El rol no va, y no es un olvido: era justamente el rol lo que convertía esa
 * metadata en un agujero.
 */
export async function registrarAgencia(
  entrada: DatosDeRegistro & { captchaToken?: string | null }
): Promise<ResultadoDeRegistro> {
  // Lista explícita en vez de usar `entrada` tal cual: una Server Action es un endpoint HTTP y el
  // tipo del parámetro se borra al compilar, así que quien llame manda las claves que quiera.
  // Mismo criterio que `updateClientEntity` y `saveWebhookConfig` en app/admin-actions.ts.
  const datos: DatosDeRegistro = {
    nombre: String(entrada?.nombre ?? ''),
    apellido: String(entrada?.apellido ?? ''),
    telefono: String(entrada?.telefono ?? ''),
    correo: String(entrada?.correo ?? ''),
    clave: String(entrada?.clave ?? ''),
    nombreDeAgencia: String(entrada?.nombreDeAgencia ?? ''),
  };

  // La MISMA validación que ya corrió el navegador, con las mismas funciones. No es una copia de
  // seguridad de aquélla: es el control. Al navegador se le puede saltar entero -- esta acción es
  // una URL a la que se puede hacer POST sin abrir ninguna página.
  const errores = validarRegistro(datos);
  if (!registroEsValido(errores)) return { ok: false, errores };

  const captchaToken = entrada?.captchaToken ? String(entrada.captchaToken) : '';
  if (captchaEsObligatorio() && !captchaToken) {
    return { ok: false, mensaje: 'Resuelve el captcha antes de continuar.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: datos.correo.trim(),
    password: datos.clave,
    options: {
      // Sin captcha configurado va `undefined` y Supabase no lo exige. Ver lib/captcha.ts.
      captchaToken: captchaToken || undefined,
      data: {
        full_name: componerNombreCompleto(datos.nombre, datos.apellido),
        phone: datos.telefono.trim(),
        agency_name: datos.nombreDeAgencia.trim(),
      },
    },
  });

  if (error) {
    // El mensaje del proveedor no se reenvía al navegador. Además de poder traer detalle interno,
    // distinguir "ese correo ya existe" de cualquier otro fallo convierte el alta en un oráculo
    // para averiguar qué direcciones tienen cuenta. Con la confirmación de correo encendida,
    // Supabase ya devuelve éxito para un correo repetido justamente por eso; el mensaje genérico de
    // aquí es la otra mitad.
    console.error('[registrarAgencia]', error);
    return { ok: false, mensaje: MENSAJE_DE_ALTA_FALLIDA };
  }

  return { ok: true, necesitaConfirmacion: !data.session };
}

/**
 * Segunda mitad del alta: promueve a quien acaba de confirmar su correo a administrador de una
 * agencia nueva.
 *
 * Las comprobaciones de aquí son una COMODIDAD: sirven para dar un mensaje claro sin pagar un viaje
 * a la base. El control está en `crear_mi_agencia()`, que vuelve a comprobar las tres precondiciones
 * dentro de Postgres — incluida la única que distingue a un recién registrado de un contacto de
 * cliente invitado, que es no tener fila en `client_contacts`. Si borras lo de abajo, el alta sigue
 * siendo segura; si borras lo de la función, no.
 *
 * Es llamable más de una vez a propósito (la persona puede recargar /bienvenida): la segunda llamada
 * rebota con "Tu cuenta ya pertenece a una agencia" en vez de crear una segunda agencia vacía.
 */
export async function completarAltaDeAgencia(nombreDeAgencia?: string): Promise<{ agencyId: string }> {
  const profile = await requireProfile();

  if (profile.role !== 'client' || profile.agency_id) {
    throw new Error('Tu cuenta ya pertenece a una agencia.');
  }

  const nombre = String(nombreDeAgencia ?? '').trim();
  if (nombre) {
    const error = validarNombreDeAgencia(nombre);
    if (error) throw new Error(error);
  }

  const supabase = await createClient();
  // `null` cuando no se escribió nada: la función usa entonces el nombre que viajó en la metadata
  // del alta. El parámetro es el camino de rescate para un alta a medio terminar.
  const { data, error } = await supabase.rpc('crear_mi_agencia', {
    p_nombre_agencia: nombre || null,
  });
  if (error) throw errorParaElCliente(error, 'completarAltaDeAgencia');

  // El rol acaba de cambiar, así que todo lo cacheado se decidió con el perfil viejo.
  revalidatePath('/', 'layout');
  return { agencyId: data as string };
}
