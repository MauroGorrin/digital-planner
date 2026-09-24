import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { es } from 'date-fns/locale';

export function formatTimeInTz(isoDate: string, timeZone: string) {
  return formatInTimeZone(new Date(isoDate), timeZone, 'HH:mm', { locale: es });
}

export function formatDateTimeInTz(isoDate: string, timeZone: string) {
  return formatInTimeZone(new Date(isoDate), timeZone, "d MMM yyyy 'a las' HH:mm", { locale: es });
}

/** Combina una fecha (yyyy-MM-dd) del calendario con la hora original de un ISO string, en una zona horaria dada. */
export function combineDateKeepTime(originalIso: string, newDateStr: string, timeZone: string) {
  const time = formatInTimeZone(new Date(originalIso), timeZone, 'HH:mm:ss');
  return fromZonedTime(`${newDateStr}T${time}`, timeZone).toISOString();
}
