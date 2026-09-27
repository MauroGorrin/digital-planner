import { fromZonedTime } from 'date-fns-tz';

import type { ClientPackage, ContentFormat, ContentPiece } from '@/types/database';
import { FORMAT_LABELS } from '@/types/database';

// Orden de las filas contratadas en `agregarMetricas`. Se deriva de FORMAT_LABELS y no se
// escribe a mano: ese Record esta tipado `Record<ContentFormat, string>`, asi que si alguien
// agrega un valor al enum `content_format` sin agregarlo ahi, el typecheck falla. Una lista
// literal seria `ContentFormat[]`, que acepta estar incompleta -- y un formato faltante aqui
// desapareceria de las metricas sin error: una fila contratada que nunca se muestra.
// El orden de claves de FORMAT_LABELS ya coincide con el del enum en 0001_init.sql:11.
const ORDEN_FORMATOS = Object.keys(FORMAT_LABELS) as ContentFormat[];

export interface LimitesDeMes {
  /** Instante UTC (ISO) en que empieza el mes en la zona horaria dada. Inclusive. */
  inicio: string;
  /** Instante UTC (ISO) en que empieza el mes siguiente. Exclusivo: una pieza cuenta si
   *  `scheduled_at < finExclusivo`. */
  finExclusivo: string;
}

/**
 * Calcula, en UTC, los límites de un mes calendario tal como se vive en `timeZone`.
 *
 * `mes` es 1-12 (enero = 1, diciembre = 12) — **no** el índice 0-11 de `Date` de
 * JavaScript. Pasar un mes con ese desfase produce límites de un mes equivocado sin que
 * nada falle: exactamente el tipo de error que este módulo existe para evitar.
 *
 * Si `mes` es 12, `finExclusivo` cae en el 1 de enero del año siguiente (`anio + 1`), no
 * en un inexistente "mes 13".
 *
 * El resultado se usa para filtrar `content_pieces.scheduled_at` con
 * `>= inicio && < finExclusivo`, de modo que una pieza programada a las 23:00 del último
 * día del mes en la zona de la marca quede dentro de ese mes aunque en UTC ya sea el
 * primer día del mes siguiente.
 */
export function limitesDelMes(anio: number, mes: number, timeZone: string): LimitesDeMes {
  const esDiciembre = mes === 12;
  const anioSiguiente = esDiciembre ? anio + 1 : anio;
  const mesSiguiente = esDiciembre ? 1 : mes + 1;

  const inicio = fromZonedTime(fechaLocalMedianoche(anio, mes), timeZone);
  const finExclusivo = fromZonedTime(fechaLocalMedianoche(anioSiguiente, mesSiguiente), timeZone);

  return { inicio: inicio.toISOString(), finExclusivo: finExclusivo.toISOString() };
}

/** Medianoche del día 1 de `mes`/`anio`, como cadena de hora local sin zona (para `fromZonedTime`). */
function fechaLocalMedianoche(anio: number, mes: number): string {
  const mesConCeros = String(mes).padStart(2, '0');
  return `${anio}-${mesConCeros}-01T00:00:00`;
}

export interface FilaDeMetrica {
  format: ContentFormat;
  /** Cuota mensual contratada para este formato, o `null` si el formato no está en el paquete. */
  contratado: number | null;
  /** Piezas de este formato dentro del mes con `status <> 'cancelado'`. Incluye `publicado`. */
  planificado: number;
  /** Piezas de este formato dentro del mes con `status = 'publicado'`. */
  entregado: number;
}

/**
 * Agrega piezas y paquete en filas por formato.
 *
 * Se asume que `piezas` ya viene filtrado al mes y a la marca que interesa (típicamente
 * con `limitesDelMes`); esta función no mira fechas.
 *
 * Orden del resultado: primero los formatos contratados, en el orden del enum
 * `content_format`, cada uno con su `monthly_quota` en `contratado`. Después, en el mismo
 * orden de enum, los formatos que no están en el paquete pero tienen algo planificado o
 * entregado, con `contratado: null` — piezas "fuera del paquete". Un formato que ni está
 * contratado ni tiene piezas no produce fila.
 *
 * Una pieza `cancelado` no cuenta en absoluto (ni planificada ni entregada). Una pieza
 * `publicado` cuenta en ambos: planificado y entregado.
 */
export function agregarMetricas(
  piezas: Pick<ContentPiece, 'format' | 'status'>[],
  paquete: Pick<ClientPackage, 'format' | 'monthly_quota'>[],
): FilaDeMetrica[] {
  const conteos = new Map<ContentFormat, { planificado: number; entregado: number }>();

  for (const pieza of piezas) {
    if (pieza.status === 'cancelado') continue;

    const conteo = conteos.get(pieza.format) ?? { planificado: 0, entregado: 0 };
    conteo.planificado += 1;
    if (pieza.status === 'publicado') {
      conteo.entregado += 1;
    }
    conteos.set(pieza.format, conteo);
  }

  const cuotas = new Map(paquete.map((fila) => [fila.format, fila.monthly_quota]));

  const filas: FilaDeMetrica[] = [];

  for (const format of ORDEN_FORMATOS) {
    const cuota = cuotas.get(format);
    if (cuota === undefined) continue;

    const conteo = conteos.get(format) ?? { planificado: 0, entregado: 0 };
    filas.push({ format, contratado: cuota, planificado: conteo.planificado, entregado: conteo.entregado });
  }

  for (const format of ORDEN_FORMATOS) {
    if (cuotas.has(format)) continue;

    const conteo = conteos.get(format);
    if (!conteo || (conteo.planificado === 0 && conteo.entregado === 0)) continue;

    filas.push({ format, contratado: null, planificado: conteo.planificado, entregado: conteo.entregado });
  }

  return filas;
}
