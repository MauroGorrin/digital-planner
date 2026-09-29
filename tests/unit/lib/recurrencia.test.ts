import { describe, expect, it } from 'vitest';
import { fechasRecurrentes } from '@/lib/recurrencia';

// Días de Date#getDay(): 0 domingo, 1 lunes ... 6 sábado.
const LUNES = 1;
const JUEVES = 4;

function fecha(iso: string): Date {
  return new Date(iso);
}

function comoISO(fechas: Date[]): string[] {
  return fechas.map((f) => f.toISOString());
}

describe('fechasRecurrentes', () => {
  it('con un martes de inicio y días [lunes, jueves], devuelve 4 fechas en orden con la hora del original', () => {
    // 2026-09-29 es martes.
    const inicio = fecha('2026-09-29T15:30:00.000Z');
    const resultado = fechasRecurrentes(inicio, [LUNES, JUEVES], 4);

    expect(comoISO(resultado)).toEqual([
      '2026-09-29T15:30:00.000Z', // el propio martes de inicio, siempre primero
      '2026-10-01T15:30:00.000Z', // jueves siguiente
      '2026-10-05T15:30:00.000Z', // lunes siguiente
      '2026-10-08T15:30:00.000Z', // jueves siguiente
    ]);
  });

  it('con cantidad 1 devuelve solo la fecha inicial, sin importar qué días estén marcados', () => {
    const inicio = fecha('2026-09-29T09:00:00.000Z');
    const resultado = fechasRecurrentes(inicio, [LUNES], 1);

    expect(comoISO(resultado)).toEqual(['2026-09-29T09:00:00.000Z']);
  });

  it('la fecha inicial siempre es la primera devuelta, aunque su día no esté en diasDeLaSemana', () => {
    // 2026-09-29 es martes; no está en [lunes, jueves], pero debe salir igual como la primera.
    const inicio = fecha('2026-09-29T12:00:00.000Z');
    const resultado = fechasRecurrentes(inicio, [LUNES, JUEVES], 2);

    expect(resultado[0].toISOString()).toBe('2026-09-29T12:00:00.000Z');
    expect(resultado).toHaveLength(2);
  });

  it('una serie que cruza un cambio de mes no salta ni repite un día', () => {
    // 2026-01-29 es jueves. Con días [jueves], las siguientes son 5 y 12 de febrero.
    const inicio = fecha('2026-01-29T10:00:00.000Z');
    const resultado = fechasRecurrentes(inicio, [JUEVES], 3);

    expect(comoISO(resultado)).toEqual([
      '2026-01-29T10:00:00.000Z',
      '2026-02-05T10:00:00.000Z',
      '2026-02-12T10:00:00.000Z',
    ]);
  });

  it('con cantidad 0 devuelve una lista vacía', () => {
    const inicio = fecha('2026-09-29T12:00:00.000Z');
    expect(fechasRecurrentes(inicio, [LUNES], 0)).toEqual([]);
  });
});
