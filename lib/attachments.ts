import type { Attachment } from '@/types/database';

/** Igual al file_size_limit del bucket en 0003_attachment_versions.sql. */
export const TAMANO_MAXIMO_BYTES = 209_715_200;

/** Igual al allowed_mime_types del bucket en 0003_attachment_versions.sql. */
export const TIPOS_PERMITIDOS = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'application/pdf',
] as const;

export function formatearBytes(bytes: number): string {
  const unidades = ['B', 'KB', 'MB', 'GB'];
  let valor = bytes;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i++;
  }
  return `${valor.toFixed(1)} ${unidades[i]}`;
}

/** Devuelve null si el archivo es aceptable, o el mensaje a mostrar si no lo es. */
export function validarArchivo(file: { name: string; type: string; size: number }): string | null {
  if (!TIPOS_PERMITIDOS.includes(file.type as (typeof TIPOS_PERMITIDOS)[number])) {
    return `"${file.name}" es de un tipo no permitido (${file.type || 'desconocido'}). Se aceptan imágenes, video MP4, MOV o WebM, y PDF.`;
  }
  if (file.size > TAMANO_MAXIMO_BYTES) {
    return `"${file.name}" pesa ${formatearBytes(file.size)} y el máximo es ${formatearBytes(TAMANO_MAXIMO_BYTES)}.`;
  }
  return null;
}

export interface AdjuntoConHistorial {
  vigente: Attachment;
  /** Versiones anteriores, de la más reciente a la más antigua. */
  reemplazados: Attachment[];
}

export interface RondaDeRevision {
  ronda: number;
  adjuntos: AdjuntoConHistorial[];
}

/**
 * Agrupa los adjuntos por ronda de revisión, de la más reciente a la más vieja.
 * Un adjunto es vigente si ningún otro lo reemplaza; no se persiste ese estado
 * porque un segundo estado guardado se desincroniza.
 */
export function agruparPorRonda(attachments: Attachment[]): RondaDeRevision[] {
  const reemplazadoPor = new Map<string, Attachment>();
  for (const a of attachments) {
    if (a.replaces_id) reemplazadoPor.set(a.replaces_id, a);
  }

  const porId = new Map(attachments.map((a) => [a.id, a]));
  const vigentes = attachments.filter((a) => !reemplazadoPor.has(a.id));

  const rondas = new Map<number, AdjuntoConHistorial[]>();
  for (const vigente of vigentes) {
    const reemplazados: Attachment[] = [];
    const vistos = new Set<string>([vigente.id]);
    let cursor = vigente.replaces_id;
    while (cursor && !vistos.has(cursor)) {
      const anterior = porId.get(cursor);
      if (!anterior) break;
      reemplazados.push(anterior);
      vistos.add(anterior.id);
      cursor = anterior.replaces_id;
    }
    const lista = rondas.get(vigente.review_round) ?? [];
    lista.push({ vigente, reemplazados });
    rondas.set(vigente.review_round, lista);
  }

  return [...rondas.entries()]
    .map(([ronda, adjuntos]) => ({ ronda, adjuntos }))
    .sort((a, b) => b.ronda - a.ronda);
}
