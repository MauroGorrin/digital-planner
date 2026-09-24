import { describe, expect, it } from 'vitest';

import { combineDateKeepTime, formatDateTimeInTz, formatTimeInTz } from '@/lib/tz';

// Instante fijo: 2026-03-15T18:30:00Z. En esa fecha Ciudad de México está en UTC-6
// y Madrid en UTC+1, offsets distintos, así que la comparación no puede pasar por casualidad.
const ISO = '2026-03-15T18:30:00.000Z';
const MX = 'America/Mexico_City';
const MADRID = 'Europe/Madrid';

describe('formatTimeInTz', () => {
  it('devuelve la hora de pared de la zona pedida, no la de UTC', () => {
    expect(formatTimeInTz(ISO, MX)).toBe('12:30');
  });

  it('devuelve horas distintas para dos zonas con offsets distintos en el mismo instante', () => {
    const mx = formatTimeInTz(ISO, MX);
    const madrid = formatTimeInTz(ISO, MADRID);

    expect(mx).not.toBe(madrid);
    expect(madrid).toBe('19:30');
  });
});

describe('combineDateKeepTime', () => {
  it('mueve la fecha conservando la hora local del cliente, sin deriva de zona horaria', () => {
    const horaOriginal = formatTimeInTz(ISO, MX);

    const movido = combineDateKeepTime(ISO, '2026-03-20', MX);

    expect(formatTimeInTz(movido, MX)).toBe(horaOriginal);
    expect(formatDateTimeInTz(movido, MX)).toContain('20 mar 2026');
  });
});
