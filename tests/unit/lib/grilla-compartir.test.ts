import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firmaDeReporte } from '@/lib/reportes';
import {
  firmaDeGrilla,
  mesDePieza,
  tituloDelMes,
  urlDeLaGrilla,
  verificarAccesoAGrilla,
} from '@/lib/grilla-compartir';

const MARCA = 'cafe-lucuma';

describe('firma de la grilla compartible', () => {
  beforeEach(() => {
    vi.stubEnv('REPORT_LINK_SECRET', 'secreto-de-prueba');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('acepta la firma que genera urlDeLaGrilla', () => {
    const url = new URL(urlDeLaGrilla('https://app.test', MARCA, 2026, 10));
    expect(url.pathname).toBe(`/grilla/${MARCA}/2026/10`);
    expect(verificarAccesoAGrilla(MARCA, '2026', '10', url.searchParams.get('firma'))).toEqual({
      slug: MARCA,
      anio: 2026,
      mes: 10,
    });
  });

  it('rechaza una firma que no corresponde al mes pedido', () => {
    const firma = firmaDeGrilla(MARCA, 2026, 10);
    expect(verificarAccesoAGrilla(MARCA, '2026', '11', firma)).toBeNull();
  });

  it('rechaza una firma de otra marca', () => {
    const firma = firmaDeGrilla('otra-marca', 2026, 10);
    expect(verificarAccesoAGrilla(MARCA, '2026', '10', firma)).toBeNull();
  });

  it('rechaza la firma de un reporte de métricas: el prefijo separa los dos usos', () => {
    const firmaDelReporte = firmaDeReporte(MARCA, 2026, 10);
    expect(verificarAccesoAGrilla(MARCA, '2026', '10', firmaDelReporte)).toBeNull();
  });

  it('rechaza una firma ausente, mal formada o de longitud distinta', () => {
    expect(verificarAccesoAGrilla(MARCA, '2026', '10', undefined)).toBeNull();
    expect(verificarAccesoAGrilla(MARCA, '2026', '10', 'no-es-hex')).toBeNull();
    expect(verificarAccesoAGrilla(MARCA, '2026', '10', 'abcd')).toBeNull();
  });

  it('rechaza slugs y parámetros fuera de formato', () => {
    expect(verificarAccesoAGrilla('Café Lúcuma', '2026', '10', firmaDeGrilla('Café Lúcuma', 2026, 10))).toBeNull();
    expect(verificarAccesoAGrilla('cafe--lucuma', '2026', '10', firmaDeGrilla('cafe--lucuma', 2026, 10))).toBeNull();
    expect(verificarAccesoAGrilla(MARCA, '26', '10', firmaDeGrilla(MARCA, 26, 10))).toBeNull();
    expect(verificarAccesoAGrilla(MARCA, '2026', '13', firmaDeGrilla(MARCA, 2026, 13))).toBeNull();
  });

  it('sin REPORT_LINK_SECRET no hay acceso, en vez de un error', () => {
    vi.stubEnv('REPORT_LINK_SECRET', '');
    expect(verificarAccesoAGrilla(MARCA, '2026', '10', 'abcd')).toBeNull();
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
