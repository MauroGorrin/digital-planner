import { describe, expect, it, vi } from 'vitest';
import type { ItemDeLote } from '@/app/actions-lote';

const createContentPiece = vi.fn();
vi.mock('@/app/actions', () => ({
  createContentPiece: (...args: unknown[]) => createContentPiece(...args),
}));

const requireAgency = vi.fn().mockResolvedValue({ id: 'profile-1', role: 'agency_admin' });
vi.mock('@/lib/auth', () => ({
  requireAgency: (...args: unknown[]) => requireAgency(...args),
}));

import { createContentPieces } from '@/app/actions-lote';

function item(overrides: Partial<ItemDeLote> = {}): ItemDeLote {
  return {
    client_id: 'client-a',
    platform: 'instagram',
    format: 'post',
    title: 'Pieza de prueba',
    copy_text: '',
    scheduled_at: '2026-10-05T15:00:00.000Z',
    ...overrides,
  };
}

describe('createContentPieces', () => {
  it('crea las piezas de todos los ítems cuando ninguna falla, en el mismo orden', async () => {
    requireAgency.mockReset().mockResolvedValue({ id: 'profile-1', role: 'agency_admin' });
    createContentPiece.mockReset();
    createContentPiece.mockResolvedValueOnce('id-1').mockResolvedValueOnce('id-2').mockResolvedValueOnce('id-3');

    const resultado = await createContentPieces([item(), item(), item()]);

    expect(resultado.creadas).toEqual([
      { indice: 0, id: 'id-1' },
      { indice: 1, id: 'id-2' },
      { indice: 2, id: 'id-3' },
    ]);
    expect(resultado.fallidas).toEqual([]);
    expect(createContentPiece).toHaveBeenCalledTimes(3);
  });

  it('un ítem que falla no detiene ni descarta los que sí se crearon', async () => {
    createContentPiece.mockReset();
    createContentPiece
      .mockResolvedValueOnce('id-1')
      .mockRejectedValueOnce(new Error('Esa marca no existe o no pertenece a tu agencia.'))
      .mockResolvedValueOnce('id-3');

    const resultado = await createContentPieces([item(), item({ client_id: 'client-ajeno' }), item()]);

    expect(resultado.creadas).toEqual([
      { indice: 0, id: 'id-1' },
      { indice: 2, id: 'id-3' },
    ]);
    expect(resultado.fallidas).toEqual([{ indice: 1, mensaje: 'Esa marca no existe o no pertenece a tu agencia.' }]);
  });

  it('un ítem que falla con un error sin mensaje usa un mensaje genérico', async () => {
    createContentPiece.mockReset();
    createContentPiece.mockRejectedValueOnce('fallo sin forma de Error');

    const resultado = await createContentPieces([item()]);

    expect(resultado.fallidas).toEqual([{ indice: 0, mensaje: 'No se pudo crear esta pieza.' }]);
  });

  it('rechaza un lote de más de 12 ítems sin llamar a createContentPiece ni una vez', async () => {
    createContentPiece.mockReset();
    const items = Array.from({ length: 13 }, () => item());

    await expect(createContentPieces(items)).rejects.toThrow(/12/);
    expect(createContentPiece).not.toHaveBeenCalled();
  });

  it('acepta un lote de exactamente 12 ítems', async () => {
    requireAgency.mockReset().mockResolvedValue({ id: 'profile-1', role: 'agency_admin' });
    createContentPiece.mockReset();
    createContentPiece.mockResolvedValue('id-x');
    const items = Array.from({ length: 12 }, () => item());

    const resultado = await createContentPieces(items);

    expect(resultado.creadas).toHaveLength(12);
    expect(resultado.fallidas).toHaveLength(0);
  });

  it('resuelve la sesión con requireAgency() ANTES del bucle, sin capturar su rechazo como una fila fallida', async () => {
    // requireAgency() funciona lanzando el redirect() de Next cuando la sesión expiró: acá se
    // simula ese rechazo. Si createContentPieces lo tratara como el fallo de un ítem cualquiera,
    // esta promesa resolvería con una fila en `fallidas` en vez de rechazar -- exactamente el bug
    // que este cambio corrige (un redirect que nunca redirige, repetido N veces).
    requireAgency.mockReset().mockRejectedValue(new Error('NEXT_REDIRECT'));
    createContentPiece.mockReset();

    await expect(createContentPieces([item(), item()])).rejects.toThrow('NEXT_REDIRECT');
    expect(createContentPiece).not.toHaveBeenCalled();
  });
});
