'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveWebhookConfig, toggleWebhookConfig, deleteWebhookConfig } from '@/app/admin-actions';
import { useConfirm } from './ConfirmDialog';

const ALL_EVENTS = [
  { key: 'pieza_creada_revision', label: 'Pieza enviada a revisión' },
  { key: 'pieza_aprobada', label: 'Cliente aprueba una pieza' },
  { key: 'cambios_solicitados', label: 'Cliente solicita cambios' },
  { key: 'comentario_agregado', label: 'Se añade un comentario' },
  { key: 'fecha_cambiada', label: 'Cambia la fecha de publicación' },
  { key: 'pieza_programada', label: 'Pieza pasa a Programado' },
  { key: 'pieza_publicada', label: 'Pieza pasa a Publicado' },
];

export function WebhookSettings({ webhooks }: { webhooks: { id: string; name: string; url: string; active: boolean; events: string[] }[] }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [events, setEvents] = useState<string[]>(ALL_EVENTS.map((e) => e.key));
  const [error, setError] = useState<string | null>(null);

  function toggleEvent(key: string) {
    setEvents((prev) => (prev.includes(key) ? prev.filter((e) => e !== key) : [...prev, key]));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await saveWebhookConfig({ name, url, secret, events });
        setName('');
        setUrl('');
        setSecret('');
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo guardar el webhook.');
      }
    });
  }

  return (
    <div>
      {dialog}
      <ul className="mb-4 space-y-2">
        {webhooks.length === 0 && <p className="text-sm text-slate-400">Sin webhooks configurados.</p>}
        {webhooks.map((w) => (
          <li key={w.id} className="rounded-lg border border-slate-200 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-800">{w.name}</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => startTransition(async () => { await toggleWebhookConfig(w.id, !w.active); router.refresh(); })}
                  className={`rounded-full px-2 py-0.5 text-xs ${w.active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}
                >
                  {w.active ? 'Activo' : 'Pausado'}
                </button>
                <button
                  onClick={() =>
                    confirm({
                      title: 'Eliminar webhook',
                      description: 'Dejará de recibir eventos de esta aplicación.',
                      confirmLabel: 'Eliminar',
                      danger: true,
                      onConfirm: () => startTransition(async () => { await deleteWebhookConfig(w.id); router.refresh(); }),
                    })
                  }
                  className="text-xs text-red-500 hover:underline"
                >
                  Eliminar
                </button>
              </div>
            </div>
            <p className="mt-1 break-all text-xs text-slate-400">{w.url}</p>
          </li>
        ))}
      </ul>

      <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <input required placeholder="Nombre (ej. Make - Automatizaciones)" value={name} onChange={(e) => setName(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input required type="url" placeholder="URL del webhook de Make" value={url} onChange={(e) => setUrl(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <input
          required
          type="password"
          placeholder="Clave secreta (para firmar los envíos)"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">Eventos a enviar</p>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {ALL_EVENTS.map((ev) => (
              <label key={ev.key} className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={events.includes(ev.key)} onChange={() => toggleEvent(ev.key)} />
                {ev.label}
              </label>
            ))}
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={isPending} className="btn-primary">
          Guardar webhook
        </button>
      </form>
    </div>
  );
}
