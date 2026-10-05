import { PLATFORM_LABELS } from '@/types/database';
import { formatDateTimeInTz } from '@/lib/tz';
import { PortadaDePieza } from './PortadaDePieza';
import type { PropsDePreview } from './types';

export function PreviewGenerica({ piezas }: PropsDePreview) {
  return (
    <div className="flex flex-col gap-3">
      {piezas.map((pieza) => (
        <article key={pieza.id} className="flex gap-4 rounded-xl border border-slate-200 bg-white p-4">
          <PortadaDePieza pieza={pieza} className="h-24 w-24 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-500">
              {PLATFORM_LABELS[pieza.platform]} · {formatDateTimeInTz(pieza.scheduled_at, pieza.timezone)}
            </p>
            <h3 className="truncate font-semibold text-slate-900">{pieza.title}</h3>
            <p className="line-clamp-3 text-sm text-slate-600">{pieza.copy_text}</p>
          </div>
        </article>
      ))}
    </div>
  );
}
