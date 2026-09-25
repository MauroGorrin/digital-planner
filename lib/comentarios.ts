import type { Attachment } from '@/types/database';

/**
 * Segundos a texto de reproductor: 0:12, 1:05, y 1:05:03 cuando pasa de la hora.
 * Trunca decimales porque currentTime del navegador es fraccionario.
 */
export function formatearSegundos(total: number): string {
  const enteros = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
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

/**
 * Lleva un reproductor a un segundo concreto. Recibe el elemento ya resuelto para poder probarse
 * sin navegador; quien llama hace el document.getElementById.
 *
 * Tres cosas que no son obvias:
 * - Si el <video> esta dentro de un <details> plegado (el historial de versiones), se despliega
 *   antes: saltar a un reproductor invisible no le sirve a nadie.
 * - Asignar currentTime antes de que carguen los metadatos no tiene efecto, asi que en ese caso
 *   se espera a loadedmetadata.
 * - No se llama a play(): mover el reproductor es lo pedido; arrancar el audio sin que nadie lo
 *   pida es hostil.
 */
export function saltarAlSegundo(video: HTMLVideoElement | null, segundo: number): void {
  if (!video) return;

  const contenedor = video.closest('details');
  if (contenedor) (contenedor as HTMLDetailsElement).open = true;

  if (video.readyState >= 1) {
    video.currentTime = segundo;
  } else {
    video.addEventListener(
      'loadedmetadata',
      () => {
        video.currentTime = segundo;
      },
      { once: true }
    );
  }

  video.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
