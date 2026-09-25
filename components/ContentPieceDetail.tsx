'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Attachment, Client, Comment, ContentPiece, Profile, StatusHistoryEntry } from '@/types/database';
import { FORMAT_LABELS, PLATFORM_LABELS, STATUS_LABELS } from '@/types/database';
import { StatusBadge } from './StatusBadge';
import { PlatformBadge } from './PlatformBadge';
import { AttachmentUploader } from './AttachmentUploader';
import { CommentThread } from './CommentThread';
import { useConfirm } from './ConfirmDialog';
import { formatDateTimeInTz } from '@/lib/tz';
import {
  approvePiece,
  cancelPiece,
  deleteContentPiece,
  duplicateContentPiece,
  markPiecePublished,
  markPieceScheduled,
  requestPieceChanges,
  submitForReview,
} from '@/app/actions';

export function ContentPieceDetail({
  profile,
  piece,
  attachments,
  urls,
  comments,
  history,
  isClientContact,
}: {
  profile: Profile;
  piece: ContentPiece & { clients: Client };
  attachments: Attachment[];
  urls: Record<string, string>;
  comments: Comment[];
  history: StatusHistoryEntry[];
  isClientContact: boolean;
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [isPending, startTransition] = useTransition();
  const [changesNote, setChangesNote] = useState('');
  const [showChangesBox, setShowChangesBox] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelBox, setShowCancelBox] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAgency = profile.role !== 'client';

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
    <div className="mx-auto max-w-4xl">
      {dialog}
      <div className="mb-4 flex items-center gap-2 text-sm text-slate-500">
        <Link href="/calendario" className="hover:underline">
          Calendario
        </Link>
        <span>/</span>
        <span className="text-slate-700">{piece.clients.brand_name}</span>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <PlatformBadge platform={piece.platform} format={piece.format} />
              <StatusBadge status={piece.status} />
            </div>
            <h1 className="text-xl font-semibold text-slate-900">{piece.title}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {piece.clients.brand_name} · {formatDateTimeInTz(piece.scheduled_at, piece.clients.timezone)} ({piece.clients.timezone})
            </p>
          </div>
          {isAgency && (
            <div className="flex flex-wrap gap-2">
              <Link href={`/piezas/${piece.id}/editar`} className="btn-secondary">
                Editar
              </Link>
              <button
                onClick={() =>
                  run(async () => {
                    const id = await duplicateContentPiece(piece.id);
                    router.push(`/piezas/${id}`);
                  })
                }
                className="btn-secondary"
              >
                Duplicar
              </button>
              <button
                onClick={() =>
                  confirm({
                    title: 'Eliminar pieza',
                    description: 'Esta acción no se puede deshacer. Se eliminará la pieza y sus adjuntos.',
                    confirmLabel: 'Eliminar',
                    danger: true,
                    onConfirm: () =>
                      run(async () => {
                        await deleteContentPiece(piece.id);
                        router.push('/calendario');
                      }),
                  })
                }
                className="btn-secondary text-red-600 hover:bg-red-50"
              >
                Eliminar
              </button>
            </div>
          )}
        </div>

        {piece.reference_link && (
          <a href={piece.reference_link} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
            Ver enlace de referencia ↗
          </a>
        )}

        <div className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
          {piece.copy_text || <span className="text-slate-400">Sin copy todavía.</span>}
        </div>

        {piece.assignee && <p className="mt-3 text-xs text-slate-500">Responsable interno: {piece.assignee.full_name}</p>}

        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {/* Flujo de estados para agencia */}
        {isAgency && (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            {piece.status === 'borrador' && (
              <button disabled={isPending} onClick={() => run(() => submitForReview(piece.id))} className="btn-primary">
                Enviar a revisión
              </button>
            )}
            {piece.status === 'cambios_solicitados' && (
              <button disabled={isPending} onClick={() => run(() => submitForReview(piece.id))} className="btn-primary">
                Reenviar a revisión
              </button>
            )}
            {piece.status === 'aprobado' && (
              <button disabled={isPending} onClick={() => run(() => markPieceScheduled(piece.id))} className="btn-primary">
                Marcar como programado
              </button>
            )}
            {piece.status === 'programado' && (
              <button disabled={isPending} onClick={() => run(() => markPiecePublished(piece.id))} className="btn-primary">
                Marcar como publicado
              </button>
            )}
            {piece.status !== 'cancelado' && piece.status !== 'publicado' && (
              <button
                onClick={() => setShowCancelBox((v) => !v)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100"
              >
                Cancelar pieza
              </button>
            )}
          </div>
        )}
        {showCancelBox && (
          <div className="mt-2 space-y-2 rounded-lg border border-slate-200 p-3">
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Motivo de la cancelación…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              rows={2}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCancelBox(false)} className="text-sm text-slate-500">
                Cerrar
              </button>
              <button
                disabled={!cancelReason.trim() || isPending}
                onClick={() =>
                  confirm({
                    title: 'Cancelar pieza',
                    description: 'El cliente y el equipo verán esta pieza como cancelada.',
                    confirmLabel: 'Sí, cancelar',
                    danger: true,
                    onConfirm: () => run(() => cancelPiece(piece.id, cancelReason)),
                  })
                }
                className="rounded-lg bg-red-600 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                Confirmar cancelación
              </button>
            </div>
          </div>
        )}

        {/* Flujo de aprobación para cliente */}
        {isClientContact && piece.status === 'pendiente_revision' && (
          <div className="mt-5 rounded-xl border border-brand-100 bg-brand-50/60 p-4">
            <p className="mb-3 text-sm font-medium text-slate-700">¿Apruebas esta pieza para publicarse?</p>
            <div className="flex flex-wrap gap-2">
              <button
                disabled={isPending}
                onClick={() =>
                  confirm({
                    title: 'Aprobar pieza',
                    description: 'Confirmas que el contenido está listo para publicarse tal como está.',
                    confirmLabel: 'Aprobar',
                    onConfirm: () => run(() => approvePiece(piece.id)),
                  })
                }
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                ✓ Aprobar
              </button>
              <button
                onClick={() => setShowChangesBox((v) => !v)}
                className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-red-600 ring-1 ring-red-200 hover:bg-red-50"
              >
                Solicitar cambios
              </button>
            </div>
            {showChangesBox && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={changesNote}
                  onChange={(e) => setChangesNote(e.target.value)}
                  placeholder="Explica qué te gustaría modificar…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  rows={3}
                />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowChangesBox(false)} className="text-sm text-slate-500">
                    Cerrar
                  </button>
                  <button
                    disabled={!changesNote.trim() || isPending}
                    onClick={() =>
                      run(async () => {
                        await requestPieceChanges(piece.id, changesNote);
                        setChangesNote('');
                        setShowChangesBox(false);
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
        )}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Archivos adjuntos</h2>
          <AttachmentUploader piece={piece} attachments={attachments} urls={urls} canManage={isAgency} />
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Historial de cambios</h2>
          <ul className="space-y-2 text-xs text-slate-500">
            {history.length === 0 && <li className="text-slate-400">Sin movimientos todavía.</li>}
            {history.map((h) => (
              <li key={h.id} className="border-l-2 border-slate-200 pl-3">
                <p className="font-medium text-slate-700">
                  {h.from_status ? `${STATUS_LABELS[h.from_status]} → ` : ''}
                  {STATUS_LABELS[h.to_status]}
                </p>
                {h.note && <p className="text-slate-500">{h.note}</p>}
                <p className="text-[11px] text-slate-400">
                  {h.changed_by_profile?.full_name ?? 'Sistema'} · {new Date(h.created_at).toLocaleString('es-MX')}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Comentarios</h2>
        <CommentThread pieceId={piece.id} comments={comments} profile={profile} />
      </div>
    </div>
  );
}
