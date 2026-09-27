'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClientEntity } from '@/app/admin-actions';
import type { ClientBillingMode, ContentFormat } from '@/types/database';
import { FORMAT_LABELS } from '@/types/database';

const COMMON_TIMEZONES = [
  'America/Mexico_City',
  'America/Bogota',
  'America/Lima',
  'America/Santiago',
  'America/Argentina/Buenos_Aires',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/Madrid',
  'UTC',
];

const FORMATOS = Object.keys(FORMAT_LABELS) as ContentFormat[];

export function NewClientForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [brandName, setBrandName] = useState('');
  const [timezone, setTimezone] = useState('America/Mexico_City');
  const [notes, setNotes] = useState('');
  const [billingMode, setBillingMode] = useState<ClientBillingMode>('paquete');
  const [quotas, setQuotas] = useState<Record<ContentFormat, string>>(() => {
    const iniciales = {} as Record<ContentFormat, string>;
    for (const format of FORMATOS) iniciales[format] = '';
    return iniciales;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // El cliente SI se creo pero sus cuotas no se guardaron. Se muestra en linea y no con
  // window.alert: el alert bloquea el hilo, no se puede estilar, el navegador puede suprimirlo,
  // y saltaba justo antes de navegar -- el usuario leia el aviso y acto seguido perdia el
  // contexto. Guardamos tambien el id para ofrecerle ir a la ficha cuando el quiera.
  const [aviso, setAviso] = useState<{ mensaje: string; clienteId: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const quotasNumericas =
        billingMode === 'paquete'
          ? (Object.fromEntries(
              Object.entries(quotas)
                .filter(([, valor]) => valor !== '')
                .map(([format, valor]) => [format, Number(valor)])
            ) as Partial<Record<ContentFormat, number>>)
          : undefined;

      const { id, quotaWarning } = await createClientEntity({
        name,
        brand_name: brandName,
        timezone,
        notes,
        billing_mode: billingMode,
        quotas: quotasNumericas,
      });
      if (quotaWarning) {
        setAviso({ mensaje: quotaWarning, clienteId: id });
        setLoading(false);
        return;
      }
      router.push(`/clientes/${id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ocurrió un error.');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Nombre del cliente (empresa)</label>
        <input required value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Nombre de marca</label>
        <input
          required
          value={brandName}
          onChange={(e) => setBrandName(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Como aparecerá en el calendario"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Zona horaria del cliente</label>
        <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
          {COMMON_TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Notas (opcional)</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>

      <div>
        <span id="modo-facturacion" className="mb-1 block text-sm font-medium text-slate-700">
          ¿Este cliente trabaja por paquetes?
        </span>
        {/* radiogroup y no dos botones sueltos: las dos opciones son mutuamente excluyentes,
            y sin aria-checked un lector de pantalla no puede anunciar cual esta elegida. */}
        <div className="flex gap-3" role="radiogroup" aria-labelledby="modo-facturacion">
          <button
            type="button"
            role="radio"
            aria-checked={billingMode === 'paquete'}
            onClick={() => setBillingMode('paquete')}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
              billingMode === 'paquete' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Sí, por paquete
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={billingMode === 'libre'}
            onClick={() => setBillingMode('libre')}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
              billingMode === 'libre' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
            }`}
          >
            No, libre
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {billingMode === 'paquete'
            ? 'Define cuántos posts, reels, historias, etc. incluye el paquete mensual. Puedes ajustarlo luego.'
            : 'El cliente podrá tener tantas piezas como haga falta, sin cuota mensual que comparar.'}
        </p>
      </div>

      {billingMode === 'paquete' && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-medium text-slate-600">Cuota mensual por formato (deja vacío el que no aplique)</p>
          {FORMATOS.map((format) => (
            <div key={format} className="flex items-center gap-3">
              <label htmlFor={`nueva-cuota-${format}`} className="w-24 text-sm text-slate-600">
                {FORMAT_LABELS[format]}
              </label>
              <input
                id={`nueva-cuota-${format}`}
                type="number"
                min={1}
                step={1}
                value={quotas[format]}
                onChange={(e) => setQuotas((actual) => ({ ...actual, [format]: e.target.value }))}
                placeholder="Sin contratar"
                className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-sm"
              />
            </div>
          ))}
        </div>
      )}

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {aviso && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <p>{aviso.mensaje}</p>
          <button
            type="button"
            onClick={() => {
              router.push(`/clientes/${aviso.clienteId}`);
              router.refresh();
            }}
            className="mt-1 font-medium underline"
          >
            Ir a la ficha del cliente
          </button>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={() => router.back()} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
          Cancelar
        </button>
        {/* Deshabilitado tambien con `aviso`: ahi el cliente ya se creo y volver a enviar el
            formulario crearia otro. Con window.alert el riesgo no existia porque navegaba. */}
        <button type="submit" disabled={loading || aviso !== null} className="btn-primary">
          {loading ? 'Creando…' : 'Crear cliente'}
        </button>
      </div>
    </form>
  );
}
