import type { Attachment } from '@/types/database';

/**
 * Igual al file_size_limit del bucket en 0003_attachment_versions.sql.
 *
 * 52428800 bytes = 50 MiB = 50 MB (convención de Supabase), no una cifra elegida por el
 * producto: es el tope del *Global file size limit* del plan gratuito de Supabase, que no se
 * puede subir desde el panel sin cambiar de plan, y que manda sobre el file_size_limit del
 * bucket (Supabase aplica el mínimo de los dos). Si algún día se mejora el plan y se sube el
 * límite global, este valor también debe subir — junto con el de la migración y el de
 * supabase/config.toml — para que los tres sigan de acuerdo.
 */
export const TAMANO_MAXIMO_BYTES = 52_428_800;

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
    // Bandera explícita, no el string del mensaje: un error con message: '' es igual de "hubo
    // fallo" que uno con texto, y si se usara el string como bandera (truthy/falsy) ese caso
    // caería al mensaje de éxito para un archivo que en realidad quedó huérfano — justo lo que
    // esta rama existe para evitar.
    let limpiezaFallo = false;
    let motivoDeLimpieza = '';
    try {
      const { error: errorDeLimpieza } = await supabase.storage.from('attachments').remove([filePath]);
      if (errorDeLimpieza) {
        limpiezaFallo = true;
        motivoDeLimpieza = errorDeLimpieza.message;
      }
    } catch (excepcion) {
      limpiezaFallo = true;
      motivoDeLimpieza = excepcion instanceof Error ? excepcion.message : String(excepcion);
    }

    if (limpiezaFallo) {
      throw new Error(
        `No se pudo registrar el archivo (${error.message}) y tampoco se pudo limpiar el archivo ya subido (${motivoDeLimpieza}). Quedó en el almacenamiento como ${filePath}.`
      );
    }
    throw new Error(`No se pudo registrar el archivo: ${error.message}`);
  }
}

/**
 * Tiempo sin un solo evento de progreso a partir del cual se considera que la transferencia
 * se estancó (socket abierto pero sin datos fluyendo). Es un tope de INACTIVIDAD, no de
 * duración total: se reinicia con cada evento de progreso, así que una subida grande y lenta
 * pero viva nunca lo dispara. Un `xhr.timeout` fijo mataría esas subidas legítimas (un video
 * de 200 MB a 1 Mbps tarda ~27 min), que es justo el caso que esta función existe para
 * soportar — por eso no se usa acá.
 */
const UMBRAL_ESTANCAMIENTO_MS = 60_000;

/**
 * Tope de espera de la RESPUESTA del servidor una vez que el cuerpo ya se envió completo
 * (`xhr.upload`'s `load`). Es otra magnitud que UMBRAL_ESTANCAMIENTO_MS: ese mide inactividad
 * DURANTE la transferencia y se reinicia con cada byte que llega; este mide cuánto se espera la
 * confirmación con el cuerpo ya entregado, un tramo donde no va a haber más eventos de progreso
 * que reinicien nada. Sin este tope, un servidor que acepte el cuerpo y después no responda ni
 * cierre el socket deja la promesa colgada para siempre — el mismo cuelgue que el vigilante de
 * estancamiento existe para evitar, solo que en la otra punta de la subida.
 */
const UMBRAL_ESPERA_RESPUESTA_MS = 300_000;

/**
 * Sube un archivo a una URL firmada con XMLHttpRequest, que es la única forma de obtener
 * progreso real: el upload() del SDK usa fetch, que no emite eventos de progreso.
 */
export function subirConProgreso(opciones: {
  signedUrl: string;
  file: File;
  onProgress: (porcentaje: number) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', opciones.signedUrl);
    xhr.setRequestHeader('content-type', opciones.file.type);

    // Vigilante de estancamiento: si pasa UMBRAL_ESTANCAMIENTO_MS sin un solo evento de
    // progreso, abortamos nosotros mismos en vez de dejar la promesa colgada para siempre.
    let estancada = false;
    // Espera de respuesta: si pasa UMBRAL_ESPERA_RESPUESTA_MS después de que el cuerpo ya se
    // envió por completo sin que llegue la respuesta del servidor, abortamos también acá.
    let sinRespuesta = false;
    let temporizadorDeEstancamiento: ReturnType<typeof setTimeout>;
    let temporizadorDeEsperaDeRespuesta: ReturnType<typeof setTimeout>;

    function limpiarVigilante() {
      clearTimeout(temporizadorDeEstancamiento);
    }

    function limpiarEsperaDeRespuesta() {
      clearTimeout(temporizadorDeEsperaDeRespuesta);
    }

    function reiniciarVigilante() {
      clearTimeout(temporizadorDeEstancamiento);
      temporizadorDeEstancamiento = setTimeout(() => {
        estancada = true;
        xhr.abort();
      }, UMBRAL_ESTANCAMIENTO_MS);
    }

    function armarEsperaDeRespuesta() {
      temporizadorDeEsperaDeRespuesta = setTimeout(() => {
        sinRespuesta = true;
        xhr.abort();
      }, UMBRAL_ESPERA_RESPUESTA_MS);
    }

    reiniciarVigilante();

    xhr.upload.addEventListener('progress', (evento) => {
      reiniciarVigilante();
      if (evento.lengthComputable) {
        opciones.onProgress(Math.round((evento.loaded / evento.total) * 100));
      }
    });

    // xhr.upload 'load' se dispara cuando el cuerpo terminó de enviarse, antes de la respuesta
    // del servidor. A partir de ahí no va a haber más eventos de progreso mientras el servidor
    // finaliza el objeto (puede tardar, con 200 MB), y el vigilante de estancamiento —que solo
    // se reinicia con progreso— daría un falso positivo justo cuando la subida en realidad ya
    // terminó bien. Lo desarmamos acá, pero no dejamos la espera de la respuesta sin ningún
    // tope: armamos el temporizador de espera de respuesta, que sí puede abortar si el servidor
    // nunca contesta ni cierra el socket.
    xhr.upload.addEventListener('load', () => {
      limpiarVigilante();
      armarEsperaDeRespuesta();
    });

    xhr.addEventListener('load', () => {
      limpiarVigilante();
      limpiarEsperaDeRespuesta();
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`La subida falló (HTTP ${xhr.status}). Vuelve a intentarlo.`));
    });
    xhr.addEventListener('error', () => {
      limpiarVigilante();
      limpiarEsperaDeRespuesta();
      reject(new Error('Se cortó la conexión durante la subida. Vuelve a intentarlo.'));
    });
    xhr.addEventListener('abort', () => {
      limpiarVigilante();
      limpiarEsperaDeRespuesta();
      if (estancada) {
        reject(
          new Error(
            'La subida se estancó: no hubo avance durante más de un minuto. Revisa tu conexión y vuelve a intentarlo.'
          )
        );
      } else if (sinRespuesta) {
        reject(
          new Error(
            'El archivo se envió por completo, pero el servidor no confirmó la subida a tiempo. Puede que haya quedado registrado: revisa antes de volver a intentarlo.'
          )
        );
      } else {
        reject(new Error('Subida cancelada.'));
      }
    });

    xhr.send(opciones.file);
  });
}

