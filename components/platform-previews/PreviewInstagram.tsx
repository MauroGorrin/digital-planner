import { formatDateTimeInTz } from '@/lib/tz';
import { AvatarDeMarca, usuarioDeMarca } from './marca';
import { PortadaDePieza } from './PortadaDePieza';
import type { PropsDePreview } from './types';

/** Publicaciones de feed de Instagram: cabecera, imagen, iconos de acción y pie con el texto. */
export function PreviewInstagram({ piezas }: PropsDePreview) {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-6">
      {piezas.map((pieza) => (
        <article key={pieza.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <header className="flex items-center gap-3 px-3 py-2.5">
            <AvatarDeMarca marca={pieza.brand_name} tamano="h-8 w-8" className="ring-2 ring-pink-500 ring-offset-1" />
            <p className="truncate text-sm font-semibold text-slate-900">{usuarioDeMarca(pieza.brand_name)}</p>
          </header>
          <PortadaDePieza
            pieza={pieza}
            className={pieza.format === 'reel' || pieza.format === 'historia' ? 'aspect-[9/16] w-full' : 'aspect-square w-full'}
            play="grande"
          />
          <div className="px-3 pb-3 pt-2.5">
            <div className="flex items-center gap-4 text-xl text-slate-800" aria-hidden="true">
              <span>♡</span>
              <span>💬</span>
              <span>✈</span>
              <span className="ml-auto">🔖</span>
            </div>
            <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm text-slate-800">
              <span className="font-semibold">{usuarioDeMarca(pieza.brand_name)}</span> {pieza.copy_text}
            </p>
            <p className="mt-1.5 text-[11px] uppercase tracking-wide text-slate-400">
              {formatDateTimeInTz(pieza.scheduled_at, pieza.timezone)}
            </p>
          </div>
        </article>
      ))}
    </div>
  );
}
