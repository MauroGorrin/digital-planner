'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClientEntity } from '@/app/admin-actions';

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

export function NewClientForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [brandName, setBrandName] = useState('');
  const [timezone, setTimezone] = useState('America/Mexico_City');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const id = await createClientEntity({ name, brand_name: brandName, timezone, notes });
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
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={() => router.back()} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
          Cancelar
        </button>
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? 'Creando…' : 'Crear cliente'}
        </button>
      </div>
    </form>
  );
}
