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

/**
 * La parte del cliente de Supabase que esta función usa. Se declara acá, en vez de depender
 * del tipo completo del SDK, para poder pasarle un doble en las pruebas.
 */
export interface ClienteAdjuntos {
  from(tabla: string): {
    // PromiseLike, no Promise: el builder de postgrest-js implementa PromiseLike y no tiene
    // catch ni finally, asi que declarar Promise aca haria que el cliente real de Supabase
    // no sea asignable a este tipo y el typecheck falle. Verificado contra postgrest-js
    // instalado. PromiseLike acepta tanto el builder real como el doble de las pruebas.
    insert(fila: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
  };
  storage: {
    from(bucket: string): {
      remove(rutas: string[]): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

export interface OpcionesRegistro {
  supabase: ClienteAdjuntos;
  contentPieceId: string;
  filePath: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedBy: string | null;
  replacesId?: string | null;
}

/**
 * Registra en la base un archivo ya subido al bucket. Si el insert falla, borra el objeto
 * para no dejar un huérfano en storage. Nunca envía review_round: lo asigna el trigger.
 */
export async function registrarAdjunto(opciones: OpcionesRegistro): Promise<void> {
  const { supabase, filePath } = opciones;

  const { error } = await supabase.from('attachments').insert({
    content_piece_id: opciones.contentPieceId,
    file_path: filePath,
    file_name: opciones.fileName,
    file_type: opciones.fileType,
    file_size: opciones.fileSize,
    uploaded_by: opciones.uploadedBy,
    replaces_id: opciones.replacesId ?? null,
  });

  if (error) {
    await supabase.storage.from('attachments').remove([filePath]);
    throw new Error(`No se pudo registrar el archivo: ${error.message}`);
  }
}
