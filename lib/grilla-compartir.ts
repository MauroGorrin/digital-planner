import crypto from 'crypto';
import { compartirReportesHabilitado } from '@/lib/reportes';

// Link compartible de la grilla (/grilla/[clientId]/[anio]/[mes]). Usa el mismo secreto que los
// reportes (REPORT_LINK_SECRET), pero lo firmado lleva el prefijo `grilla:`: una firma de reporte
// nunca sirve como firma de grilla, aunque la clave sea la misma.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AccesoAGrilla {
  clientId: string;
  anio: number;
  mes: number;
}

function secretoRequerido(): string {
  const secreto = process.env.REPORT_LINK_SECRET;
  if (!secreto) throw new Error('Falta configurar REPORT_LINK_SECRET.');
  return secreto;
}

export function firmaDeGrilla(clientId: string, anio: number, mes: number): string {
  return crypto.createHmac('sha256', secretoRequerido()).update(`grilla:${clientId}:${anio}:${mes}`).digest('hex');
}

/** Igual que `firmaEsValida` de lib/reportes.ts: comparación en tiempo constante, sin lanzar. */
export function firmaDeGrillaEsValida(
  clientId: string,
  anio: number,
  mes: number,
  firma: string | null | undefined
): boolean {
  if (!firma || !compartirReportesHabilitado()) return false;
  const esperada = Buffer.from(firmaDeGrilla(clientId, anio, mes), 'hex');
  const recibida = Buffer.from(firma, 'hex');
  if (esperada.length !== recibida.length) return false;
  return crypto.timingSafeEqual(esperada, recibida);
}

/** Valida los parámetros crudos de la ruta pública y la firma. Devuelve null ante cualquier fallo. */
export function verificarAccesoAGrilla(
  clientId: string,
  anio: string,
  mes: string,
  firma: string | null | undefined
): AccesoAGrilla | null {
  if (!UUID.test(clientId)) return null;
  if (!/^\d{4}$/.test(anio) || !/^\d{1,2}$/.test(mes)) return null;
  const anioNumero = Number(anio);
  const mesNumero = Number(mes);
  if (mesNumero < 1 || mesNumero > 12) return null;
  if (!firmaDeGrillaEsValida(clientId, anioNumero, mesNumero, firma)) return null;
  return { clientId, anio: anioNumero, mes: mesNumero };
}

export function urlDeLaGrilla(baseUrl: string, clientId: string, anio: number, mes: number): string {
  return `${baseUrl}/grilla/${clientId}/${anio}/${mes}?firma=${firmaDeGrilla(clientId, anio, mes)}`;
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
