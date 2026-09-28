import { afterEach, describe, expect, it, vi } from 'vitest';
import { scriptDeCaptcha } from '@/lib/captcha';

/**
 * La CSP y el captcha tienen que ir de la mano.
 *
 * El 2026-09-28 se pusieron las variables del captcha en Vercel y el login de produccion quedo
 * bloqueado: la CSP no permitia el script ni el iframe de Turnstile, el widget nunca daba token, y
 * /login no deja intentar sin token. Las pruebas de componente no podian verlo porque jsdom no aplica
 * CSP. Esta prueba lee la politica que de verdad sirve next.config.mjs y la compara contra el origen
 * del que el componente carga el script (scriptDeCaptcha), asi que si alguien cambia uno sin el otro,
 * cae aqui y no en produccion.
 */

async function politica(env: Record<string, string>) {
  for (const [clave, valor] of Object.entries(env)) vi.stubEnv(clave, valor);
  // next.config.mjs calcula la CSP al cargarse: hay que recargarlo con cada juego de variables.
  vi.resetModules();
  const { default: config } = await import('@/next.config.mjs');
  if (!config.headers) throw new Error('next.config.mjs dejó de definir headers(): la CSP ya no se sirve');
  const reglas = await config.headers();
  const cabecera = reglas[0]?.headers.find((h) => h.key === 'Content-Security-Policy');
  if (!cabecera) throw new Error('next.config.mjs ya no manda Content-Security-Policy');
  const valor = cabecera.value;
  return Object.fromEntries(
    valor.split(';').map((d) => {
      const [nombre, ...fuentes] = d.trim().split(/\s+/);
      return [nombre, fuentes];
    })
  ) as Record<string, string[]>;
}

/** ¿Alguna fuente de la directiva cubre este origen? Entiende el comodin https://*.dominio. */
function permite(fuentes: string[] | undefined, origen: string) {
  const host = new URL(origen).host;
  return (fuentes ?? []).some((f) => {
    if (f === origen) return true;
    const comodin = f.match(/^https:\/\/\*\.(.+)$/);
    return comodin ? host.endsWith('.' + comodin[1]) : false;
  });
}

const SUPABASE = { NEXT_PUBLIC_SUPABASE_URL: 'https://proyecto.supabase.co' };

describe('CSP y captcha', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(['turnstile', 'hcaptcha'] as const)(
    'con %s configurado, la CSP deja cargar su script y dibujar su iframe',
    async (proveedor) => {
      const csp = await politica({
        ...SUPABASE,
        NEXT_PUBLIC_CAPTCHA_PROVIDER: proveedor,
        NEXT_PUBLIC_CAPTCHA_SITE_KEY: 'clave-de-sitio',
      });
      const origenDelScript = new URL(scriptDeCaptcha(proveedor)).origin;

      expect(permite(csp['script-src'], origenDelScript), `script-src: ${csp['script-src']}`).toBe(true);
      // El widget vive en un iframe del mismo proveedor. Sin frame-src, cae en default-src 'self'.
      expect(permite(csp['frame-src'], origenDelScript), `frame-src: ${csp['frame-src']}`).toBe(true);
    }
  );

  it('sin captcha configurado la CSP queda cerrada: ni Cloudflare ni hCaptcha', async () => {
    const csp = await politica({ ...SUPABASE, NEXT_PUBLIC_CAPTCHA_PROVIDER: '', NEXT_PUBLIC_CAPTCHA_SITE_KEY: '' });
    const todo = Object.values(csp).flat().join(' ');

    expect(todo).not.toMatch(/cloudflare|hcaptcha/);
    expect(csp['frame-src']).toBeUndefined();
  });

  it('con el proveedor pero sin clave de sitio tampoco se abre: el captcha no existe a medias', async () => {
    const csp = await politica({ ...SUPABASE, NEXT_PUBLIC_CAPTCHA_PROVIDER: 'turnstile', NEXT_PUBLIC_CAPTCHA_SITE_KEY: '' });
    expect(Object.values(csp).flat().join(' ')).not.toMatch(/cloudflare/);
  });
});
