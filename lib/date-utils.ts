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
