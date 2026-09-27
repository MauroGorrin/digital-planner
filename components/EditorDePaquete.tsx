'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { definirCuotaDeFormato, quitarFormatoDelPaquete } from '@/app/actions-paquetes';
import type { ClientPackage, ContentFormat } from '@/types/database';
import { FORMAT_LABELS } from '@/types/database';

const FORMATOS = Object.keys(FORMAT_LABELS) as ContentFormat[];

/**
 * Editor del paquete de una marca, plegado por defecto (spec: "Dónde se ve"). Solo la agencia lo
 * ve -- `PanelDeMetricas` ya no lo renderiza para un cliente, y aunque llegara aquí, las Server
 * Actions que llama exigen `requireAgency()` antes de escribir y la RLS de `client_packages`
 * rechaza cualquier escritura del cliente de todas formas.
 */
export function EditorDePaquete({
  clientId,
  paquete,
}: {
  clientId: string;
  paquete: Pick<ClientPackage, 'format' | 'monthly_quota'>[];
}) {
  const router = useRouter();
  const cuotas = new Map(paquete.map((fila) => [fila.format, fila.monthly_quota]));

  const [valores, setValores] = useState<Record<ContentFormat, string>>(() => {
    const iniciales = {} as Record<ContentFormat, string>;
    for (const format of FORMATOS) iniciales[format] = String(cuotas.get(format) ?? '');
    return iniciales;
  });
  const [enFormatoContratado, setEnFormatoContratado] = useState<Set<ContentFormat>>(new Set(cuotas.keys()));
  const [cargando, setCargando] = useState<ContentFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function guardar(format: ContentFormat) {
    const valor = Number(valores[format]);
    if (!Number.isInteger(valor) || valor <= 0) {
      setError('La cuota debe ser un número entero mayor que cero.');
      return;
    }
    setError(null);
    setCargando(format);
    try {
      await definirCuotaDeFormato(clientId, format, valor);
      setEnFormatoContratado((actual) => new Set(actual).add(format));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la cuota.');
    } finally {
      setCargando(null);
    }
  }

  async function quitar(format: ContentFormat) {
    setError(null);
    setCargando(format);
    try {
      await quitarFormatoDelPaquete(clientId, format);
      setEnFormatoContratado((actual) => {
        const siguiente = new Set(actual);
        siguiente.delete(format);
        return siguiente;
      });
      setValores((actual) => ({ ...actual, [format]: '' }));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo quitar el formato del paquete.');
    } finally {
      setCargando(null);
    }
  }

  return (
    <details className="rounded-2xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold text-slate-800">Editar el paquete de esta marca</summary>
      <div className="mt-4 space-y-3">
        <p className="text-xs text-slate-500">
          Deja un formato vacío para que no forme parte del paquete. Quitar un formato borra su cuota, no la deja en cero.
        </p>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {FORMATOS.map((format) => (
          <div key={format} className="flex flex-wrap items-center gap-3">
            <label htmlFor={`cuota-${format}`} className="w-24 text-sm text-slate-600">
              {FORMAT_LABELS[format]}
            </label>
            <input
              id={`cuota-${format}`}
              type="number"
              min={1}
              step={1}
              value={valores[format]}
              onChange={(e) => setValores((actual) => ({ ...actual, [format]: e.target.value }))}
              placeholder="Sin contratar"
              className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-sm"
            />
            <button
              type="button"
              disabled={cargando === format || valores[format] === ''}
              onClick={() => guardar(format)}
              className="btn-secondary text-xs"
            >
              Guardar
            </button>
            {enFormatoContratado.has(format) && (
              <button
                type="button"
                disabled={cargando === format}
                onClick={() => quitar(format)}
                className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
              >
                Quitar del paquete
              </button>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
