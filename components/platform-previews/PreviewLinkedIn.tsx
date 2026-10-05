import { formatDateTimeInTz } from '@/lib/tz';
import { AvatarDeMarca } from './marca';
import { PortadaDePieza } from './PortadaDePieza';
import type { PropsDePreview } from './types';

/** Publicaciones de la página de empresa en LinkedIn: cabecera profesional, texto, imagen y acciones. */
export function PreviewLinkedIn({ piezas }: PropsDePreview) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      {piezas.map((pieza) => (
        <article key={pieza.id} className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
          <header className="flex gap-3 px-4 pt-4">
            <AvatarDeMarca marca={pieza.brand_name} tamano="h-12 w-12" forma="cuadrado" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{pieza.brand_name}</p>
              <p className="text-xs text-slate-500">Página de empresa · {formatDateTimeInTz(pieza.scheduled_at, pieza.timezone)}</p>
            </div>
          </header>
          <p className="whitespace-pre-line px-4 pt-3 text-sm text-slate-800">{pieza.copy_text}</p>
          <PortadaDePieza pieza={pieza} className="mt-3 aspect-[1.91/1] w-full" play="grande" />
          <div className="flex justify-around border-t border-slate-200 px-2 py-2 text-xs font-medium text-slate-500" aria-hidden="true">
            <span>👍 Me gusta</span>
            <span>💬 Comentar</span>
            <span>↻ Compartir</span>
            <span>➤ Enviar</span>
          </div>
        </article>
      ))}
    </div>
  );
}
