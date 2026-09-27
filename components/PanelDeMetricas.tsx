import type { FilaDeMetrica } from '@/lib/metricas';
import type { ClientBillingMode, ClientPackage } from '@/types/database';
import { FORMAT_LABELS } from '@/types/database';
import { EditorDePaquete } from './EditorDePaquete';

const MESES = [
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

export interface MarcaOpcion {
  id: string;
  name: string;
  brand_name: string;
}

/**
 * Pantalla de métricas del paquete, para los dos roles. Server Component en espíritu (recibe
 * todo ya resuelto por `app/metricas/page.tsx`): los selectores navegan cambiando
 * `searchParams` vía un `<form method="get">` normal, no estado de cliente. Lo único
 * interactivo es `EditorDePaquete`, que sí es `"use client"` y solo se renderiza para la
 * agencia.
 */
export function PanelDeMetricas({
  role,
  brands,
  selectedClientId,
  clientName,
  billingMode,
  anio,
  mes,
  filas,
  paquete,
}: {
  role: 'agency' | 'client';
  brands: MarcaOpcion[];
  selectedClientId: string;
  clientName: string;
  billingMode: ClientBillingMode;
  anio: number;
  mes: number;
  filas: FilaDeMetrica[];
  paquete: Pick<ClientPackage, 'format' | 'monthly_quota'>[];
}) {
  const esAgencia = role === 'agency';
  const esLibre = billingMode === 'libre';
  // El cliente no elige su marca -- la resuelve la página desde client_contacts. Pero si por
  // error de datos fuera contacto de más de una, no le adivinamos cuál: se le ofrece el mismo
  // selector, limitado a esas marcas (spec, sección "Dónde se ve").
  const mostrarSelectorDeMarca = esAgencia || brands.length > 1;
  // Una marca "libre" nunca esta "sin paquete definido": no lleva paquete a proposito, y no es lo
  // mismo que la agencia todavia no haya llegado a configurarlo. Ese aviso solo tiene sentido
  // cuando la marca SI trabaja por paquete y aun asi no tiene cuotas cargadas.
  const sinPaquete = !esLibre && paquete.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow mb-1">{clientName}</p>
        <h1 className="text-xl font-semibold text-slate-900">
          Métricas del <span className="title-accent">paquete</span>
        </h1>
        <p className="text-sm text-slate-500">
          {MESES[mes - 1]} {anio}
        </p>
      </div>

      <Selectores
        mostrarSelectorDeMarca={mostrarSelectorDeMarca}
        brands={brands}
        selectedClientId={selectedClientId}
        anio={anio}
        mes={mes}
      />

      {esLibre && (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
          Esta marca trabaja en modo libre: no tiene cuota mensual, así que aquí solo se cuenta lo planificado y
          entregado, sin comparar contra un límite.
        </p>
      )}

      {sinPaquete && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span>Esta marca todavía no tiene un paquete mensual definido.</span>
          {esAgencia && <span> Usa el editor de abajo para definirlo.</span>}
        </p>
      )}

      {filas.length > 0 && <TablaDeMetricas filas={filas} />}

      {esAgencia && !esLibre && <EditorDePaquete clientId={selectedClientId} paquete={paquete} />}
    </div>
  );
}

function Selectores({
  mostrarSelectorDeMarca,
  brands,
  selectedClientId,
  anio,
  mes,
}: {
  mostrarSelectorDeMarca: boolean;
  brands: MarcaOpcion[];
  selectedClientId: string;
  anio: number;
  mes: number;
}) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3">
      {mostrarSelectorDeMarca ? (
        <div>
          <label htmlFor="selector-marca" className="mb-1 block text-xs font-medium text-slate-600">
            Marca
          </label>
          <select
            id="selector-marca"
            name="client"
            defaultValue={selectedClientId}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {brands.map((marca) => (
              <option key={marca.id} value={marca.id}>
                {marca.brand_name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <input type="hidden" name="client" value={selectedClientId} />
      )}
      <div>
        <label htmlFor="selector-mes" className="mb-1 block text-xs font-medium text-slate-600">
          Mes
        </label>
        <select id="selector-mes" name="mes" defaultValue={mes} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          {MESES.map((nombre, i) => (
            <option key={nombre} value={i + 1}>
              {nombre}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="selector-anio" className="mb-1 block text-xs font-medium text-slate-600">
          Año
        </label>
        <select id="selector-anio" name="anio" defaultValue={anio} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          {[anio - 1, anio, anio + 1].map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn-secondary">
        Ver
      </button>
    </form>
  );
}

function TablaDeMetricas({ filas }: { filas: FilaDeMetrica[] }) {
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
