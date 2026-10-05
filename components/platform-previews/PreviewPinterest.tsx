import { formatDateTimeInTz } from '@/lib/tz';
import { PortadaDePieza } from './PortadaDePieza';
import type { PropsDePreview } from './types';

export function PreviewPinterest({ piezas }: PropsDePreview) {
  return (
    <div className="columns-2 gap-4 md:columns-3">
      {piezas.map((pieza) => (
        <article
          key={pieza.id}
          className="mb-4 break-inside-avoid rounded-2xl bg-white p-2 shadow-sm transition hover:scale-[1.02]"
        >
          <div className="relative">
            <PortadaDePieza pieza={pieza} className="aspect-[4/5] w-full rounded-2xl" />
            <span
              aria-hidden="true"
              className="absolute right-2 top-2 rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white"
            >
              💾
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2 px-1">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs font-semibold text-white">
              {pieza.brand_name.charAt(0).toUpperCase()}
            </span>
            <p className="truncate text-xs text-slate-600">{pieza.brand_name}</p>
          </div>
          <h3 className="mt-1 px-1 text-sm font-semibold text-slate-900">{pieza.title}</h3>
          <p className="line-clamp-3 px-1 text-xs text-slate-600">{pieza.copy_text}</p>
          <p className="px-1 pt-1 text-[10px] text-slate-400">{formatDateTimeInTz(pieza.scheduled_at, pieza.timezone)}</p>
        </article>
      ))}
    </div>
  );
}
