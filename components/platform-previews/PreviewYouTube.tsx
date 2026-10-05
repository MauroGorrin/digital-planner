import { formatDateTimeInTz } from '@/lib/tz';
import { PortadaDePieza } from './PortadaDePieza';
import type { PropsDePreview } from './types';

export function PreviewYouTube({ piezas }: PropsDePreview) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
      {piezas.map((pieza) => (
        <article key={pieza.id} className="group">
          <div className="relative">
            <PortadaDePieza
              pieza={pieza}
              className="aspect-video w-full rounded-lg transition group-hover:brightness-75"
              play="ninguno"
            />
            <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600 pl-1 text-white shadow">
                ▶
              </span>
            </span>
          </div>
          <h3 className="mt-2 line-clamp-2 text-sm font-semibold text-slate-900">{pieza.title}</h3>
          <p className="text-xs text-slate-500">
            {pieza.brand_name} · {formatDateTimeInTz(pieza.scheduled_at, pieza.timezone)}
          </p>
        </article>
      ))}
    </div>
  );
}
