import { afterEach, describe, expect, it, vi } from 'vitest';
import { interpretarConfiguracionDeCaptcha, scriptDeCaptcha } from '@/lib/captcha';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('interpretarConfiguracionDeCaptcha', () => {
  it('devuelve null sin ninguna variable: el alta funciona sin captcha', () => {
    expect(interpretarConfiguracionDeCaptcha(undefined, undefined)).toBeNull();
  });

  it('devuelve null con proveedor pero sin clave de sitio: las dos mitades van juntas', () => {
    expect(interpretarConfiguracionDeCaptcha('turnstile', '')).toBeNull();
  });

  it('devuelve null con clave de sitio pero sin proveedor', () => {
    expect(interpretarConfiguracionDeCaptcha('', '0x4AAA')).toBeNull();
  });

  it('enciende Turnstile cuando están las dos', () => {
    expect(interpretarConfiguracionDeCaptcha('turnstile', '0x4AAA')).toEqual({
      proveedor: 'turnstile',
      claveDeSitio: '0x4AAA',
    });
  });

  it('enciende hCaptcha y tolera mayúsculas y espacios en la variable', () => {
    expect(interpretarConfiguracionDeCaptcha('  hCaptcha ', ' clave-de-sitio ')).toEqual({
      proveedor: 'hcaptcha',
      claveDeSitio: 'clave-de-sitio',
    });
  });

  it('un proveedor mal escrito no se ignora en silencio: queda sin captcha y lo reporta', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(interpretarConfiguracionDeCaptcha('turnsitle', '0x4AAA')).toBeNull();
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][0]).toContain('turnsitle');
  });
});

describe('scriptDeCaptcha', () => {
  it('pide el script de Turnstile en modo explícito', () => {
    expect(scriptDeCaptcha('turnstile')).toBe(
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    );
  });

  it('pide el script de hCaptcha en modo explícito', () => {
    expect(scriptDeCaptcha('hcaptcha')).toBe('https://js.hcaptcha.com/1/api.js?render=explicit');
  });
});
