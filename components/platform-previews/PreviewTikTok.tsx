import { formatDateTimeInTz } from '@/lib/tz';
import { PortadaDePieza } from './PortadaDePieza';
import type { PropsDePreview } from './types';

const MAXIMO = 20;

export function PreviewTikTok({ piezas }: PropsDePreview) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-xl bg-black p-1 md:grid-cols-4">
      {piezas.slice(0, MAXIMO).map((pieza) => (
        <div key={pieza.id} className="relative">
          <PortadaDePieza pieza={pieza} className="aspect-[9/16] w-full" play="grande" />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-2">
            <p className="truncate text-xs font-semibold text-white">{pieza.title}</p>
            <p className="text-[10px] text-slate-300">{formatDateTimeInTz(pieza.scheduled_at, pieza.timezone)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
