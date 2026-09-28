'use client';

import { useEffect, useRef } from 'react';
import { configuracionDeCaptcha, scriptDeCaptcha, type ProveedorDeCaptcha } from '@/lib/captcha';

/**
 * Widget de captcha para el alta pública. **No renderiza nada si no hay proveedor configurado**, que
 * es el caso normal hoy: ver el porqué en lib/captcha.ts.
 *
 * Carga el script del proveedor a mano en vez de con un paquete de npm (`@marsidev/react-turnstile`,
 * `@hcaptcha/react-hcaptcha`). La API de los dos proveedores es literalmente `render(elemento,
 * { sitekey, callback })`: un wrapper de React para eso son treinta líneas, y las treinta están
 * abajo. La regla 6 de CLAUDE.md pide una razón para cada dependencia nueva, y "para no escribir
 * treinta líneas" no lo es — sobre todo en el camino del alta, donde un paquete de terceros se
 * ejecuta en una página SIN sesión que recibe correos y contraseñas.
 */

/** La API mínima que exponen los dos proveedores. Sólo se usa `render`. */
interface ApiDeCaptcha {
  render: (
    elemento: HTMLElement,
    opciones: { sitekey: string; callback: (token: string) => void; 'expired-callback'?: () => void; 'error-callback'?: () => void }
  ) => string;
}

function apiDe(proveedor: ProveedorDeCaptcha): ApiDeCaptcha | undefined {
  const w = window as unknown as Record<string, ApiDeCaptcha | undefined>;
  return w[proveedor === 'turnstile' ? 'turnstile' : 'hcaptcha'];
}

export function Captcha({ onToken }: { onToken: (token: string | null) => void }) {
  const contenedor = useRef<HTMLDivElement | null>(null);
  // El callback se guarda en una ref para que el efecto no dependa de él: si dependiera, cada
  // render del formulario (una tecla en cualquier campo) volvería a montar el widget y la persona
  // perdería el desafío que acaba de resolver.
  const alToken = useRef(onToken);
  alToken.current = onToken;

  const config = configuracionDeCaptcha();
  const proveedor = config?.proveedor;
  const claveDeSitio = config?.claveDeSitio;

  useEffect(() => {
    if (!proveedor || !claveDeSitio) return;
    let cancelado = false;

    function dibujar() {
      if (cancelado || !contenedor.current || !proveedor || !claveDeSitio) return;
      const api = apiDe(proveedor);
      if (!api) return;
      // Se vacía antes de dibujar: en desarrollo React monta los efectos dos veces y sin esto
      // aparecerían dos widgets, uno de ellos sin nadie escuchándolo.
      contenedor.current.innerHTML = '';
      api.render(contenedor.current, {
        sitekey: claveDeSitio,
        callback: (token: string) => alToken.current(token),
        // Un token de captcha caduca. Si se deja el viejo puesto, el signUp falla con un error que
        // no dice nada; anulándolo, el formulario vuelve a pedir el desafío antes de enviar.
        'expired-callback': () => alToken.current(null),
        'error-callback': () => alToken.current(null),
      });
    }

    if (apiDe(proveedor)) {
      dibujar();
      return () => {
        cancelado = true;
      };
    }

    const url = scriptDeCaptcha(proveedor);
    let script = document.querySelector<HTMLScriptElement>(`script[src="${url}"]`);
    if (!script) {
      script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', dibujar);
    return () => {
      cancelado = true;
      script?.removeEventListener('load', dibujar);
    };
  }, [proveedor, claveDeSitio]);

  if (!proveedor) return null;
  return <div ref={contenedor} data-testid="captcha" className="flex justify-center" />;
}
