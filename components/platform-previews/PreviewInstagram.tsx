import { formatDateTimeInTz } from '@/lib/tz';
import { PortadaDePieza } from './PortadaDePieza';
import type { PropsDePreview } from './types';

const MAXIMO = 12;

export function PreviewInstagram({ piezas }: PropsDePreview) {
  return (
    <div className="mx-auto max-w-md">
      <div className="grid grid-cols-3 gap-1">
        {piezas.slice(0, MAXIMO).map((pieza) => (
          <div key={pieza.id}>
            <PortadaDePieza pieza={pieza} className="aspect-square w-full" />
            <div className="mt-1 px-0.5">
              <p className="truncate text-xs font-medium text-slate-800">{pieza.title}</p>
              <p className="text-[10px] text-slate-500">{formatDateTimeInTz(pieza.scheduled_at, pieza.timezone)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
