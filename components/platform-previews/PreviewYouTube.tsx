import { formatDateTimeInTz } from '@/lib/tz';
import { AvatarDeMarca } from './marca';
import { PortadaDePieza } from './PortadaDePieza';
import type { PropsDePreview } from './types';

/** Miniaturas de YouTube: imagen 16:9, título y canal debajo, como en la página de resultados. */
export function PreviewYouTube({ piezas }: PropsDePreview) {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
      {piezas.map((pieza) => (
        <article key={pieza.id}>
          <PortadaDePieza pieza={pieza} className="aspect-video w-full rounded-xl" play="grande" />
          <div className="mt-3 flex gap-3">
            <AvatarDeMarca marca={pieza.brand_name} tamano="h-9 w-9" />
            <div className="min-w-0">
              <h3 className="line-clamp-2 text-sm font-semibold text-slate-900">{pieza.title}</h3>
              <p className="truncate text-xs text-slate-500">{pieza.brand_name}</p>
              <p className="text-xs text-slate-500">{formatDateTimeInTz(pieza.scheduled_at, pieza.timezone)}</p>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
