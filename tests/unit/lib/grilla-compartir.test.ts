import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firmaDeReporte } from '@/lib/reportes';
import {
  firmaDeGrilla,
  mesDePieza,
  tituloDelMes,
  urlDeLaGrilla,
  verificarAccesoAGrilla,
} from '@/lib/grilla-compartir';

const CLIENTE = '11111111-2222-4333-8444-555555555555';

describe('firma de la grilla compartible', () => {
  beforeEach(() => {
    vi.stubEnv('REPORT_LINK_SECRET', 'secreto-de-prueba');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('acepta la firma que genera urlDeLaGrilla', () => {
    const url = new URL(urlDeLaGrilla('https://app.test', CLIENTE, 2026, 10));
    expect(url.pathname).toBe(`/grilla/${CLIENTE}/2026/10`);
    expect(verificarAccesoAGrilla(CLIENTE, '2026', '10', url.searchParams.get('firma'))).toEqual({
      clientId: CLIENTE,
      anio: 2026,
      mes: 10,
    });
  });

  it('rechaza una firma que no corresponde al mes pedido', () => {
    const firma = firmaDeGrilla(CLIENTE, 2026, 10);
    expect(verificarAccesoAGrilla(CLIENTE, '2026', '11', firma)).toBeNull();
  });

  it('rechaza la firma de un reporte de métricas: el prefijo separa los dos usos', () => {
    const firmaDelReporte = firmaDeReporte(CLIENTE, 2026, 10);
    expect(verificarAccesoAGrilla(CLIENTE, '2026', '10', firmaDelReporte)).toBeNull();
  });

  it('rechaza una firma ausente, mal formada o de longitud distinta', () => {
    expect(verificarAccesoAGrilla(CLIENTE, '2026', '10', undefined)).toBeNull();
    expect(verificarAccesoAGrilla(CLIENTE, '2026', '10', 'no-es-hex')).toBeNull();
    expect(verificarAccesoAGrilla(CLIENTE, '2026', '10', 'abcd')).toBeNull();
  });

  it('rechaza parámetros fuera de formato aunque la firma fuera válida para otros valores', () => {
    expect(verificarAccesoAGrilla('no-es-uuid', '2026', '10', firmaDeGrilla('no-es-uuid', 2026, 10))).toBeNull();
    expect(verificarAccesoAGrilla(CLIENTE, '26', '10', firmaDeGrilla(CLIENTE, 26, 10))).toBeNull();
    expect(verificarAccesoAGrilla(CLIENTE, '2026', '13', firmaDeGrilla(CLIENTE, 2026, 13))).toBeNull();
  });

  it('sin REPORT_LINK_SECRET no hay acceso, en vez de un error', () => {
    vi.stubEnv('REPORT_LINK_SECRET', '');
    expect(verificarAccesoAGrilla(CLIENTE, '2026', '10', 'abcd')).toBeNull();
  });
});

describe('mes de una pieza y título del mes', () => {
  it('lee el mes en la zona horaria de la marca, no en UTC', () => {
    // 2026-11-01 02:00 UTC es 31 de octubre en Caracas (UTC-4).
    expect(mesDePieza('2026-11-01T02:00:00.000Z', 'America/Caracas')).toEqual({ anio: 2026, mes: 10 });
    expect(mesDePieza('2026-11-01T02:00:00.000Z', 'UTC')).toEqual({ anio: 2026, mes: 11 });
  });

  it('da el título del mes en español', () => {
    expect(tituloDelMes(2026, 10)).toBe('octubre de 2026');
  });
});
