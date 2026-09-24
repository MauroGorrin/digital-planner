'use client';

import { useState } from 'react';

export function GoogleCalendarSettings({ connections }: { connections: { id: string; label: string; calendar_id: string }[] }) {
  const [label, setLabel] = useState('Calendario de la agencia');

  return (
    <div>
      <ul className="mb-3 space-y-1.5">
        {connections.length === 0 && <p className="text-sm text-slate-400">Sin calendarios conectados.</p>}
        {connections.map((c) => (
          <li key={c.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
            <span>
              {c.label} <span className="text-slate-400">· {c.calendar_id}</span>
            </span>
            <form action="/api/google-calendar/disconnect" method="post">
              <input type="hidden" name="id" value={c.id} />
              <button type="submit" className="text-xs text-red-500 hover:underline">
                Desconectar
              </button>
            </form>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Nombre para identificar el calendario"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <a href={`/api/google-calendar/connect?label=${encodeURIComponent(label)}`} className="btn-primary whitespace-nowrap text-center">
          Conectar con Google
        </a>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Requiere configurar <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> y <code>GOOGLE_REDIRECT_URI</code> en las variables de entorno.
      </p>
    </div>
  );
}
