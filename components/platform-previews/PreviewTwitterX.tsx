import { formatDateTimeInTz } from '@/lib/tz';
import { PortadaDePieza } from './PortadaDePieza';
import { usuarioDeMarca } from './marca';
import type { PropsDePreview } from './types';

export function PreviewTwitterX({ piezas }: PropsDePreview) {
  return (
    <div className="mx-auto max-w-xl divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
      {piezas.map((pieza) => (
        <article key={pieza.id} className="flex gap-3 p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black font-semibold text-white">
            {pieza.brand_name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-slate-900">
              <span className="font-bold">{pieza.brand_name}</span>{' '}
              <span className="text-slate-500">
                @{usuarioDeMarca(pieza.brand_name)} · {formatDateTimeInTz(pieza.scheduled_at, pieza.timezone)}
              </span>
            </p>
            <p className="mt-1 line-clamp-5 whitespace-pre-line text-sm text-slate-800">{pieza.copy_text}</p>
            <PortadaDePieza pieza={pieza} className="mt-3 aspect-video w-full rounded-xl" />
            <div className="mt-3 flex justify-between text-xs text-slate-500" aria-hidden="true">
              <span>💬 10</span>
              <span>🔄 45</span>
              <span>❤️ 234</span>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
