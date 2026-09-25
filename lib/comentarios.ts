import type { Attachment } from '@/types/database';

/**
 * Segundos a texto de reproductor: 0:12, 1:05, y 1:05:03 cuando pasa de la hora.
 * Trunca decimales porque currentTime del navegador es fraccionario.
 */
export function formatearSegundos(total: number): string {
  const enteros = Math.max(0, Math.floor(total));
  const horas = Math.floor(enteros / 3600);
  const minutos = Math.floor((enteros % 3600) / 60);
  const segundos = enteros % 60;
  const dosDigitos = (n: number) => String(n).padStart(2, '0');

  return horas > 0
    ? `${horas}:${dosDigitos(minutos)}:${dosDigitos(segundos)}`
    : `${minutos}:${dosDigitos(segundos)}`;
}

/**
 * Un adjunto esta reemplazado cuando otro lo declara en su replaces_id. Se deriva de los datos
 * que ya hay en vez de guardar un segundo estado que pueda desincronizarse — el mismo criterio
 * que usa agruparPorRonda para decidir cual es el vigente.
 */
export function estaReemplazado(attachmentId: string, attachments: Attachment[]): boolean {
  return attachments.some((a) => a.replaces_id === attachmentId);
}
