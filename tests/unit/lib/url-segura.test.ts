import { describe, expect, it } from 'vitest';
import { destinoSeguro, enlaceDeReferenciaValidado, urlSegura } from '@/lib/url-segura';

describe('urlSegura', () => {
  it('acepta una URL https y la normaliza', () => {
    expect(urlSegura('https://ejemplo.com/ruta')).toBe('https://ejemplo.com/ruta');
  });

  it('acepta una URL http', () => {
    expect(urlSegura('http://ejemplo.com')).toBe('http://ejemplo.com/');
  });

  it('rechaza javascript:', () => {
    expect(urlSegura('javascript:alert(1)')).toBeNull();
  });

  it('rechaza javascript: disfrazado con mayúsculas y espacios en blanco', () => {
    // El parser de la WHATWG baja el esquema a minúsculas y quita espacios y tabulaciones, así que
    // estas variantes no se cuelan por debajo de una comprobación de esquema.
    expect(urlSegura('  JavaScript:alert(1)')).toBeNull();
    expect(urlSegura('java\tscript:alert(1)')).toBeNull();
  });

  it('rechaza data:', () => {
    expect(urlSegura('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('rechaza vbscript:', () => {
    expect(urlSegura('vbscript:msgbox(1)')).toBeNull();
  });

  it('devuelve null con una cadena vacía', () => {
    expect(urlSegura('')).toBeNull();
  });

  it('rechaza una ruta relativa, porque un enlace de referencia es externo', () => {
    expect(urlSegura('/piezas/123')).toBeNull();
    expect(urlSegura('ejemplo.com')).toBeNull();
  });
});

describe('enlaceDeReferenciaValidado', () => {
  it('deja pasar un enlace http(s)', () => {
    expect(enlaceDeReferenciaValidado('https://ejemplo.com/a')).toBe('https://ejemplo.com/a');
  });

  it('trata el campo vacío como ausente, porque el enlace es opcional', () => {
    expect(enlaceDeReferenciaValidado('')).toBeNull();
    expect(enlaceDeReferenciaValidado(undefined)).toBeNull();
    expect(enlaceDeReferenciaValidado(null)).toBeNull();
  });

  it('lanza en español en vez de anular en silencio un enlace que no sirve', () => {
    expect(() => enlaceDeReferenciaValidado('javascript:alert(1)')).toThrow(
      'El enlace de referencia debe empezar con http:// o https://'
    );
  });
});

describe('destinoSeguro', () => {
  it('acepta una ruta relativa de este sitio', () => {
    expect(destinoSeguro('/calendario')).toBe('/calendario');
    expect(destinoSeguro('/piezas/123?tab=comentarios')).toBe('/piezas/123?tab=comentarios');
  });

  it('cae a la raíz cuando no hay parámetro', () => {
    expect(destinoSeguro(null)).toBe('/');
    expect(destinoSeguro('')).toBe('/');
  });

  it('rechaza //host, que es protocol-relative y se va del sitio', () => {
    // Empieza con '/', así que un startsWith('/') a secas la dejaría pasar, y el navegador la
    // resuelve como otro sitio.
    expect(destinoSeguro('//evil.example.com')).toBe('/');
    expect(destinoSeguro('//evil.example.com/login')).toBe('/');
  });

  it('rechaza /\\host, que algunos navegadores normalizan a //host', () => {
    expect(destinoSeguro('/\\evil.example.com')).toBe('/');
  });

  it('rechaza una URL absoluta', () => {
    expect(destinoSeguro('https://evil.example.com')).toBe('/');
    expect(destinoSeguro('javascript:alert(1)')).toBe('/');
  });
});
