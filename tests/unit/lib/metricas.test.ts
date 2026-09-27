import { describe, expect, it } from 'vitest';

import { agregarMetricas, limitesDelMes, mesActualEn } from '@/lib/metricas';

describe('limitesDelMes', () => {
  it('una pieza a las 23:00 del último día de enero cae en enero y no en febrero, en Ciudad de México', () => {
    const MX = 'America/Mexico_City';
    // 2026-01-31T23:00:00 hora de Ciudad de México, verificado con date-fns-tz 3.2:
    // fromZonedTime('2026-01-31T23:00:00', 'America/Mexico_City') === '2026-02-01T05:00:00.000Z'.
    const pieza = new Date('2026-02-01T05:00:00.000Z');

    const limitesEnero = limitesDelMes(2026, 1, MX);
    const limitesFebrero = limitesDelMes(2026, 2, MX);

    // El inicio de febrero en esa zona, verificado: '2026-02-01T06:00:00.000Z'. El fin
    // exclusivo de enero tiene que ser exactamente ese mismo instante.
    expect(limitesFebrero.inicio).toBe('2026-02-01T06:00:00.000Z');
    expect(limitesEnero.finExclusivo).toBe('2026-02-01T06:00:00.000Z');

    const dentroDeEnero =
      pieza >= new Date(limitesEnero.inicio) && pieza < new Date(limitesEnero.finExclusivo);
    const dentroDeFebrero =
      pieza >= new Date(limitesFebrero.inicio) && pieza < new Date(limitesFebrero.finExclusivo);

    expect(dentroDeEnero).toBe(true);
    expect(dentroDeFebrero).toBe(false);
  });

  it('calcula marzo 2026 en Europe/Madrid, que cruza un cambio de horario de verano (743 h)', () => {
    const limites = limitesDelMes(2026, 3, 'Europe/Madrid');

    expect(limites.inicio).toBe('2026-02-28T23:00:00.000Z');
    expect(limites.finExclusivo).toBe('2026-03-31T22:00:00.000Z');

    const horas = (new Date(limites.finExclusivo).getTime() - new Date(limites.inicio).getTime()) / 36e5;
    expect(horas).toBe(743);
  });

  it('calcula octubre 2026 en Europe/Madrid, que gana una hora ese mes (745 h)', () => {
    const limites = limitesDelMes(2026, 10, 'Europe/Madrid');

    expect(limites.inicio).toBe('2026-09-30T22:00:00.000Z');
    expect(limites.finExclusivo).toBe('2026-10-31T23:00:00.000Z');

    const horas = (new Date(limites.finExclusivo).getTime() - new Date(limites.inicio).getTime()) / 36e5;
    expect(horas).toBe(745);
  });

  it('calcula septiembre 2026 en America/Santiago, que pierde una hora ese mes (719 h)', () => {
    const limites = limitesDelMes(2026, 9, 'America/Santiago');

    expect(limites.inicio).toBe('2026-09-01T04:00:00.000Z');
    expect(limites.finExclusivo).toBe('2026-10-01T03:00:00.000Z');

    const horas = (new Date(limites.finExclusivo).getTime() - new Date(limites.inicio).getTime()) / 36e5;
    expect(horas).toBe(719);
  });

  it('diciembre: el fin exclusivo cae en enero del año siguiente, no en un mes 13', () => {
    const MX = 'America/Mexico_City';

    const limitesDiciembre = limitesDelMes(2026, 12, MX);
    const limitesEneroSiguiente = limitesDelMes(2027, 1, MX);

    // America/Mexico_City no observa horario de verano desde 2022 y mantiene offset fijo
    // UTC-6 (confirmado por los dos instantes ya verificados del borde de las 23:00 y el
    // inicio de febrero, ambos con ese mismo offset). Con ese offset constante, la
    // medianoche del 1 de enero de 2027 en esa zona es 2027-01-01T06:00:00.000Z.
    expect(limitesDiciembre.finExclusivo).toBe('2027-01-01T06:00:00.000Z');
    // Y coincide exactamente con el inicio de enero de 2027, calculado por separado: el mes
    // no se "salta" al 2026 ni queda en un mes 13 inexistente.
    expect(limitesDiciembre.finExclusivo).toBe(limitesEneroSiguiente.inicio);
  });
});

