// Validación del destino de un webhook (CN-009).
//
// `saveWebhookConfig` guardaba `input.url` sin mirarla y `dispatchWebhookEvent` le hacía POST sin
// lista de esquemas, sin lista de hosts y sin filtro de IPs privadas. Un admin de agencia -- o
// cualquiera que hubiera escalado por CN-001/CN-002 -- podía apuntar un webhook a
// http://169.254.169.254/latest/meta-data/… o a un servicio interno del host de despliegue, y cada
// transición de estado disparaba la petición.
//
// Es ciega: en `webhook_deliveries` solo se guarda `res.status`, así que no sirve para leer
// respuestas. Pero un POST a un endpoint interno sin autenticación CAMBIA ESTADO, y el código de
// estado es un oráculo perfectamente usable para escanear hosts y puertos internos.
//
// Límite honesto de esta validación: comprueba el host TAL COMO ESTÁ ESCRITO, no la IP a la que
// resuelve. No protege de DNS rebinding ni de un nombre público que apunte a 127.0.0.1. Para eso
// haría falta resolver el nombre y volver a comprobar la IP en el momento del envío, dentro de
// `dispatch.ts`. Se deja anotado a propósito en vez de dar por cerrado algo que no lo está.

const MENSAJE_HTTPS = 'El webhook debe usar https.';
const MENSAJE_INTERNO = 'No se permiten direcciones internas.';
const MENSAJE_CREDENCIALES = 'La URL del webhook no debe llevar usuario ni contraseña.';
const MENSAJE_INVALIDA = 'La URL del webhook no es válida.';

/** Nombres que nunca salen de la máquina o del entorno de despliegue. */
const HOSTS_PROHIBIDOS = new Set(['localhost', '0.0.0.0', 'metadata.google.internal', 'metadata']);

/** Sufijos reservados para redes internas y resolución local. */
const SUFIJOS_PROHIBIDOS = ['.localhost', '.local', '.internal', '.home.arpa'];

function esIpv4Privada(hostname: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!m) return false;
  const octetos = m.slice(1).map(Number);
  if (octetos.some((o) => o > 255)) return false;
  const [a, b] = octetos;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local: aquí vive 169.254.169.254, el metadata de la nube
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function esIpv6Privada(hostname: string): boolean {
  // `new URL` devuelve el hostname IPv6 entre corchetes.
  if (!hostname.startsWith('[') || !hostname.endsWith(']')) return false;
  const ip = hostname.slice(1, -1).toLowerCase();
  if (ip === '::1' || ip === '::') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(ip)) return true; // fc00::/7, unique local
  if (/^fe[89ab][0-9a-f]:/.test(ip)) return true; // fe80::/10, link-local
  // IPv4 mapeada a IPv6. Ojo con la forma: `new URL('https://[::ffff:127.0.0.1]/')` NO conserva los
  // puntos, el parser de la WHATWG la normaliza a `::ffff:7f00:1`. Una comprobacion escrita contra la
  // forma con puntos no atrapa nada, asi que se reconstruyen los cuatro octetos desde el hexadecimal.
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (hex) {
    const alto = parseInt(hex[1], 16);
    const bajo = parseInt(hex[2], 16);
    return esIpv4Privada([alto >> 8, alto & 0xff, bajo >> 8, bajo & 0xff].join('.'));
  }
  // Por si algun dia llega ya con puntos (otra implementacion, o un valor sin pasar por new URL).
  const puntos = /^::ffff:(d{1,3}.d{1,3}.d{1,3}.d{1,3})$/.exec(ip);
  if (puntos) return esIpv4Privada(puntos[1]);
  return false;
}

/**
 * Devuelve la URL normalizada si es un destino público por https, y lanza en español si no.
 *
 * Lanza en vez de devolver `null` porque esto corre al GUARDAR la configuración: quien la escribió
 * tiene que enterarse de que no se guardó.
 */
export function urlDeWebhookValidada(valor: string): string {
  let u: URL;
  try {
    u = new URL(valor);
  } catch {
    throw new Error(MENSAJE_INVALIDA);
  }

  if (u.protocol !== 'https:') throw new Error(MENSAJE_HTTPS);

  // Credenciales embebidas: además de ser una forma de filtrar un secreto a un tercero, son el truco
  // que hace pasar `https://api.interna@evil.example.com/` por una comprobación que mire el principio
  // de la cadena en vez del host real.
  if (u.username || u.password) throw new Error(MENSAJE_CREDENCIALES);

  // El parser de la WHATWG ya baja el hostname a minusculas, asi que este toLowerCase() no cambia
  // nada hoy: esta por si algun dia el valor llega sin pasar por new URL. No se le escribio prueba a
  // proposito -- no se puede ver fallar rompiendo este modulo, porque lo que garantiza es el parser.
  const host = u.hostname.toLowerCase();
  if (HOSTS_PROHIBIDOS.has(host)) throw new Error(MENSAJE_INTERNO);
  if (SUFIJOS_PROHIBIDOS.some((s) => host.endsWith(s))) throw new Error(MENSAJE_INTERNO);
  if (esIpv4Privada(host) || esIpv6Privada(u.hostname.toLowerCase())) throw new Error(MENSAJE_INTERNO);

  return u.toString();
}
