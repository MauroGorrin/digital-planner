import { describe, expect, it } from 'vitest';

import { formatMonthTitle, getDaysBetween, getMonthGridRange } from '@/lib/date-utils';

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
