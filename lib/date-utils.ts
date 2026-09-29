import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  format,
} from 'date-fns';
import { es } from 'date-fns/locale';

export function getMonthGridRange(date: Date) {
  const start = startOfWeek(startOfMonth(date), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(date), { weekStartsOn: 1 });
  return { start, end };
}

export function getWeekRange(date: Date) {
  const start = startOfWeek(date, { weekStartsOn: 1 });
  const end = endOfWeek(date, { weekStartsOn: 1 });
  return { start, end };
}

export function getDaysBetween(start: Date, end: Date) {
  const days: Date[] = [];
  let current = start;
  while (current <= end) {
    days.push(current);
    current = addDays(current, 1);
  }
  return days;
}

export function formatDayLabel(date: Date) {
  return format(date, 'd', { locale: es });
}

export function formatMonthTitle(date: Date) {
  const label = format(date, 'LLLL yyyy', { locale: es });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatWeekTitle(start: Date, end: Date) {
  const s = format(start, 'd MMM', { locale: es });
  const e = format(end, 'd MMM yyyy', { locale: es });
  return `${s} – ${e}`;
}

export function isSameDayStr(a: Date, b: Date) {
  return format(a, 'yyyy-MM-dd') === format(b, 'yyyy-MM-dd');
}

/**
 * Convierte una fecha a la forma que espera un `<input type="datetime-local">`:
 * "AAAA-MM-DDTHH:mm", en la hora LOCAL del navegador (no UTC, que es lo que traen los ISO que
 * vienen de la base). Sin argumento, devuelve el valor para "ahora".
 *
 * Vivía duplicada con el mismo cuerpo en dos componentes -- `toLocalInputValue` en
 * `ContentPieceForm.tsx` y `ahoraLocal` en `ContentPiecesMultipleForm.tsx` -- se unifica aquí
 * porque las dos hacían exactamente lo mismo.
 */
export function fechaParaInputLocal(fecha: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())}T${pad(fecha.getHours())}:${pad(fecha.getMinutes())}`;
}
