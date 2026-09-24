'use client';

import { useState } from 'react';

export function useConfirm() {
  const [state, setState] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    onConfirm: () => void;
    danger?: boolean;
  } | null>(null);

  function confirm(opts: { title: string; description: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void }) {
    setState({
      open: true,
      title: opts.title,
      description: opts.description,
      confirmLabel: opts.confirmLabel ?? 'Confirmar',
      onConfirm: opts.onConfirm,
      danger: opts.danger,
    });
  }

  const dialog = state?.open ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-semibold text-slate-900">{state.title}</h3>
        <p className="mt-1.5 text-sm text-slate-500">{state.description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={() => setState(null)}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancelar
          </button>
          <button
            onClick={() => {
              state.onConfirm();
              setState(null);
            }}
            className={`rounded-lg px-3.5 py-2 text-sm font-semibold text-white ${
              state.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-brand-600 hover:bg-brand-700'
            }`}
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, dialog };
}
