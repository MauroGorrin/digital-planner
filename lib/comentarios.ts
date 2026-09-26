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
 * sin navegador; quien llama hace el document.getElementById. Devuelve false cuando no hay
 * reproductor (por ejemplo, cuando el navegador no pudo reproducir el archivo y la interfaz
 * muestra el aviso de descarga en su lugar en vez del <video>) para que quien llama pueda avisarle
 * al usuario que el salto no ocurrió.
 *
 * Tres cosas que no son obvias:
 * - El <video> puede estar anidado dentro de más de un <details> plegado (una ronda de revisión
 *   contiene un historial de versiones, que es otro <details>): se despliegan todos los
 *   ancestros, no solo el más cercano, porque saltar a un reproductor visible dentro de un
 *   contenedor todavía cerrado no le sirve a nadie.
 * - Asignar currentTime antes de que carguen los metadatos no tiene efecto, asi que en ese caso
 *   se espera a loadedmetadata.
 * - No se llama a play(): mover el reproductor es lo pedido; arrancar el audio sin que nadie lo
 *   pida es hostil.
 */
export function saltarAlSegundo(video: HTMLVideoElement | null, segundo: number): boolean {
  if (!video) return false;

  let contenedor = video.closest('details');
  while (contenedor) {
    contenedor.open = true;
    contenedor = contenedor.parentElement?.closest('details') ?? null;
  }

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
  return true;
}

/**
 * El id de DOM que `AttachmentUploader` le pone a cada <video> y que `saltarAlAdjunto` busca.
 * Centralizado aquí para que un cambio en un lado no rompa al otro en silencio: antes eran dos
 * literales `video-${id}` repetidos sin nada que los atara.
 */
export function idDeVideo(attachmentId: string): string {
  return `video-${attachmentId}`;
}

/**
 * Resuelve el <video> de un adjunto por su id de DOM y salta a un segundo. Devuelve el mismo
 * booleano que `saltarAlSegundo`: false cuando ese <video> no está en el documento (el navegador
 * no pudo reproducirlo y la interfaz muestra el aviso de descarga en su lugar).
 */
export function saltarAlAdjunto(attachmentId: string, segundo: number): boolean {
  const video = document.getElementById(idDeVideo(attachmentId));
  return saltarAlSegundo(video as HTMLVideoElement | null, segundo);
}
