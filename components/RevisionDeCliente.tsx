import { AccionesDeAprobacion } from './AccionesDeAprobacion';
import { VISTA_POR_PLATAFORMA } from '@/lib/grilla-vistas';
import type { VistaPieza } from '@/lib/grilla';
import { PLATFORM_LABELS } from '@/types/database';

/**
 * La cola de aprobación del cliente, dentro de la grilla: cada pieza en `pendiente_revision` se ve
 * exactamente como se vería ya publicada en su red -- la misma tarjeta que usa `GrillaDeContenido`
 * para el feed, una pieza a la vez -- con Aprobar/Pedir cambios justo debajo.
 *
 * Solo la pinta quien llama: no decide por sí misma quién puede aprobar. Eso ya lo decidió la RLS
 * al traer las piezas (`cargarVistasDeGrilla` con sesión de cliente), y lo vuelve a comprobar la
 * RPC detrás de cada botón.
 */
export function RevisionDeCliente({ piezas }: { piezas: VistaPieza[] }) {
  if (piezas.length === 0) return null;

  return (
    <section aria-labelledby="revision-de-cliente" className="mb-8 space-y-4">
      <div>
        <h2 id="revision-de-cliente" className="text-base font-semibold text-slate-900">
          Pendiente de tu aprobación ({piezas.length})
        </h2>
        <p className="text-sm text-slate-500">Así se vería cada pieza si la publicas tal como está.</p>
      </div>
      <div className="space-y-6">
        {piezas.map((pieza) => {
          const Vista = VISTA_POR_PLATAFORMA[pieza.platform];
          return (
            <article key={pieza.id} aria-label={`${PLATFORM_LABELS[pieza.platform]}: ${pieza.title}`}>
              <Vista piezas={[pieza]} />
              <AccionesDeAprobacion piezaId={pieza.id} />
            </article>
          );
        })}
      </div>
    </section>
  );
}