describe('agregarMetricas', () => {
  it('una pieza cancelada no cuenta ni como planificada ni como entregada', () => {
    const filas = agregarMetricas(
      [
        { format: 'post', status: 'cancelado' },
        { format: 'post', status: 'aprobado' },
      ],
      [{ format: 'post', monthly_quota: 10 }],
    );

    expect(filas).toEqual([{ format: 'post', contratado: 10, planificado: 1, entregado: 0 }]);
  });

  it('una pieza publicada cuenta en planificado y en entregado a la vez', () => {
    const filas = agregarMetricas(
      [{ format: 'reel', status: 'publicado' }],
      [{ format: 'reel', monthly_quota: 8 }],
    );

    expect(filas).toEqual([{ format: 'reel', contratado: 8, planificado: 1, entregado: 1 }]);
  });

  it('un formato contratado sin nada entregado todavia sale con entregado en 0, no se omite', () => {
    const filas = agregarMetricas([], [{ format: 'historia', monthly_quota: 30 }]);

    expect(filas).toEqual([{ format: 'historia', contratado: 30, planificado: 0, entregado: 0 }]);
  });

  it('un formato entregado sin estar en el paquete sale como no contratado, despues de los contratados', () => {
    const filas = agregarMetricas(
      [
        { format: 'post', status: 'publicado' },
        { format: 'video', status: 'publicado' },
      ],
      [{ format: 'post', monthly_quota: 12 }],
    );

    expect(filas).toEqual([
      { format: 'post', contratado: 12, planificado: 1, entregado: 1 },
      { format: 'video', contratado: null, planificado: 1, entregado: 1 },
    ]);
  });

  it('un formato ni contratado ni usado no produce fila', () => {
    const filas = agregarMetricas([], [{ format: 'post', monthly_quota: 12 }]);

    expect(filas).toHaveLength(1);
    expect(filas.some((fila) => fila.format === 'carrusel')).toBe(false);
  });

  it('ordena las filas contratadas por el orden del enum content_format, no por el orden del paquete', () => {
    const filas = agregarMetricas(
      [],
      [
        { format: 'video', monthly_quota: 4 },
        { format: 'post', monthly_quota: 12 },
        { format: 'reel', monthly_quota: 8 },
      ],
    );

    expect(filas.map((fila) => fila.format)).toEqual(['post', 'reel', 'video']);
  });

  it('las filas fuera del paquete van despues de todas las contratadas, tambien en orden de enum', () => {
    const filas = agregarMetricas(
      [
        { format: 'otro', status: 'aprobado' },
        { format: 'carrusel', status: 'aprobado' },
      ],
      [{ format: 'reel', monthly_quota: 8 }],
    );

    expect(filas.map((fila) => fila.format)).toEqual(['reel', 'carrusel', 'otro']);
  });
});

describe('mesActualEn', () => {
  it('devuelve el mes de la marca, no el del servidor, en el borde de fin de mes', () => {
    // 1 de febrero 01:00 UTC es todavia el 31 de enero a las 19:00 en Ciudad de Mexico.
    const instante = new Date('2026-02-01T01:00:00.000Z');
    expect(mesActualEn(instante, 'America/Mexico_City')).toEqual({ anio: 2026, mes: 1 });
    // Y en una zona adelantada de UTC, el mismo instante ya es febrero.
    expect(mesActualEn(instante, 'Asia/Tokyo')).toEqual({ anio: 2026, mes: 2 });
  });

  it('cruza el fin de anio hacia atras cuando la zona va detras de UTC', () => {
    // 1 de enero de 2027, 02:00 UTC = 31 de diciembre de 2026, 20:00 en Ciudad de Mexico.
    const instante = new Date('2027-01-01T02:00:00.000Z');
    expect(mesActualEn(instante, 'America/Mexico_City')).toEqual({ anio: 2026, mes: 12 });
  });
});
