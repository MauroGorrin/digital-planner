import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorParaElCliente, MENSAJE_GENERICO } from '@/lib/errores';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('errorParaElCliente', () => {
  it('deja pasar el mensaje de un raise exception de las RPC del proyecto', () => {
    // Estos mensajes SON la UX de error del producto y no filtran nada. Si los tapáramos, el cliente
    // dejaría de saber por qué no puede aprobar una pieza.
    const e = errorParaElCliente(
      { code: 'P0001', message: 'Solo el contacto del cliente puede aprobar esta pieza' },
      'approvePiece'
    );
    expect(e.message).toBe('Solo el contacto del cliente puede aprobar esta pieza');
  });

  it('cambia por un mensaje genérico la violación de un check', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {});
    const e = errorParaElCliente(
      {
        code: '23514',
        message: 'new row for relation "client_packages" violates check constraint "client_packages_monthly_quota_check"',
      },
      'definirCuotaDeFormato'
    );
    expect(e.message).toBe(MENSAJE_GENERICO);
    expect(e.message).not.toContain('client_packages_monthly_quota_check');
    expect(espia).toHaveBeenCalled();
  });

  it('cambia por un mensaje genérico unique, foreign key y privilegio', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const code of ['23505', '23503', '42501']) {
      expect(errorParaElCliente({ code, message: 'detalle_de_postgres_con_nombres' }, 'x').message).toBe(
        MENSAJE_GENERICO
      );
    }
  });

  it('cambia por un mensaje genérico un error sin código', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(errorParaElCliente({ message: 'fetch failed' }, 'x').message).toBe(MENSAJE_GENERICO);
  });

  it('deja el detalle en el log del servidor, no en el mensaje', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {});
    errorParaElCliente({ code: '23514', message: 'nombre_de_restriccion' }, 'miAccion');
    expect(espia).toHaveBeenCalledWith('[miAccion]', { code: '23514', message: 'nombre_de_restriccion' });
  });

  it('no escribe en el log cuando el mensaje pasa tal cual', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {});
    errorParaElCliente({ code: 'P0001', message: 'Una pieza no cambia de marca' }, 'updateContentPiece');
    expect(espia).not.toHaveBeenCalled();
  });
});
