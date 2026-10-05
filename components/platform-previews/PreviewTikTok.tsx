import { AvatarDeMarca, usuarioDeMarca } from './marca';
import { PortadaDePieza } from './PortadaDePieza';
import type { PropsDePreview } from './types';

/** Video vertical de TikTok, con el texto sobre la imagen y la columna de iconos a la derecha. */
export function PreviewTikTok({ piezas }: PropsDePreview) {
  return (
    <div className="mx-auto flex max-w-full snap-x gap-4 overflow-x-auto pb-2">
      {piezas.map((pieza) => (
        <article key={pieza.id} className="relative aspect-[9/16] w-56 shrink-0 snap-center overflow-hidden rounded-2xl bg-black">
          <PortadaDePieza pieza={pieza} className="absolute inset-0" play="grande" />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-16 text-white">
            <p className="text-sm font-semibold">@{usuarioDeMarca(pieza.brand_name)}</p>
            <p className="mt-1 line-clamp-2 text-xs">{pieza.copy_text}</p>
          </div>
          <div className="absolute bottom-16 right-2 flex flex-col items-center gap-4 text-lg text-white" aria-hidden="true">
            <AvatarDeMarca marca={pieza.brand_name} tamano="h-9 w-9" className="ring-2 ring-white" />
            <span>♥</span>
            <span>💬</span>
            <span>↗</span>
          </div>
        </article>
      ))}
    </div>
  );
}
