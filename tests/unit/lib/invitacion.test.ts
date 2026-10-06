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
    // Sin codificar: %2Fgrilla se pega como una URL rota en WhatsApp/correo.
    expect(mensaje).toContain('https://app.ejemplo.com/login?redirect=/grilla');
    expect(mensaje).not.toContain('%2F');
  });

  it('sin clave, no promete ninguna y avisa que ya tiene cuenta', () => {
    const mensaje = mensajeDeInvitacion({
      fullName: 'Ana Pérez',
      marca: 'Mamalactea',
      email: 'ana@cliente.com',
      baseUrl: 'https://app.ejemplo.com',
    });

    expect(mensaje).not.toMatch(/clave/i);
    expect(mensaje).toMatch(/ya tienes acceso/i);
    expect(mensaje).toContain('https://app.ejemplo.com/login?redirect=/grilla');
  });

  it('con agencyName, firma el mensaje; sin él, no firma con nadie', () => {
    const conFirma = mensajeDeInvitacion({
      fullName: 'Ana',
      marca: 'Mamalactea',
      email: 'ana@cliente.com',
      baseUrl: 'https://app.ejemplo.com',
      agencyName: 'Libélula Social Media',
    });
    const sinFirma = mensajeDeInvitacion({
      fullName: 'Ana',
      marca: 'Mamalactea',
      email: 'ana@cliente.com',
      baseUrl: 'https://app.ejemplo.com',
    });

    expect(conFirma).toContain('Saludos,\nLibélula Social Media');
    expect(sinFirma).not.toContain('Saludos');
  });
});

describe('urlDeWhatsApp', () => {
  it('codifica el mensaje completo en el parámetro text', () => {
    const url = urlDeWhatsApp('Hola, línea 1\nlínea 2');

    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(url.replace('https://wa.me/?text=', ''))).toBe('Hola, línea 1\nlínea 2');
  });
});
