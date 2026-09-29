import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// REPORT_LINK_SECRET se lee dentro de cada función (mismo criterio que lib/captcha.ts con las
// variables del captcha), así que se fija con vi.stubEnv antes de cada prueba.
beforeEach(() => vi.stubEnv('REPORT_LINK_SECRET', 'clave-secreta-de-pruebas'));
afterEach(() => vi.unstubAllEnvs());

import {
  compartirReportesHabilitado,
  firmaDeReporte,
  firmaEsValida,
  urlDelPdf,
  urlDelReporte,
  verificarAccesoAReporte,
} from '@/lib/reportes';

describe('compartirReportesHabilitado', () => {
  it('es true con REPORT_LINK_SECRET puesta (el estado por defecto de este archivo de pruebas)', () => {
    expect(compartirReportesHabilitado()).toBe(true);
  });

  it('es false sin la variable', () => {
    vi.stubEnv('REPORT_LINK_SECRET', '');
    expect(compartirReportesHabilitado()).toBe(false);
  });
});

describe('firmaDeReporte', () => {
  it('es determinística: la misma marca, año y mes producen siempre la misma firma', () => {
    const a = firmaDeReporte('client-1', 2026, 10);
    const b = firmaDeReporte('client-1', 2026, 10);
    expect(a).toBe(b);
  });

  it('cambia si cambia la marca, el año, o el mes', () => {
    const base = firmaDeReporte('client-1', 2026, 10);
    expect(firmaDeReporte('client-2', 2026, 10)).not.toBe(base);
    expect(firmaDeReporte('client-1', 2027, 10)).not.toBe(base);
    expect(firmaDeReporte('client-1', 2026, 11)).not.toBe(base);
  });

  it('cambia si cambia el secreto del servidor', () => {
    const conSecretoA = firmaDeReporte('client-1', 2026, 10);
    vi.stubEnv('REPORT_LINK_SECRET', 'otra-clave-distinta');
    const conSecretoB = firmaDeReporte('client-1', 2026, 10);
    expect(conSecretoA).not.toBe(conSecretoB);
  });
});

describe('firmaEsValida', () => {
  it('acepta la firma correcta', () => {
    const firma = firmaDeReporte('client-1', 2026, 10);
    expect(firmaEsValida('client-1', 2026, 10, firma)).toBe(true);
  });

  it('rechaza una firma incorrecta', () => {
    expect(firmaEsValida('client-1', 2026, 10, 'firma-inventada')).toBe(false);
  });

  it('rechaza cuando no llega firma', () => {
    expect(firmaEsValida('client-1', 2026, 10, undefined)).toBe(false);
    expect(firmaEsValida('client-1', 2026, 10, null)).toBe(false);
    expect(firmaEsValida('client-1', 2026, 10, '')).toBe(false);
  });

  it('la firma de un mes no sirve para otro mes de la misma marca', () => {
    const firmaDeOctubre = firmaDeReporte('client-1', 2026, 10);
    expect(firmaEsValida('client-1', 2026, 11, firmaDeOctubre)).toBe(false);
  });

  it('la firma de una marca no sirve para otra marca, aunque el año y el mes coincidan', () => {
    const firmaDeUnaMarca = firmaDeReporte('client-1', 2026, 10);
    expect(firmaEsValida('client-2', 2026, 10, firmaDeUnaMarca)).toBe(false);
  });
});

describe('urlDelReporte', () => {
  it('arma la ruta pública con clientId, año y mes en el path y la firma en la query', () => {
    const url = urlDelReporte('https://app.ejemplo.com', 'client-1', 2026, 10);
    const firma = firmaDeReporte('client-1', 2026, 10);
    expect(url).toBe(`https://app.ejemplo.com/reportes/client-1/2026/10?firma=${firma}`);
  });
});

describe('urlDelPdf', () => {
  it('arma la URL del endpoint de PDF con todo en query string', () => {
    const url = urlDelPdf('https://app.ejemplo.com', 'client-1', 2026, 10);
    const firma = firmaDeReporte('client-1', 2026, 10);
    expect(url).toBe(`https://app.ejemplo.com/api/reportes/pdf?client=client-1&anio=2026&mes=10&firma=${firma}`);
  });
});

describe('verificarAccesoAReporte', () => {
  it('con parámetros válidos y firma correcta, devuelve clientId/anio/mes ya convertidos', () => {
    const firma = firmaDeReporte('client-1', 2026, 10);
    expect(verificarAccesoAReporte('client-1', '2026', '10', firma)).toEqual({
      clientId: 'client-1',
      anio: 2026,
      mes: 10,
    });
  });

  it('rechaza un mes fuera de 1-12', () => {
    const firma = firmaDeReporte('client-1', 2026, 13);
    expect(verificarAccesoAReporte('client-1', '2026', '13', firma)).toBeNull();
    const firmaCero = firmaDeReporte('client-1', 2026, 0);
    expect(verificarAccesoAReporte('client-1', '2026', '0', firmaCero)).toBeNull();
  });

  it('rechaza un año que no es un número', () => {
    expect(verificarAccesoAReporte('client-1', 'no-es-un-año', '10', 'lo-que-sea')).toBeNull();
  });

  it('rechaza cuando falta la firma', () => {
    expect(verificarAccesoAReporte('client-1', '2026', '10', undefined)).toBeNull();
  });

  it('rechaza una firma incorrecta para esos parámetros', () => {
    expect(verificarAccesoAReporte('client-1', '2026', '10', 'firma-que-no-corresponde')).toBeNull();
  });

  it('sin REPORT_LINK_SECRET configurada, devuelve null (404) en vez de lanzar (500)', () => {
    const firma = firmaDeReporte('client-1', 2026, 10);
    vi.stubEnv('REPORT_LINK_SECRET', '');
    expect(() => verificarAccesoAReporte('client-1', '2026', '10', firma)).not.toThrow();
    expect(verificarAccesoAReporte('client-1', '2026', '10', firma)).toBeNull();
  });
});
