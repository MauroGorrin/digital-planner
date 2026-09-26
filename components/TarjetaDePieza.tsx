'use client';

import type { ContentPiece } from '@/types/database';
import { FORMAT_LABELS, PLATFORM_LABELS } from '@/types/database';
import { formatTimeInTz } from '@/lib/tz';
import { StatusBadge } from './StatusBadge';

/**
 * El archivo que representa a la pieza en la tarjeta. Lo resuelve el servidor con
 * adjuntoDePortada y firma su URL solo si es una imagen: un video no tiene fotograma de portada
 * y generarlo seria transcodificar, que es un no-objetivo del proyecto.
 */
export interface Portada {
  fileName: string;
  fileType: string | null;
  url: string | null;
}

/**
 * Resumen de una pieza para ver al vuelo de que va, sin abrir su ficha.
 *
 * Deliberadamente sin botones de aprobar ni pedir cambios: esas acciones solo las puede hacer un
 * contacto del cliente, y los clientes revisan desde el telefono, donde no existe el mouse over.
 * Ademas aprobar dispara el webhook y notifica a la otra parte, asi que no va en una superficie
 * que aparece y desaparece con el puntero.
 */
export function TarjetaDePieza({ piece, portada }: { piece: ContentPiece; portada?: Portada }) {
  const esImagen = portada?.fileType?.startsWith('image/') ?? false;
  const esVideo = portada?.fileType?.startsWith('video/') ?? false;

  return (
    <div className="w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
      {portada && (
        <div className="border-b border-slate-100 bg-slate-50">
          {esImagen && portada.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={portada.url} alt={portada.fileName} className="h-32 w-full object-cover" />
          ) : (
            <div className="flex h-12 items-center gap-2 px-3 text-xs text-slate-500">
              <span className="font-medium">{esVideo ? 'Video' : 'Archivo'}</span>
              <span className="truncate">{portada.fileName}</span>
            </div>
          )}
        </div>
      )}

      <div className="p-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-500">
            {formatTimeInTz(piece.scheduled_at, piece.clients?.timezone ?? 'UTC')}
          </span>
          <StatusBadge status={piece.status} className="px-1.5 py-0.5 text-[9px]" />
        </div>

        <p className="text-sm font-medium text-slate-800">{piece.title}</p>

        <p className="mt-0.5 text-[11px] text-slate-400">
          {piece.clients?.brand_name} · {PLATFORM_LABELS[piece.platform]} ·{' '}
          {FORMAT_LABELS[piece.format]}
        </p>

        {piece.copy_text && (
          <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-slate-600">
            {piece.copy_text}
          </p>
        )}

        {!portada && <p className="mt-2 text-[11px] text-slate-400">Sin archivos todavía.</p>}
      </div>
    </div>
  );
}
