import { formatDateTimeInTz } from '@/lib/tz';
import { PortadaDePieza } from './PortadaDePieza';
import type { PropsDePreview } from './types';

export function PreviewLinkedIn({ piezas }: PropsDePreview) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      {piezas.map((pieza) => (
        <article key={pieza.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <header className="mb-3 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-700 font-semibold text-white">
              {pieza.brand_name.charAt(0).toUpperCase()}
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-slate-900">{pieza.brand_name}</p>
              <p className="text-xs text-slate-500">{formatDateTimeInTz(pieza.scheduled_at, pieza.timezone)}</p>
            </div>
          </header>
          <p className="line-clamp-4 whitespace-pre-line text-sm text-slate-800">{pieza.copy_text}</p>
          <PortadaDePieza pieza={pieza} className="mt-3 aspect-[6/5] w-full rounded-md" />
          <div className="mt-3 flex justify-around border-t border-slate-100 pt-2 text-xs font-medium text-slate-500">
            <span>Me gusta</span>
            <span>Comentar</span>
            <span>Compartir</span>
          </div>
        </article>
      ))}
    </div>
  );
}
