import type { FilaDeMetrica } from '@/lib/metricas';
import { FORMAT_LABELS } from '@/types/database';

// Extraído de PanelDeMetricas.tsx: la tabla y MESES los reutiliza también la página pública del
// reporte (app/reportes/[clientId]/[anio]/[mes]/page.tsx), que no debe arrastrar el selector de
// marca/mes de PanelDeMetricas (esos <form method="get"> navegarían a la ruta equivocada ahí) ni
// el editor de cuotas, que es solo de agencia.
export const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

export function TablaDeMetricas({ filas }: { filas: FilaDeMetrica[] }) {
  const contratadas = filas.filter((fila) => fila.contratado !== null);
  const fueraDelPaquete = filas.filter((fila) => fila.contratado === null);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2">Formato</th>
            <th className="px-4 py-2">Contratado</th>
            <th className="px-4 py-2">Planificado</th>
            <th className="px-4 py-2">Entregado</th>
            <th className="px-4 py-2">Avance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {contratadas.map((fila) => (
            <FilaContratada key={fila.format} fila={fila} />
          ))}
          {fueraDelPaquete.length > 0 && (
            <tr>
              <td colSpan={5} className="bg-slate-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Fuera del paquete
              </td>
            </tr>
          )}
          {fueraDelPaquete.map((fila) => (
            <FilaFueraDelPaquete key={fila.format} fila={fila} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FilaContratada({ fila }: { fila: FilaDeMetrica }) {
  const contratado = fila.contratado as number;
  return (
    <tr className="hover:bg-slate-50">
      <td className="px-4 py-2.5 font-medium text-slate-800">{FORMAT_LABELS[fila.format]}</td>
      <td className="px-4 py-2.5 text-slate-600">{contratado}</td>
      <td className="px-4 py-2.5 text-slate-600">{fila.planificado}</td>
      <td className="px-4 py-2.5 text-slate-600">{fila.entregado}</td>
      <td className="px-4 py-2.5">
        <BarraDeAvance contratado={contratado} planificado={fila.planificado} entregado={fila.entregado} />
      </td>
    </tr>
  );
}

// Fuera del paquete: son piezas extra, no un incumplimiento -- por eso esta fila nunca compara
// contra una cuota (no la tiene) ni usa el color de alerta que sí puede llevar una fila
// contratada corta. "Contratado" queda como un guion neutro, no un cero ni una advertencia.
function FilaFueraDelPaquete({ fila }: { fila: FilaDeMetrica }) {
  return (
    <tr className="hover:bg-slate-50">
      <td className="px-4 py-2.5 font-medium text-slate-800">{FORMAT_LABELS[fila.format]}</td>
      <td className="px-4 py-2.5 text-slate-400">—</td>
      <td className="px-4 py-2.5 text-slate-600">{fila.planificado}</td>
      <td className="px-4 py-2.5 text-slate-600">{fila.entregado}</td>
      <td className="px-4 py-2.5 text-xs text-slate-400">—</td>
    </tr>
  );
}

function BarraDeAvance({ contratado, planificado, entregado }: { contratado: number; planificado: number; entregado: number }) {
  const porcentajeEntregado = Math.min(100, Math.round((entregado / contratado) * 100));
  const porcentajePlanificado = Math.min(100, Math.round((planificado / contratado) * 100));

  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
      <div className="absolute inset-y-0 left-0 rounded-full bg-brand-200" style={{ width: `${porcentajePlanificado}%` }} />
      <div
        role="progressbar"
        aria-valuenow={porcentajeEntregado}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Entregado: ${entregado} de ${contratado}`}
        className="absolute inset-y-0 left-0 rounded-full bg-brand-600 transition-all"
        style={{ width: `${porcentajeEntregado}%` }}
      />
    </div>
  );
}
