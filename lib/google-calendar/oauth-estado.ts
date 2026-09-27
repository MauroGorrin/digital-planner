import crypto from 'node:crypto';

// Cookies del flujo OAuth de Google Calendar, en un módulo aparte para que `connect` y `callback`
// nombren exactamente lo mismo. Si el nombre viviera duplicado como literal en los dos handlers, un
// cambio en uno solo dejaría el flujo rechazando todo con `estado_invalido` sin decir por qué.

/** Nonce de un solo uso que viaja en el parámetro `state` y se compara al volver (CN-005). */
export const COOKIE_ESTADO = 'gcal_state';

/** Etiqueta que escribe la persona. Va aparte del nonce: es texto libre y no autentica nada. */
export const COOKIE_ETIQUETA = 'gcal_label';

export const ETIQUETA_POR_DEFECTO = 'Calendario de la agencia';

/**
 * Diez minutos: alcanzan de sobra para dar el consentimiento en Google y no dejan un nonce
 * reutilizable dando vueltas más de lo necesario.
 */
export const VIDA_COOKIE_SEGUNDOS = 600;

export const OPCIONES_COOKIE = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  maxAge: VIDA_COOKIE_SEGUNDOS,
  path: '/',
};

/**
 * Compara el nonce guardado con el que vuelve de Google, en tiempo constante.
 *
 * `timingSafeEqual` lanza si los buffers miden distinto, así que la longitud se comprueba antes: sin
 * esa guarda, un `state` de largo distinto no daría "no coincide" sino una excepción no atrapada en
 * medio del callback. Esa comparación de longitud sí filtra el largo del nonce, pero el largo es
 * fijo y público (64 caracteres hex) -- no es el secreto.
 */
export function estadoCoincide(esperado: string | undefined | null, recibido: string): boolean {
  if (!esperado || !recibido) return false;
  const a = Buffer.from(esperado, 'utf8');
  const b = Buffer.from(recibido, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
