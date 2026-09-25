'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { deleteAttachment } from '@/app/actions';
import { agruparPorRonda, formatearBytes, registrarAdjunto, subirConProgreso, validarArchivo } from '@/lib/attachments';
import type { Attachment, Client, ContentPiece } from '@/types/database';

interface ProgresoDeArchivo {
  nombre: string;
  porcentaje: number;
}

function FilaAdjunto({
  adjunto,
  url,
  canManage,
  onEliminar,
  onSubirVersion,
  subiendoVersion,
}: {
  adjunto: Attachment;
  url: string | undefined;
  canManage: boolean;
  onEliminar: (id: string) => void;
  onSubirVersion?: (files: FileList | null, replacesId: string) => void;
  subiendoVersion?: boolean;
}) {
  const inputVersionRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-start justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="min-w-0 flex-1">
        <a href={url} target="_blank" rel="noreferrer">
          <p className="truncate text-sm font-medium text-brand-700">{adjunto.file_name}</p>
          <p className="text-xs text-slate-400">{formatearBytes(adjunto.file_size ?? 0)}</p>

          {adjunto.file_type?.startsWith('image/') && url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={adjunto.file_name} className="mt-1 h-20 rounded-md object-cover" />
          )}
        </a>

        {adjunto.file_type?.startsWith('video/') && url && (
          <video
            controls
            preload="metadata"
            className="mt-1 max-h-64 w-full rounded-md bg-black"
            onError={(e) => e.currentTarget.classList.add('hidden')}
          >
            <source src={url} type={adjunto.file_type} />
            Tu navegador no puede reproducir este archivo. Descárgalo para verlo.
          </video>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {onSubirVersion && (
          <>
            <input
              ref={inputVersionRef}
              type="file"
              className="hidden"
              onChange={(e) => onSubirVersion(e.target.files, adjunto.id)}
              disabled={subiendoVersion}
            />
            <button
              type="button"
              onClick={() => inputVersionRef.current?.click()}
              aria-label={`Subir nueva versión de ${adjunto.file_name}`}
              disabled={subiendoVersion}
              className="text-xs text-brand-700 hover:underline"
            >
              Subir nueva versión
            </button>
          </>
        )}

        {canManage && (
          <button
            onClick={() => onEliminar(adjunto.id)}
            className="text-xs text-red-500 hover:underline"
          >
            Eliminar
          </button>
        )}
      </div>
    </div>
  );
}

export function AttachmentUploader({
  piece,
  attachments,
  urls,
  canManage,
}: {
  piece: ContentPiece & { clients: Client };
  attachments: Attachment[];
  urls: Record<string, string>;
  canManage: boolean;
}) {
  const supabase = createClient();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progreso, setProgreso] = useState<ProgresoDeArchivo | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(files: FileList | null, replacesId: string | null = null) {
    if (!files || files.length === 0) return;
    setError(null);

    const seleccionados = Array.from(files);
    for (const file of seleccionados) {
      const problema = validarArchivo(file);
      if (problema) {
        setError(problema);
        if (inputRef.current) inputRef.current.value = '';
        return;
      }
    }

    try {
      // De a uno: varios videos en paralelo se estorban y ninguno termina.
      for (const file of seleccionados) {
        setProgreso({ nombre: file.name, porcentaje: 0 });

        const path = `${piece.client_id}/${piece.id}/${Date.now()}_${file.name.replace(/[^\w.\-]/g, '_')}`;

        const { data: firmada, error: errorFirma } = await supabase.storage
          .from('attachments')
          .createSignedUploadUrl(path);
        if (errorFirma || !firmada) {
          throw new Error(errorFirma?.message ?? 'No se pudo preparar la subida.');
        }

        await subirConProgreso({
          signedUrl: firmada.signedUrl,
          file,
          onProgress: (porcentaje) => setProgreso({ nombre: file.name, porcentaje }),
        });

        const {
          data: { user },
        } = await supabase.auth.getUser();

        await registrarAdjunto({
          supabase,
          contentPieceId: piece.id,
          filePath: path,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          uploadedBy: user?.id ?? null,
          replacesId,
        });
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir el archivo.');
    } finally {
      setProgreso(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function eliminar(id: string) {
    deleteAttachment(id, piece.id).then(() => router.refresh());
  }

  const rondas = agruparPorRonda(attachments);
  const rondaVigente = rondas[0]?.ronda;

  return (
    <div>
      <div className="space-y-2">
        {rondas.length === 0 && <p className="text-sm text-slate-400">Sin adjuntos todavía.</p>}

        {rondas.map((ronda) => (
          <details key={ronda.ronda} open={ronda.ronda === rondaVigente} className="mt-2">
            <summary className="cursor-pointer text-xs font-medium text-slate-500">
              {ronda.ronda === rondaVigente ? 'Versión actual' : `Ronda ${ronda.ronda}`} —{' '}
              {ronda.adjuntos.length} {ronda.adjuntos.length === 1 ? 'archivo' : 'archivos'}
            </summary>

            <div className="mt-2 space-y-2">
              {ronda.adjuntos.map((entrada) => (
                <div key={entrada.vigente.id}>
                  <FilaAdjunto
                    adjunto={entrada.vigente}
                    url={urls[entrada.vigente.id]}
                    canManage={canManage}
                    onEliminar={eliminar}
                    onSubirVersion={canManage ? handleUpload : undefined}
                    subiendoVersion={progreso !== null}
                  />

                  {entrada.reemplazados.length > 0 && (
                    <details className="mt-1 pl-3">
                      <summary className="cursor-pointer text-xs text-slate-400">
                        {entrada.reemplazados.length} versión
                        {entrada.reemplazados.length === 1 ? '' : 'es'} anterior
                        {entrada.reemplazados.length === 1 ? '' : 'es'}
                      </summary>
                      <div className="mt-1 space-y-1 opacity-60">
                        {entrada.reemplazados.map((viejo) => (
                          <FilaAdjunto
                            key={viejo.id}
                            adjunto={viejo}
                            url={urls[viejo.id]}
                            canManage={false}
                            onEliminar={eliminar}
                          />
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
      {canManage && (
        <div className="mt-3">
          <input
            ref={inputRef}
            type="file"
            multiple
            onChange={(e) => handleUpload(e.target.files)}
            disabled={progreso !== null}
            className="block w-full text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
          />
          {progreso && (
            <div className="mt-2">
              <p className="text-xs text-slate-500">
                Subiendo {progreso.nombre} — {progreso.porcentaje}%
              </p>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full bg-brand-600 transition-all"
                  style={{ width: `${progreso.porcentaje}%` }}
                />
              </div>
            </div>
          )}
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
