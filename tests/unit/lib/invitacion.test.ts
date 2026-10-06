import { describe, expect, it } from 'vitest';
import { mensajeDeInvitacion, urlDeWhatsApp } from '@/lib/invitacion';

describe('mensajeDeInvitacion', () => {
  it('con clave, incluye el usuario, la clave y el enlace a /grilla', () => {
    const mensaje = mensajeDeInvitacion({
      fullName: 'Ana Pérez',
      marca: 'Mamalactea',
      email: 'ana@cliente.com',
      clave: 'xyz123',
      baseUrl: 'https://app.ejemplo.com',
    });

    expect(mensaje).toContain('Ana Pérez');
    expect(mensaje).toContain('Mamalactea');
    expect(mensaje).toContain('ana@cliente.com');
    expect(mensaje).toContain('xyz123');
    expect(mensaje).toContain('https://app.ejemplo.com/login?redirect=%2Fgrilla');
  });

  it('sin clave, no promete ninguna y avisa que ya tiene cuenta', () => {
    const mensaje = mensajeDeInvitacion({
      fullName: 'Ana Pérez',
      marca: 'Mamalactea',
      email: 'ana@cliente.com',
      baseUrl: 'https://app.ejemplo.com',
    });

    expect(mensaje).not.toMatch(/clave/i);
    expect(mensaje).toContain('ya tienes acceso');
    expect(mensaje).toContain('https://app.ejemplo.com/login?redirect=%2Fgrilla');
  });
});

describe('urlDeWhatsApp', () => {
  it('codifica el mensaje completo en el parámetro text', () => {
    const url = urlDeWhatsApp('Hola, línea 1\nlínea 2');

    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(url.replace('https://wa.me/?text=', ''))).toBe('Hola, línea 1\nlínea 2');
  });
});
