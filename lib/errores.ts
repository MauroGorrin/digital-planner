// Traducción de un error de Supabase a algo que sí puede ver el navegador (CN-014).

/**
 * Código de Postgres para un `raise exception` sin SQLSTATE propio.
 *
 * Es el que llega de las funciones `SECURITY DEFINER` de este proyecto: los mensajes en español que
 * levantan las RPC de transición ("Solo el cliente puede aprobar", "Una pieza no cambia de marca")
 * SON la UX de error del producto y no filtran nada -- se verificó que ninguno lleva un id, una tabla
 * ni una columna dentro. Esos tienen que seguir llegando tal cual.
 */
const CODIGO_RAISE_EXCEPTION = 'P0001';

/**
 * Lo que NO puede seguir llegando es el texto crudo de una violación de restricción en una escritura
 * directa a tabla: 23514 (check), 23505 (unique), 23503 (foreign key), 42501 (privilegio). Ahí el
 * `error.message` de PostgREST trae nombres de restricción y de esquema, como
 * `client_packages_monthly_quota_check`. Next redacta a un digest los mensajes de una Server Action
 * que revientan en un build de producción, lo que tapa la mayoría -- pero "la mayoría" no es una
 * garantía sobre la que construir, y en desarrollo no tapa nada.
 */
const MENSAJE_GENERICO = 'No pudimos completar la operación. Vuelve a intentarlo o avisa al equipo.';

interface ErrorDeSupabase {
  code?: string | null;
  message: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * Deja pasar el mensaje de un `raise exception` del propio proyecto y cambia cualquier otro por uno
 * genérico, dejando el detalle en el log del servidor.
 *
 * Se decide por `error.code` y no por el texto: el texto de una restricción es libre y una lista de
 * cadenas prohibidas se queda corta en cuanto alguien añade una restricción nueva. El código, en
 * cambio, lo pone Postgres.
 *
 * Vive en un solo sitio a propósito: son unas veinte escrituras directas a tabla repartidas en cuatro
 * archivos de acciones, y repetir el criterio en cada una es garantizar que un día no coincidan.
 */
export function errorParaElCliente(error: ErrorDeSupabase, contexto: string): Error {
  if (error.code === CODIGO_RAISE_EXCEPTION) return new Error(error.message);
  console.error(`[${contexto}]`, error);
  return new Error(MENSAJE_GENERICO);
}

export { MENSAJE_GENERICO, CODIGO_RAISE_EXCEPTION };
