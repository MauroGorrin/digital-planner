import { describe, expect, it } from 'vitest';
import { estadoCoincide } from '@/lib/google-calendar/oauth-estado';

const NONCE = 'a'.repeat(64);

describe('estadoCoincide', () => {
  it('acepta el nonce idéntico que guardó la cookie', () => {
    expect(estadoCoincide(NONCE, NONCE)).toBe(true);
  });

  it('rechaza un nonce distinto del mismo largo', () => {
    expect(estadoCoincide(NONCE, 'b'.repeat(64))).toBe(false);
  });

  it('rechaza sin lanzar cuando los largos no coinciden', () => {
    // La guarda de longitud existe por esto: `timingSafeEqual` lanza con buffers de distinto tamaño,
    // y una excepción aquí no sería "estado inválido" sino un 500 en medio del callback.
    expect(() => estadoCoincide(NONCE, 'corto')).not.toThrow();
    expect(estadoCoincide(NONCE, 'corto')).toBe(false);
  });

  it('rechaza cuando no hay cookie guardada', () => {
    expect(estadoCoincide(undefined, NONCE)).toBe(false);
    expect(estadoCoincide(null, NONCE)).toBe(false);
    expect(estadoCoincide('', NONCE)).toBe(false);
  });

  it('rechaza cuando Google no devolvió ningún state', () => {
    expect(estadoCoincide(NONCE, '')).toBe(false);
  });
});
