'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Client, ContentFormat, PlatformType } from '@/types/database';
import { FORMAT_LABELS, PLATFORM_LABELS } from '@/types/database';
import { crearIdea } from '@/app/actions-ideas';

export function NuevaIdeaForm({ clients }: { clients: Client[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [referenceLink, setReferenceLink] = useState('');
  const [platform, setPlatform] = useState<PlatformType | ''>('');
  const [contentFormat, setContentFormat] = useState<ContentFormat | ''>('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId) {
      setError('Selecciona una marca. Crea un cliente primero en la sección Clientes.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await crearIdea({
        client_id: clientId,
        title,
        description,
        reference_link: referenceLink || undefined,
        suggested_platform: platform || undefined,
        suggested_format: contentFormat || undefined,
      });
      setTitle('');
      setDescription('');
      setReferenceLink('');
      setPlatform('');
      setContentFormat('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ocurrió un error al guardar.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      {clients.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Aún no tienes clientes. Crea uno en la sección Clientes antes de proponer ideas.
        </p>
      )}
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Marca</label>
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          required
        >
          <option value="" disabled>
            Elige una marca
          </option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.brand_name} ({c.name})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Título</label>
        <input
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ej. Serie de reels con testimonios de clientes"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Descripción</label>
        <textarea
          required
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Describe la idea…"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Plataforma sugerida</label>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as PlatformType | '')}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Sin definir</option>
            {Object.entries(PLATFORM_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Formato sugerido</label>
          <select
            value={contentFormat}
            onChange={(e) => setContentFormat(e.target.value as ContentFormat | '')}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Sin definir</option>
            {Object.entries(FORMAT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Enlace de referencia (opcional)</label>
        <input
          type="url"
          value={referenceLink}
          onChange={(e) => setReferenceLink(e.target.value)}
          placeholder="https://…"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="submit"
          disabled={loading || clients.length === 0}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {loading ? 'Guardando…' : 'Proponer idea'}
        </button>
      </div>
    </form>
  );
}
