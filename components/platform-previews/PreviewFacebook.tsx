import { formatDateTimeInTz } from '@/lib/tz';
import { PortadaDePieza } from './PortadaDePieza';
import type { PropsDePreview } from './types';

export function PreviewFacebook({ piezas }: PropsDePreview) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      {piezas.map((pieza) => (
        <article key={pieza.id} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <header className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 font-semibold text-white">
                {pieza.brand_name.charAt(0).toUpperCase()}
              </span>
              <div className="leading-tight">
                <p className="text-sm font-semibold text-slate-900">{pieza.brand_name}</p>
                <p className="text-xs text-slate-500">{formatDateTimeInTz(pieza.scheduled_at, pieza.timezone)}</p>
              </div>
            </div>
            <span aria-hidden="true" className="text-lg text-slate-500">
              ⋯
            </span>
          </header>
          <p className="line-clamp-4 whitespace-pre-line text-sm text-slate-800">{pieza.copy_text}</p>
          <PortadaDePieza pieza={pieza} className="mt-3 aspect-video w-full rounded-lg" />
          <div className="mt-3 flex justify-around border-t border-slate-100 pt-2 text-sm font-medium text-slate-600">
            <button type="button" className="rounded px-2 py-1 hover:bg-slate-100">
              Me gusta
            </button>
            <button type="button" className="rounded px-2 py-1 hover:bg-slate-100">
              Comentar
            </button>
            <button type="button" className="rounded px-2 py-1 hover:bg-slate-100">
              Compartir
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
