'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Client, ContentFormat, ContentPiece, PlatformType, Profile } from '@/types/database';
import { FORMAT_LABELS, PLATFORM_LABELS } from '@/types/database';
import { createContentPiece, updateContentPiece } from '@/app/actions';

function toLocalInputValue(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ContentPieceForm({
  clients,
  team,
  defaultClientId,
  piece,
}: {
  clients: Client[];
  team: Profile[];
  defaultClientId?: string;
  piece?: ContentPiece;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState(piece?.client_id ?? defaultClientId ?? clients[0]?.id ?? '');
  const [platform, setPlatform] = useState<PlatformType>(piece?.platform ?? 'instagram');
  const [contentFormat, setContentFormat] = useState<ContentFormat>(piece?.format ?? 'post');
  const [title, setTitle] = useState(piece?.title ?? '');
  const [copyText, setCopyText] = useState(piece?.copy_text ?? '');
  const [referenceLink, setReferenceLink] = useState(piece?.reference_link ?? '');
  const [scheduledAt, setScheduledAt] = useState(toLocalInputValue(piece?.scheduled_at) || toLocalInputValue(new Date().toISOString()));
  const [assigneeId, setAssigneeId] = useState(piece?.assignee_id ?? '');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId) {
      setError('Selecciona un cliente. Crea uno primero en la sección Clientes.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const isoDate = new Date(scheduledAt).toISOString();
      if (piece) {
        await updateContentPiece(piece.id, {
          platform,
          format: contentFormat,
          title,
          copy_text: copyText,
          reference_link: referenceLink || null,
          scheduled_at: isoDate,
          assignee_id: assigneeId || null,
        });
        router.push(`/piezas/${piece.id}`);
      } else {
        const id = await createContentPiece({
          client_id: clientId,
          platform,
          format: contentFormat,
          title,
          copy_text: copyText,
          reference_link: referenceLink || undefined,
          scheduled_at: isoDate,
          assignee_id: assigneeId || undefined,
        });
        router.push(`/piezas/${id}`);
      }
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
          Aún no tienes clientes. Crea uno en la sección Clientes antes de planificar contenido.
        </p>
      )}
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Cliente / Marca</label>
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          disabled={!!piece}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
          required
        >
          <option value="" disabled>
            Selecciona un cliente
          </option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.brand_name} ({c.name})
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Plataforma</label>
          <select value={platform} onChange={(e) => setPlatform(e.target.value as PlatformType)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {Object.entries(PLATFORM_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Formato</label>
          <select value={contentFormat} onChange={(e) => setContentFormat(e.target.value as ContentFormat)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {Object.entries(FORMAT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Título interno</label>
        <input
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ej. Lanzamiento colección primavera"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Copy / Texto</label>
        <textarea
          value={copyText}
          onChange={(e) => setCopyText(e.target.value)}
          rows={4}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Escribe el texto de la publicación…"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Fecha y hora</label>
          <input
            type="datetime-local"
            required
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Responsable interno</label>
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">Sin asignar</option>
            {team.map((t) => (
              <option key={t.id} value={t.id}>
                {t.full_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Enlace de referencia (opcional)</label>
        <input
          type="url"
          value={referenceLink ?? ''}
          onChange={(e) => setReferenceLink(e.target.value)}
          placeholder="https://…"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={() => router.back()} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
          Cancelar
        </button>
        <button
          type="submit"
          disabled={loading || clients.length === 0}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {loading ? 'Guardando…' : piece ? 'Guardar cambios' : 'Crear como borrador'}
        </button>
      </div>
    </form>
  );
}
