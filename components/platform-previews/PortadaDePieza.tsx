import type { VistaPieza } from '@/lib/grilla';
import { FORMAT_LABELS } from '@/types/database';

/** pequeno: ▶ chico solo en videos. grande: ▶ grande en videos. ninguno: la vista pone el suyo. */
export type EstiloPlay = 'pequeno' | 'grande' | 'ninguno';

/**
 * Portada de una pieza para cualquier vista. Con URL firmada muestra la imagen; sin ella, o si la
 * portada es un video, muestra un bloque neutro con el formato. Nunca renderiza un <video>.
 */
export function PortadaDePieza({
  pieza,
  className,
  play = 'pequeno',
}: {
  pieza: VistaPieza;
  className: string;
  play?: EstiloPlay;
}) {
  const mostrarPlay = pieza.portadaEsVideo && play !== 'ninguno';
  const mostrarImagen = pieza.portadaUrl !== null && !pieza.portadaEsVideo;

  return (
    <div className={`relative overflow-hidden bg-slate-200 ${className}`}>
      {mostrarImagen ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Supabase con caducidad; next/image no aplica.
        <img src={pieza.portadaUrl ?? undefined} alt={pieza.title} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs font-medium text-slate-500">
          {FORMAT_LABELS[pieza.format]}
        </div>
      )}
      {mostrarPlay && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 flex items-center justify-center text-white drop-shadow ${
            play === 'grande' ? 'text-4xl' : 'text-base'
          }`}
        >
          ▶
        </span>
      )}
    </div>
  );
}