/**
 * El cliente que necesita subirArchivoAPieza: lo de ClienteAdjuntos mas la firma de la URL de
 * subida. Se declara aparte en vez de importar el SupabaseClient real para que lib/attachments.ts
 * siga sin depender de lib/supabase/client.ts, que lleva 'use client'.
 *
 * PromiseLike y no Promise, por lo mismo que ClienteAdjuntos: ver el comentario de arriba.
 */
export interface ClienteSubida extends ClienteAdjuntos {
  storage: {
    from(bucket: string): {
      createSignedUploadUrl(ruta: string): PromiseLike<{
        data: { signedUrl: string } | null;
        error: { message: string } | null;
      }>;
      remove(rutas: string[]): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

/**
 * Sube un archivo a una pieza y lo registra: firma la URL, transfiere con progreso real, e
 * inserta la fila (con la compensacion del huerfano que trae registrarAdjunto).
 *
 * Vive aca y no en el componente porque hay dos lugares que suben un archivo a una pieza -- la
 * ficha y el formulario de creacion -- y el bloque completo (ruta, firma, transferencia,
 * registro) tiene que ser identico en los dos. Duplicarlo es como se desincronizan.
 *
 * La ruta incluye Date.now() porque dos archivos con el mismo nombre en la misma pieza son
 * legitimos: la segunda version de un reel suele llamarse igual que la primera.
 */
export async function subirArchivoAPieza(opciones: {
  supabase: ClienteSubida;
  clientId: string;
  contentPieceId: string;
  file: File;
  uploadedBy: string | null;
  replacesId?: string | null;
  onProgress: (porcentaje: number) => void;
}): Promise<void> {
  const path = `${opciones.clientId}/${opciones.contentPieceId}/${Date.now()}_${opciones.file.name.replace(
    /[^\w.\-]/g,
    '_'
  )}`;

  const { data: firmada, error: errorFirma } = await opciones.supabase.storage
    .from('attachments')
    .createSignedUploadUrl(path);
  if (errorFirma || !firmada) {
    throw new Error(errorFirma?.message ?? 'No se pudo preparar la subida.');
  }

  await subirConProgreso({
    signedUrl: firmada.signedUrl,
    file: opciones.file,
    onProgress: opciones.onProgress,
  });

  await registrarAdjunto({
    supabase: opciones.supabase,
    contentPieceId: opciones.contentPieceId,
    filePath: path,
    fileName: opciones.file.name,
    fileType: opciones.file.type,
    fileSize: opciones.file.size,
    uploadedBy: opciones.uploadedBy,
    replacesId: opciones.replacesId,
  });
}

/**
 * El adjunto que representa a la pieza en una vista compacta -- hoy, la tarjeta del calendario.
 *
 * Es el vigente (ninguno lo reemplaza) de la ronda mas alta: el corte que se esta revisando
 * ahora, no el primero que se subio. Dentro de una misma ronda gana el mas reciente.
 *
 * Deriva de replaces_id y review_round en vez de guardar una marca de "portada", por lo mismo
 * que agruparPorRonda: un segundo estado guardado se desincroniza del primero.
 *
 * Devuelve null si no hay adjuntos, y tambien si todos estan reemplazados -- que solo puede pasar
 * con una cadena ciclica, imposible desde la interfaz pero no desde la base.
 */
export function adjuntoDePortada(attachments: Attachment[]): Attachment | null {
  const reemplazados = new Set(
    attachments.map((a) => a.replaces_id).filter((id): id is string => id !== null)
  );
  const vigentes = attachments.filter((a) => !reemplazados.has(a.id));
  if (vigentes.length === 0) return null;

  return vigentes.reduce((mejor, actual) => {
    if (actual.review_round !== mejor.review_round) {
      return actual.review_round > mejor.review_round ? actual : mejor;
    }
    // created_at es ISO 8601 en UTC, asi que comparar como texto ordena igual que como fecha.
    return actual.created_at > mejor.created_at ? actual : mejor;
  });
}
