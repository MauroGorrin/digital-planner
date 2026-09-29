import crypto from 'crypto';

// Link compartible del reporte de métricas (/reportes/[clientId]/[anio]/[mes]) y el PDF que se
// descarga desde ahí. Sin tabla ni columna nueva: la URL se firma con HMAC-SHA256 -- mismo
// mecanismo que ya usa lib/webhooks/dispatch.ts para firmar los webhooks salientes -- sobre
// `clientId:anio:mes`, con una clave que solo conoce el servidor (REPORT_LINK_SECRET). El link de
// "el reporte de octubre de esta marca" es siempre el mismo y sirve para siempre: no vence, y
// nadie puede armarlo sin la clave del servidor. Revocar todos los links a la vez (no uno solo) es
// tan simple como cambiar esa variable de entorno.

/**
 * `true` si la variable de entorno está puesta y el link/PDF compartible pueden ofrecerse.
 *
 * Igual que `captchaEsObligatorio()` en lib/captcha.ts: la app no puede depender de una clave que
 * hoy nadie ha puesto -- sin ella, `/metricas` sigue funcionando igual, solo sin los botones de
 * compartir, en vez de tirar la pantalla entera con un error de servidor.
 */
export function compartirReportesHabilitado(): boolean {
  return !!process.env.REPORT_LINK_SECRET;
}

function secretoRequerido(): string {
  const secreto = process.env.REPORT_LINK_SECRET;
  if (!secreto) throw new Error('Falta configurar REPORT_LINK_SECRET.');
  return secreto;
}

/**
 * Firma HMAC-SHA256 (hex) de un reporte de métricas para una marca, año y mes dados.
 *
 * Lanza si `REPORT_LINK_SECRET` no está configurada. A propósito: esta función solo debe llamarse
 * después de comprobar `compartirReportesHabilitado()` (que es lo que hacen `urlDelReporte`,
 * `urlDelPdf` y `firmaEsValida`, indirectamente) -- si se llega aquí sin la variable puesta es un
 * error de quien llama, no un caso a degradar en silencio.
 */
export function firmaDeReporte(clientId: string, anio: number, mes: number): string {
  return crypto.createHmac('sha256', secretoRequerido()).update(`${clientId}:${anio}:${mes}`).digest('hex');
}

/**
 * `true` si `firma` es la firma correcta para esa marca/año/mes.
 *
 * Compara en tiempo constante (`timingSafeEqual`) en vez de con `===`: una comparación normal
 * termina en cuanto encuentra el primer byte distinto, así que el tiempo que tarda en rechazar una
 * firma filtra cuántos bytes iniciales acertó quien la mandó -- una firma no debe poder adivinarse
 * byte a byte midiendo la respuesta.
 *
 * Sin `REPORT_LINK_SECRET` configurada, devuelve `false` en vez de lanzar: la ruta pública y el
 * PDF llaman esto con parámetros que nunca controlaron ellos mismos, así que "la función no está
 * disponible" tiene que verse igual que "la firma no coincide" -- un 404, no un error 500.
 */
export function firmaEsValida(clientId: string, anio: number, mes: number, firma: string | null | undefined): boolean {
  if (!firma || !compartirReportesHabilitado()) return false;
  const esperada = Buffer.from(firmaDeReporte(clientId, anio, mes), 'hex');
  // Buffer.from(str, 'hex') nunca lanza: una cadena que no es hex válido simplemente produce un
  // buffer más corto (se detiene en el primer par inválido), y eso ya lo atrapa la comparación de
  // longitud de abajo antes de llegar a timingSafeEqual, que exige el mismo tamaño en los dos lados.
  const recibida = Buffer.from(firma, 'hex');
  if (esperada.length !== recibida.length) return false;
  return crypto.timingSafeEqual(esperada, recibida);
}

/** La URL pública y firmada del reporte -- para copiar y compartir por WhatsApp. */
export function urlDelReporte(baseUrl: string, clientId: string, anio: number, mes: number): string {
  return `${baseUrl}/reportes/${clientId}/${anio}/${mes}?firma=${firmaDeReporte(clientId, anio, mes)}`;
}

/** La URL del PDF del mismo reporte -- misma firma, la usan tanto /metricas como /reportes/... */
export function urlDelPdf(baseUrl: string, clientId: string, anio: number, mes: number): string {
  return `${baseUrl}/api/reportes/pdf?client=${clientId}&anio=${anio}&mes=${mes}&firma=${firmaDeReporte(clientId, anio, mes)}`;
}

export interface AccesoAReporte {
  clientId: string;
  anio: number;
  mes: number;
}

/**
 * Valida los parámetros crudos de la ruta pública (strings, tal como llegan de la URL) y la
 * firma. Con todo correcto, devuelve `anio`/`mes` ya convertidos a número -- listos para
 * `limitesDelMes` y el resto de lib/metricas.ts, que los esperan así.
 *
 * Con cualquier cosa mal (mes fuera de 1-12, año que no es número, firma ausente o incorrecta)
 * devuelve `null` sin decir cuál de las validaciones falló: quien llama responde 404 igual en
 * todos los casos, para no darle a quien esté probando una pista de por dónde seguir.
 */
export function verificarAccesoAReporte(
  clientIdParam: string,
  anioParam: string,
  mesParam: string,
  firmaParam: string | null | undefined
): AccesoAReporte | null {
  if (!clientIdParam) return null;
  const anio = Number(anioParam);
  const mes = Number(mesParam);
  if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) return null;
  if (!firmaEsValida(clientIdParam, anio, mes, firmaParam)) return null;
  return { clientId: clientIdParam, anio, mes };
}
