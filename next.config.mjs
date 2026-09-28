// El origen de Supabase se deriva de NEXT_PUBLIC_SUPABASE_URL al cargar la config (Next carga los
// archivos .env antes que este módulo, así que la variable ya está aquí). No se escribe a mano el
// hostname del proyecto porque este repositorio no conoce su project ref: cada despliegue trae el
// suyo en esa variable.
function origenDeSupabase() {
  const bruta = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!bruta) return null;
  try {
    const u = new URL(bruta);
    return {
      protocol: u.protocol.replace(':', ''),
      hostname: u.hostname,
      port: u.port,
      origin: u.origin,
      // Supabase Realtime abre un WebSocket contra el mismo host (components/NotificationBell.tsx
      // se suscribe a un canal). Sin este origen en connect-src, la campana de notificaciones deja
      // de recibir nada y no lo dice: el navegador bloquea la conexión en silencio.
      origenWs: u.origin.replace(/^http/, 'ws'),
    };
  } catch {
    return null;
  }
}

const supabase = origenDeSupabase();

/**
 * Patrones remotos del optimizador de imágenes.
 *
 * Antes aquí había `hostname: '**.supabase.co'`. Ese comodín no significa "mi proyecto": significa
 * TODOS los proyectos Supabase de internet. Y `/_next/image` existe en cualquier app Next aunque
 * nunca se importe `next/image` (aquí no se importa) y el matcher del middleware lo excluye a
 * propósito. Eso es exactamente lo que hacía ALCANZABLE el RCE del optimizador de imágenes de Next
 * (GHSA-2xp9-vwfh-vxw4, vía AVIF): un atacante alojaba la imagen en SU propio proyecto Supabase y
 * este despliegue la descargaba y la procesaba. Además es SSRF por sí solo.
 *
 * Si la variable no está, la lista queda vacía y el optimizador rechaza toda URL remota. Preferimos
 * que una imagen no cargue antes que volver a abrir el comodín por omisión.
 */
const patronesRemotos = supabase
  ? [
      {
        protocol: supabase.protocol,
        hostname: supabase.hostname,
        // El puerto viaja también: en local Supabase es 127.0.0.1:54321, no un host .supabase.co.
        ...(supabase.port ? { port: supabase.port } : {}),
      },
    ]
  : [];

// Los orígenes de Supabase que el navegador necesita alcanzar. Salen de la MISMA variable que los
// patrones de imagen de arriba, a propósito: si un día alguien cambia de proyecto, no hay dos
// hostnames que actualizar por separado.
const origenesSupabase = supabase ? `${supabase.origin} ${supabase.origenWs}` : '';

/**
 * Política de seguridad de contenido.
 *
 * Calibrado con honestidad: no hay `dangerouslySetInnerHTML` ni ningún sumidero de HTML crudo en
 * esta app, así que el escape por defecto de React ya tapa el camino habitual de XSS almacenado.
 * Aquí la CSP es defensa en profundidad. Lo que sí cierra hoy mismo es el CLICKJACKING: sin
 * protección de marco, un tercero puede embeber /piezas/[id] y hacer que un contacto del cliente
 * pulse "Aprobar" sin saberlo, que es la acción central del negocio.
 *
 * `script-src` conserva 'unsafe-inline' A PROPÓSITO. Next inyecta su propio bootstrap inline y no
 * hay nonces conectados en esta app; quitarlo ahora rompe la hidratación en toda la aplicación. El
 * seguimiento es cablear un nonce en el middleware y en `layout.tsx` y recién entonces quitarlo. Una
 * cabecera de seguridad que obliga a alguien a desactivarla después es peor que no tenerla.
 *
 * `style-src` también lo conserva: Tailwind compila a un archivo, pero React escribe estilos inline
 * en atributos `style` y Next inyecta CSS inline en desarrollo.
 */
