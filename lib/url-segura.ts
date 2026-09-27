// Validación de URLs que llegan de fuera. No hay dependencias de servidor aquí a propósito: los dos
// lados de cada defecto -- donde se guarda el valor y donde se pinta -- tienen que poder importarlo,
// y "donde se pinta" es un componente de cliente.

const MENSAJE_ENLACE_INVALIDO = 'El enlace de referencia debe empezar con http:// o https://';

/**
 * Devuelve la URL normalizada si es http(s), y `null` si no lo es (CN-008).
 *
 * `reference_link` es texto libre y se pinta dentro de un `href`. React escapa el TEXTO, pero no
 * mira el esquema: un `javascript:alert(1)` en un href se renderiza tal cual y ejecuta al hacer clic.
 * El `type="url"` del formulario es solo del navegador y de todos modos acepta `javascript:`.
 *
 * Lo que hace que valga la pena y no sea una nota al pie: lo guarda un usuario de la agencia y se
 * ejecuta EN EL ORIGEN DE LA APP cuando lo abre un contacto del cliente, así que cruza la frontera
 * entre inquilinos. Desde ahí lee la página, se lleva las URLs firmadas de los adjuntos e invoca
 * Server Actions como la víctima.
 *
 * Se usa `new URL` en vez de una expresión regular porque el parser de la WHATWG ya quita espacios,
 * tabulaciones y saltos de línea y baja el esquema a minúsculas -- es decir, `\tJavaScript:…` no se
 * cuela por debajo de un `^https?://`.
 */
export function urlSegura(valor: string | null | undefined): string | null {
  if (!valor) return null;
  try {
    const u = new URL(valor);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Igual que `urlSegura`, pero lanza en vez de devolver `null` cuando el valor vino y no sirve.
 *
 * Se usa donde se GUARDA el enlace. Anular en silencio un enlace que la persona escribió sería
 * peor: creería que lo guardó. Un valor vacío sí es `null` legítimo -- el campo es opcional.
 */
export function enlaceDeReferenciaValidado(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const limpio = urlSegura(valor);
  if (!limpio) throw new Error(MENSAJE_ENLACE_INVALIDO);
  return limpio;
}

/**
 * Filtra el parámetro `redirect` del login: solo una ruta relativa de este mismo sitio (CN-011).
 *
 * El middleware solo escribe ahí una ruta relativa, pero el parámetro lo controla quien arma el
 * enlace. `//evil.example.com` es una URL protocol-relative: empieza con `/`, así que un
 * `startsWith('/')` a secas la deja pasar, y el navegador la resuelve como otro sitio. Se rechaza
 * aparte por eso.
 *
 * Importa el momento: el salto ocurre justo después de un login correcto, cuando la persona acaba
 * de comprobar que la app funciona y confía en lo que le muestre a continuación.
 */
export function destinoSeguro(valor: string | null | undefined): string {
  if (!valor) return '/';
  if (!valor.startsWith('/')) return '/';
  if (valor.startsWith('//')) return '/';
  // `/\evil.example.com` la normalizan algunos navegadores a `//evil.example.com`.
  if (valor.startsWith('/\\')) return '/';
  return valor;
}
