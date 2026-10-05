import { describe, expect, it } from 'vitest';
import { agruparPorPlataforma, type VistaPieza } from '@/lib/grilla';

function crearVista(overrides: Partial<VistaPieza> = {}): VistaPieza {
  return {
    id: 'pieza-1',
    client_id: 'cliente-1',
    client_slug: 'marca-uno',
    title: 'Pieza',
    copy_text: 'Copy',
    platform: 'instagram',
    format: 'post',
    scheduled_at: '2026-10-01T15:00:00.000Z',
    status: 'programado',
    brand_name: 'Marca Uno',
    timezone: 'UTC',
    portadaUrl: null,
    portadaEsVideo: false,
    ...overrides,
  };
}

describe('agruparPorPlataforma', () => {
  it('devuelve una lista vacía si no hay piezas', () => {
    expect(agruparPorPlataforma([])).toEqual([]);
  });

  it('agrupa por plataforma en el orden fijo del catálogo y omite las plataformas sin piezas', () => {
    const piezas = [
      crearVista({ id: 'a', platform: 'tiktok' }),
      crearVista({ id: 'b', platform: 'instagram' }),
      crearVista({ id: 'c', platform: 'tiktok' }),
    ];

    const grupos = agruparPorPlataforma(piezas);

    expect(grupos.map((g) => g.plataforma)).toEqual(['instagram', 'tiktok']);
    expect(grupos[0].piezas.map((p) => p.id)).toEqual(['b']);
    expect(grupos[1].piezas.map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('conserva el orden original de las piezas dentro de cada plataforma', () => {
    const piezas = [
      crearVista({ id: 'primera', platform: 'linkedin' }),
      crearVista({ id: 'segunda', platform: 'linkedin' }),
      crearVista({ id: 'tercera', platform: 'linkedin' }),
    ];

    const grupos = agruparPorPlataforma(piezas);

    expect(grupos).toHaveLength(1);
    expect(grupos[0].piezas.map((p) => p.id)).toEqual(['primera', 'segunda', 'tercera']);
  });

  it('incluye la plataforma otra cuando hay piezas en ella', () => {
    const grupos = agruparPorPlataforma([crearVista({ platform: 'otra' })]);

    expect(grupos.map((g) => g.plataforma)).toEqual(['otra']);
  });
});