/**
 * Los orígenes del proveedor de captcha, y SOLO si hay uno configurado.
 *
 * Sin esto la CSP bloquea el script y el iframe del widget -- `script-src 'self'` y un `frame-src`
 * que cae en `default-src 'self'` --, el formulario nunca recibe un token, y como `/login` exige el
 * token cuando las variables están puestas, NADIE puede iniciar sesión. Pasó en producción el
 * 2026-09-28: se pusieron las variables en Vercel y el login quedó bloqueado hasta un rollback. Las
 * pruebas no lo vieron porque jsdom no aplica CSP.
 *
 * Se abre por proveedor y no "siempre a Cloudflare": sin captcha configurado la política queda
 * exactamente como antes. Tiene que coincidir con `scriptDeCaptcha()` de `lib/captcha.ts`, que es de
 * donde el componente carga el script; `tests/unit/csp.test.ts` falla si se desalinean.
 *
 * - Turnstile sirve script e iframe desde challenges.cloudflare.com (guía de CSP de Cloudflare).
 * - hCaptcha carga el script de js.hcaptcha.com y dibuja el iframe desde otros subdominios de
 *   hcaptcha.com, así que su guía pide el dominio y el comodín, también en style-src y connect-src.
 */
const ORIGENES_DE_CAPTCHA = {
  turnstile: { script: ['https://challenges.cloudflare.com'], frame: ['https://challenges.cloudflare.com'], style: [], connect: [] },
  hcaptcha: {
    script: ['https://hcaptcha.com', 'https://*.hcaptcha.com'],
    frame: ['https://hcaptcha.com', 'https://*.hcaptcha.com'],
    style: ['https://hcaptcha.com', 'https://*.hcaptcha.com'],
    connect: ['https://hcaptcha.com', 'https://*.hcaptcha.com'],
  },
};

// Mismo criterio que lib/captcha.ts: el captcha existe solo si están las DOS variables.
const proveedorDeCaptcha =
  process.env.NEXT_PUBLIC_CAPTCHA_SITE_KEY && ORIGENES_DE_CAPTCHA[process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER]
    ? process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER
    : null;
const captcha = proveedorDeCaptcha ? ORIGENES_DE_CAPTCHA[proveedorDeCaptcha] : null;
const mas = (lista) => (lista && lista.length ? ' ' + lista.join(' ') : '');

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${mas(captcha?.script)}`,
  `style-src 'self' 'unsafe-inline'${mas(captcha?.style)}`,
  `img-src 'self' data: blob:${supabase ? ' ' + supabase.origin : ''}`,
  `connect-src 'self'${origenesSupabase ? ' ' + origenesSupabase : ''}${mas(captcha?.connect)}`,
  // Sin captcha no se declara: cae en default-src 'self', como siempre.
  ...(captcha ? [`frame-src 'self'${mas(captcha.frame)}`] : []),
  "font-src 'self' data:",
  // Las URLs firmadas de los adjuntos se abren en <video>/<audio> y en iframes de previsualización
  // del propio Storage, todo bajo el origen de Supabase.
  `media-src 'self' blob:${supabase ? ' ' + supabase.origin : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const cabecerasDeSeguridad = [
  { key: 'Content-Security-Policy', value: csp },
  // Vercel ya pone HSTS en sus propios dominios; en un dominio propio o en otro alojamiento no lo
  // pone nadie, y la cabecera no estorba donde ya está.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  // Redundante con frame-ancestors para navegadores al día, y la única protección en los que no.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ya no hay `eslint: { ignoreDuringBuilds: true }` (CN-025): `npm run lint` está limpio, así que
  // el build puede volver a fallar por lint sin costarle nada a nadie. El gate de CI no cambia --
  // lint y tsc siguen siendo pasos duros aparte -- pero un deploy hecho fuera de CI ya no se salta
  // el linter.
  images: {
    remotePatterns: patronesRemotos,
  },
  async headers() {
    return [{ source: '/(.*)', headers: cabecerasDeSeguridad }];
  },
};

export default nextConfig;
