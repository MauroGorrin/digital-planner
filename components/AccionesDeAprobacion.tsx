'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useConfirm } from './ConfirmDialog';
import { approvePiece, requestPieceChanges } from '@/app/actions';

/**
 * Aprobar o pedir cambios para una pieza en `pendiente_revision`, directamente desde su tarjeta
 * en la grilla. Mismo par de acciones que ya existe en `components/ContentPieceDetail.tsx` --
 * `approvePiece` y `requestPieceChanges`, las mismas Server Actions, la misma RPC detrás -- esto
 * solo le da un segundo lugar desde donde llamarlas: viendo la pieza como se va a ver publicada,
 * en vez de en la ficha completa.
 */
export function AccionesDeAprobacion({ piezaId }: { piezaId: string }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [isPending, startTransition] = useTransition();
  const [nota, setNota] = useState('');
  const [mostrarCorreccion, setMostrarCorreccion] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ocurrió un error.');
      }
    });
  }

  return (
    <div className="mx-auto mt-2 w-full max-w-xl rounded-lg border border-brand-100 bg-brand-50/60 p-3">
      {dialog}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-700">Pendiente de tu aprobación</p>
        <Link href={`/piezas/${piezaId}`} className="text-xs text-brand-600 hover:underline">
          Ver detalle completo →
        </Link>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          disabled={isPending}
          onClick={() =>
            confirm({
              title: 'Aprobar pieza',
              description: 'Confirmas que el contenido está listo para publicarse tal como está.',
              confirmLabel: 'Aprobar',
              onConfirm: () => run(() => approvePiece(piezaId)),
            })
          }
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          ✓ Aprobar
        </button>
        <button
          onClick={() => setMostrarCorreccion((v) => !v)}
          className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-red-600 ring-1 ring-red-200 hover:bg-red-50"
        >
          Solicitar cambios
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {mostrarCorreccion && (
        <div className="mt-3 space-y-2">
          <textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Explica qué te gustaría modificar…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            rows={3}
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setMostrarCorreccion(false)} className="text-sm text-slate-500">
              Cerrar
            </button>
            <button
              disabled={!nota.trim() || isPending}
              onClick={() =>
                run(async () => {
                  await requestPieceChanges(piezaId, nota);
                  setNota('');
                  setMostrarCorreccion(false);
                })
              }
              className="rounded-lg bg-red-600 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              Enviar solicitud
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
