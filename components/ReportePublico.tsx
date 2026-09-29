import type { FilaDeMetrica } from '@/lib/metricas';
import type { ClientBillingMode } from '@/types/database';
import { MESES, TablaDeMetricas } from './TablaDeMetricas';

/**
 * La vista pública de un reporte de métricas (app/reportes/[clientId]/[anio]/[mes]/page.tsx) --
 * quien tiene el link, con o sin cuenta. A propósito NO es PanelDeMetricas con props distintas:
 * PanelDeMetricas trae un selector de marca/mes que navega con `<form method="get">` hacia la
 * MISMA página (sirve en /metricas, donde `anio`/`mes` son query params) -- aquí `anio`/`mes` son
 * segmentos de la ruta, así que ese formulario apuntaría al lugar equivocado. Esta vista es fija:
 * una marca, un mes, sin navegación ni edición.
 */
export function ReportePublico({
  clientName,
  billingMode,
  anio,
  mes,
  filas,
  sinPaquete,
  linkDelPdf,
}: {
  clientName: string;
  billingMode: ClientBillingMode;
  anio: number;
  mes: number;
  filas: FilaDeMetrica[];
  /** `true` solo si la marca trabaja por paquete y aún así no tiene cuotas cargadas. */
  sinPaquete: boolean;
  linkDelPdf: string;
}) {
  const esLibre = billingMode === 'libre';

  return (
    <main className="min-h-screen bg-ink-50 px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <p className="eyebrow mb-1">{clientName}</p>
          <h1 className="text-xl font-semibold text-slate-900">
            Reporte de <span className="title-accent">contenido</span>
          </h1>
          <p className="text-sm text-slate-500">
            {MESES[mes - 1]} {anio}
          </p>
        </div>

        {esLibre && (
          <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
            Esta marca trabaja en modo libre: no tiene cuota mensual, así que aquí solo se cuenta lo planificado y
            entregado, sin comparar contra un límite.
          </p>
        )}

        {sinPaquete && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Esta marca todavía no tiene un paquete mensual definido.
          </p>
        )}

        {filas.length > 0 ? (
          <TablaDeMetricas filas={filas} />
        ) : (
          <p className="text-sm text-slate-500">Sin contenido registrado este mes.</p>
        )}

        <a
          href={linkDelPdf}
          target="_blank"
          rel="noreferrer"
          className="inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Descargar PDF
        </a>
      </div>
    </main>
  );
}
