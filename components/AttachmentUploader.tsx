'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { deleteAttachment } from '@/app/actions';
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

export function AttachmentUploader({
  piece,
  attachments,
  canManage,
}: {
  piece: ContentPiece & { clients: Client };
  attachments: Attachment[];
  canManage: boolean;
}) {
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    (async () => {
      const entries = await Promise.all(
        attachments.map(async (a) => {
          const { data } = await supabase.storage.from('attachments').createSignedUrl(a.file_path, 3600);
          return [a.id, data?.signedUrl ?? ''] as const;
        })
      );
      if (active) setUrls(Object.fromEntries(entries));
    })();
    return () => {
      active = false;
    };
  }, [attachments, supabase]);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const path = `${piece.client_id}/${piece.id}/${Date.now()}_${file.name.replace(/[^\w.\-]/g, '_')}`;
        const { error: uploadError } = await supabase.storage.from('attachments').upload(path, file);
        if (uploadError) throw uploadError;
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const { error: insertError } = await supabase.from('attachments').insert({
          content_piece_id: piece.id,
          file_path: path,
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
          uploaded_by: user?.id,
        });
        if (insertError) throw insertError;
      }
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir el archivo.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div>
      <div className="space-y-2">
        {attachments.length === 0 && <p className="text-sm text-slate-400">Sin adjuntos todavía.</p>}
        {attachments.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <a href={urls[a.id]} target="_blank" rel="noreferrer" className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-brand-700">{a.file_name}</p>
              <p className="text-xs text-slate-400">{formatBytes(a.file_size)}</p>
              {a.file_type?.startsWith('image/') && urls[a.id] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={urls[a.id]} alt={a.file_name} className="mt-1 h-20 rounded-md object-cover" />
              )}
            </a>
            {canManage && (
              <button onClick={() => deleteAttachment(a.id, piece.id).then(() => window.location.reload())} className="text-xs text-red-500 hover:underline">
                Eliminar
              </button>
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
            disabled={uploading}
            className="block w-full text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
          />
          {uploading && <p className="mt-1 text-xs text-slate-400">Subiendo…</p>}
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
