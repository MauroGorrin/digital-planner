import { formatDateTimeInTz } from '@/lib/tz';
import { AvatarDeMarca } from './marca';
import { PortadaDePieza } from './PortadaDePieza';
import type { PropsDePreview } from './types';

/** Pines de Pinterest en columnas, con título y tablero debajo de cada imagen. */
export function PreviewPinterest({ piezas }: PropsDePreview) {
  return (
    <div className="columns-2 gap-3 sm:columns-3">
      {piezas.map((pieza) => (
        <article key={pieza.id} className="mb-3 break-inside-avoid overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <PortadaDePieza pieza={pieza} className="aspect-[2/3] w-full" play="pequeno" />
          <div className="p-2.5">
            <h3 className="line-clamp-2 text-sm font-semibold text-slate-900">{pieza.title}</h3>
            <div className="mt-1.5 flex items-center gap-2">
              <AvatarDeMarca marca={pieza.brand_name} tamano="h-5 w-5" />
              <p className="truncate text-xs text-slate-500">
                {pieza.brand_name} · {formatDateTimeInTz(pieza.scheduled_at, pieza.timezone)}
              </p>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
