import { describe, expect, it } from 'vitest';

import { fechaParaInputLocal, formatMonthTitle, getDaysBetween, getMonthGridRange } from '@/lib/date-utils';

describe('getMonthGridRange', () => {
  it('extiende el mes a semanas completas de lunes a domingo', () => {
    // Marzo 2026 empieza en domingo, así que la rejilla debe abrir el lunes anterior.
    const { start, end } = getMonthGridRange(new Date(2026, 2, 15));

    expect(start.getDay()).toBe(1); // lunes
    expect(end.getDay()).toBe(0); // domingo
    expect(start.getTime()).toBeLessThanOrEqual(new Date(2026, 2, 1).getTime());
    expect(end.getTime()).toBeGreaterThanOrEqual(new Date(2026, 2, 31).getTime());
  });
});

describe('getDaysBetween', () => {
  it('devuelve un día por cada fecha del rango, inclusive en ambos extremos', () => {
    const days = getDaysBetween(new Date(2026, 2, 1), new Date(2026, 2, 7));

    expect(days).toHaveLength(7);
    expect(days[0].getDate()).toBe(1);
    expect(days[6].getDate()).toBe(7);
  });
});

describe('formatMonthTitle', () => {
  it('devuelve el mes en español con la inicial en mayúscula', () => {
    expect(formatMonthTitle(new Date(2026, 2, 15))).toMatch(/^Marzo \d{4}$/);
  });
});

describe('fechaParaInputLocal', () => {
  it('convierte una fecha a "AAAA-MM-DDTHH:mm" en hora local, con ceros a la izquierda', () => {
    const fecha = new Date(2026, 0, 5, 9, 3); // 5 de enero de 2026, 09:03 (mes 0-indexado)
    expect(fechaParaInputLocal(fecha)).toBe('2026-01-05T09:03');
  });

  it('sin argumento, devuelve el valor de "ahora"', () => {
    const antes = new Date();
    const valor = fechaParaInputLocal();
    const despues = new Date();

    // No se compara contra un "ahora" fijo (sería inestable): se verifica que el valor cae en el
    // mismo minuto que el momento de la llamada, con tolerancia al segundo en que cambia el minuto.
    expect([fechaParaInputLocal(antes), fechaParaInputLocal(despues)]).toContain(valor);
  });
});
