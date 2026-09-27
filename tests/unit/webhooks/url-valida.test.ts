import { describe, expect, it } from 'vitest';
import { urlDeWebhookValidada } from '@/lib/webhooks/url-valida';

describe('urlDeWebhookValidada', () => {
  it('acepta un destino público por https', () => {
    expect(urlDeWebhookValidada('https://hook.make.com/abc123')).toBe('https://hook.make.com/abc123');
  });

  it('rechaza http, porque el secreto HMAC viaja en un header', () => {
    expect(() => urlDeWebhookValidada('http://hook.make.com/abc')).toThrow('El webhook debe usar https.');
  });

  it('rechaza un esquema que no es http(s)', () => {
    expect(() => urlDeWebhookValidada('file:///etc/passwd')).toThrow();
    expect(() => urlDeWebhookValidada('gopher://evil.example.com')).toThrow();
  });

  it('rechaza algo que no es una URL', () => {
    expect(() => urlDeWebhookValidada('hook.make.com')).toThrow('La URL del webhook no es válida.');
    expect(() => urlDeWebhookValidada('')).toThrow('La URL del webhook no es válida.');
  });

  it('rechaza credenciales embebidas', () => {
    // Además de filtrar un secreto a un tercero, es el truco que hace pasar una comprobación que mire
    // el principio de la cadena en vez del host real.
    expect(() => urlDeWebhookValidada('https://usuario:clave@evil.example.com/hook')).toThrow(
      'La URL del webhook no debe llevar usuario ni contraseña.'
    );
    expect(() => urlDeWebhookValidada('https://api.interna@evil.example.com/hook')).toThrow(
      'La URL del webhook no debe llevar usuario ni contraseña.'
    );
  });

  it('rechaza el endpoint de metadata de la nube', () => {
    // Es el objetivo concreto que cita CN-009.
    expect(() => urlDeWebhookValidada('https://169.254.169.254/latest/meta-data/')).toThrow(
      'No se permiten direcciones internas.'
    );
    expect(() => urlDeWebhookValidada('https://metadata.google.internal/computeMetadata/v1/')).toThrow(
      'No se permiten direcciones internas.'
    );
  });

  it('rechaza loopback por nombre y por IP', () => {
    expect(() => urlDeWebhookValidada('https://localhost/hook')).toThrow('No se permiten direcciones internas.');
    expect(() => urlDeWebhookValidada('https://127.0.0.1/hook')).toThrow('No se permiten direcciones internas.');
    expect(() => urlDeWebhookValidada('https://127.1.2.3/hook')).toThrow('No se permiten direcciones internas.');
    expect(() => urlDeWebhookValidada('https://[::1]/hook')).toThrow('No se permiten direcciones internas.');
  });

  it('rechaza los rangos privados de IPv4', () => {
    for (const host of ['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.1', '100.64.0.1', '0.0.0.0']) {
      expect(() => urlDeWebhookValidada(`https://${host}/hook`), host).toThrow('No se permiten direcciones internas.');
    }
  });

  it('acepta una IPv4 pública que se parece a una privada sin serlo', () => {
    // 172.32.x y 11.x están fuera de los rangos privados: rechazarlas seria un falso positivo.
    expect(urlDeWebhookValidada('https://172.32.0.1/hook')).toBe('https://172.32.0.1/hook');
    expect(urlDeWebhookValidada('https://11.0.0.1/hook')).toBe('https://11.0.0.1/hook');
  });

  it('rechaza IPv6 link-local, unique-local y IPv4 mapeada a IPv6', () => {
    expect(() => urlDeWebhookValidada('https://[fe80::1]/hook')).toThrow('No se permiten direcciones internas.');
    expect(() => urlDeWebhookValidada('https://[fd00::1]/hook')).toThrow('No se permiten direcciones internas.');
    expect(() => urlDeWebhookValidada('https://[::ffff:127.0.0.1]/hook')).toThrow(
      'No se permiten direcciones internas.'
    );
  });

  it('rechaza los sufijos reservados para redes internas', () => {
    for (const host of ['api.localhost', 'servicio.local', 'db.internal', 'router.home.arpa']) {
      expect(() => urlDeWebhookValidada(`https://${host}/hook`), host).toThrow('No se permiten direcciones internas.');
    }
  });
});
