// Configuración del captcha del alta pública y del inicio de sesión (`/login` usa el mismo
// interruptor: con el captcha encendido en Supabase, `signInWithPassword` también exige el token --
// ver "Sobre el captcha" en CLAUDE.md). Módulo puro y sin dependencias: lo lee el formulario
// (navegador) y la Server Action (servidor), y las dos tienen que coincidir en si hay captcha o no.
//
// EL CAPTCHA ES OPCIONAL A PROPÓSITO, y ésa es la decisión que explica todo este archivo. Supabase
// soporta Turnstile y hCaptcha de forma nativa en `/auth/v1/signup`, pero la verificación la hace el
// PROYECTO de Supabase, no esta app: hay que pegar la clave secreta del proveedor en el panel y
// encenderlo ahí. Si el alta dependiera de una clave que hoy no existe, la página quedaría rota en
// todos los entornos hasta que alguien contrate un proveedor — incluida la Supabase local donde
// corren las pruebas, que no tiene captcha ni forma de tenerlo.
//
// Así que el captcha se enciende SOLO si las dos variables están puestas. Sin ellas el formulario
// se dibuja igual y el alta funciona; con ellas aparece el widget y el token viaja al signUp. El
// interruptor es la presencia de la variable y no un booleano tipo `CAPTCHA_ENABLED=true`, porque un
// booleano en true con la clave vacía es un estado que hay que detectar y explicar, mientras que
// "están las dos o no hay captcha" no tiene estados intermedios.
//
// QUÉ FALTA PARA ENCENDERLO DE VERDAD, dicho aquí para que no se descubra a medias: poner estas dos
// variables sólo dibuja el widget y manda el token. Supabase RECHAZA el token si en el panel
// (Authentication → Settings → Bot and Abuse Protection) no está activado el mismo proveedor con su
// clave secreta. Las dos mitades van juntas; ninguna sirve sola.

/** Los dos proveedores que Supabase verifica de forma nativa. */
export type ProveedorDeCaptcha = 'turnstile' | 'hcaptcha';

export interface ConfiguracionDeCaptcha {
  proveedor: ProveedorDeCaptcha;
  claveDeSitio: string;
}

const PROVEEDORES: readonly string[] = ['turnstile', 'hcaptcha'];

/**
 * Núcleo puro: decide la configuración a partir de dos valores sueltos.
 *
 * Está separado de la lectura de `process.env` para que se pueda probar sin tocar el entorno del
 * proceso — y porque en Next las variables `NEXT_PUBLIC_*` sólo se inlinean si se escriben como
 * acceso literal (`process.env.NEXT_PUBLIC_X`), así que la lectura tiene que vivir escrita tal cual
 * en la función de abajo y no puede recibirse por parámetro.
 */
export function interpretarConfiguracionDeCaptcha(
  proveedor: string | undefined,
  claveDeSitio: string | undefined
): ConfiguracionDeCaptcha | null {
  const p = (proveedor ?? '').trim().toLowerCase();
  const clave = (claveDeSitio ?? '').trim();
  if (!p || !clave) return null;
  // Un proveedor escrito mal (`turnsitle`) no se ignora en silencio: sin captcha el alta queda
  // abierta a los bots y quien puso la variable creería que la protegió. Se ve en el log del
  // servidor y en la consola del navegador, que es donde mira quien acaba de configurarlo.
  if (!PROVEEDORES.includes(p)) {
    console.error(
      `[captcha] Proveedor desconocido: "${proveedor}". Los valores válidos son ${PROVEEDORES.join(' o ')}. El alta seguirá SIN captcha.`
    );
    return null;
  }
  return { proveedor: p as ProveedorDeCaptcha, claveDeSitio: clave };
}

/** La configuración efectiva de este entorno, o `null` si no hay captcha configurado. */
export function configuracionDeCaptcha(): ConfiguracionDeCaptcha | null {
  return interpretarConfiguracionDeCaptcha(
    process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER,
    process.env.NEXT_PUBLIC_CAPTCHA_SITE_KEY
  );
}

/**
 * `true` si este entorno exige un token de captcha para dar de alta.
 *
 * Lo preguntan el formulario (para no enviar sin token) y la Server Action (para no aceptar un alta
 * sin él). Vive AQUÍ y no en components/Captcha.tsx a propósito: aquel archivo lleva `'use client'`
 * y desde el servidor sus exports son referencias a un módulo de cliente, no funciones que se puedan
 * llamar. Las dos mitades preguntan a la misma función por la misma razón por la que las dos validan
 * con `lib/validacion-registro.ts`: dos definiciones de la misma regla acaban no coincidiendo.
 */
export function captchaEsObligatorio(): boolean {
  return configuracionDeCaptcha() !== null;
}

/** La URL del script del proveedor, en modo de render explícito. */
export function scriptDeCaptcha(proveedor: ProveedorDeCaptcha): string {
  return proveedor === 'turnstile'
    ? 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    : 'https://js.hcaptcha.com/1/api.js?render=explicit';
}
