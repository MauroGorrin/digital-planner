import crypto from 'crypto';
import { compartirReportesHabilitado } from '@/lib/reportes';

// Link compartible de la grilla (/grilla/[slug]/[anio]/[mes]). Usa el mismo secreto que los
// reportes (REPORT_LINK_SECRET), pero lo firmado lleva el prefijo `grilla:`: una firma de reporte
// nunca sirve como firma de grilla, aunque la clave sea la misma. Se firma el slug, no el ID: el
// slug es el que aparece en la URL y no cambia nunca (migración 0015), así que el enlace no se
// rompe si la marca se renombra.

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface AccesoAGrilla {
  slug: string;
  anio: number;
  mes: number;
}

function secretoRequerido(): string {
  const secreto = process.env.REPORT_LINK_SECRET;
  if (!secreto) throw new Error('Falta configurar REPORT_LINK_SECRET.');
  return secreto;
}

export function firmaDeGrilla(slug: string, anio: number, mes: number): string {
  return crypto.createHmac('sha256', secretoRequerido()).update(`grilla:${slug}:${anio}:${mes}`).digest('hex');
}

/** Igual que `firmaEsValida` de lib/reportes.ts: comparación en tiempo constante, sin lanzar. */
export function firmaDeGrillaEsValida(
  slug: string,
  anio: number,
  mes: number,
  firma: string | null | undefined
): boolean {
  if (!firma || !compartirReportesHabilitado()) return false;
  const esperada = Buffer.from(firmaDeGrilla(slug, anio, mes), 'hex');
  const recibida = Buffer.from(firma, 'hex');
  if (esperada.length !== recibida.length) return false;
  return crypto.timingSafeEqual(esperada, recibida);
}

/** Valida los parámetros crudos de la ruta pública y la firma. Devuelve null ante cualquier fallo. */
export function verificarAccesoAGrilla(
  slug: string,
  anio: string,
  mes: string,
  firma: string | null | undefined
): AccesoAGrilla | null {
  if (!SLUG.test(slug)) return null;
  if (!/^\d{4}$/.test(anio) || !/^\d{1,2}$/.test(mes)) return null;
  const anioNumero = Number(anio);
  const mesNumero = Number(mes);
  if (mesNumero < 1 || mesNumero > 12) return null;
  if (!firmaDeGrillaEsValida(slug, anioNumero, mesNumero, firma)) return null;
  return { slug, anio: anioNumero, mes: mesNumero };
}

export function urlDeLaGrilla(baseUrl: string, slug: string, anio: number, mes: number): string {
  return `${baseUrl}/grilla/${slug}/${anio}/${mes}?firma=${firmaDeGrilla(slug, anio, mes)}`;
}

/** Año y mes de una pieza, leídos en la zona horaria de la marca (no en la del servidor). */
export function mesDePieza(iso: string, timeZone: string): { anio: number; mes: number } {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric' }).formatToParts(
    new Date(iso)
  );
  return {
    anio: Number(partes.find((p) => p.type === 'year')?.value),
    mes: Number(partes.find((p) => p.type === 'month')?.value),
  };
}

/** "octubre de 2026" */
export function tituloDelMes(anio: number, mes: number): string {
  return new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(anio, mes - 1, 1))
  );
}
