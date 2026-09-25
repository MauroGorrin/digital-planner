'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { deleteAttachment } from '@/app/actions';
import { registrarAdjunto, subirConProgreso, validarArchivo } from '@/lib/attachments';
import type { Attachment, Client, ContentPiece } from '@/types/database';

function formatBytes(bytes: number | null) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

interface ProgresoDeArchivo {
  nombre: string;
  porcentaje: number;
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

  return (
    <div>
      <div className="space-y-2">
        {attachments.length === 0 && <p className="text-sm text-slate-400">Sin adjuntos todavía.</p>}
        {attachments.map((a) => (
          <div key={a.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <a href={urls[a.id]} target="_blank" rel="noreferrer" className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-brand-700">{a.file_name}</p>
                <p className="text-xs text-slate-400">{formatBytes(a.file_size)}</p>
                {a.file_type?.startsWith('image/') && urls[a.id] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={urls[a.id]} alt={a.file_name} className="mt-1 h-20 rounded-md object-cover" />
                )}
              </a>
              {canManage && (
                <button onClick={() => deleteAttachment(a.id, piece.id).then(() => router.refresh())} className="text-xs text-red-500 hover:underline">
                  Eliminar
                </button>
              )}
            </div>

            {a.file_type?.startsWith('video/') && urls[a.id] && (
              <video
                controls
                preload="metadata"
                className="mt-1 max-h-64 w-full rounded-md bg-black"
                onError={(e) => e.currentTarget.classList.add('hidden')}
              >
                <source src={urls[a.id]} type={a.file_type} />
                Tu navegador no puede reproducir este archivo. Descargalo para verlo.
              </video>
            )}
          </div>
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
