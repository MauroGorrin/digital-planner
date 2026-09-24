import Link from 'next/link';
import type { ContentPiece, Profile } from '@/types/database';
import { StatusBadge } from './StatusBadge';
import { PlatformBadge } from './PlatformBadge';
import { EmptyState } from './EmptyState';
import { formatDateTimeInTz } from '@/lib/tz';

export function PendingList({ profile, pieces }: { profile: Profile; pieces: ContentPiece[] }) {
  const now = Date.now();
  const needsAttention = pieces.filter((p) => p.status === 'pendiente_revision' || p.status === 'cambios_solicitados');
  const upcoming = pieces
    .filter((p) => p.status === 'aprobado' || p.status === 'programado')
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const overdue = upcoming.filter((p) => new Date(p.scheduled_at).getTime() < now);
  const onTrack = upcoming.filter((p) => new Date(p.scheduled_at).getTime() >= now);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Pendientes y vencimientos</h1>
        {profile.role !== 'client' && (
          <a href="/api/export/csv" className="btn-secondary">
            Exportar CSV
          </a>
        )}
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          {profile.role === 'client' ? 'Pendientes de tu revisión' : 'Pendientes de aprobación del cliente'} ({needsAttention.length})
        </h2>
        {needsAttention.length === 0 ? (
          <EmptyState title="Todo al día" description="No hay piezas esperando revisión o aprobación en este momento." />
        ) : (
          <PieceTable pieces={needsAttention} showClient={profile.role !== 'client'} />
        )}
      </section>

      {overdue.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-red-600">Vencidas / sin publicar ({overdue.length})</h2>
          <PieceTable pieces={overdue} showClient={profile.role !== 'client'} highlightOverdue />
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Próximas publicaciones aprobadas ({onTrack.length})</h2>
        {onTrack.length === 0 ? (
          <EmptyState title="Sin publicaciones programadas" description="Las piezas aprobadas y programadas aparecerán aquí." />
        ) : (
          <PieceTable pieces={onTrack} showClient={profile.role !== 'client'} />
        )}
      </section>
    </div>
  );
}

function PieceTable({ pieces, showClient, highlightOverdue }: { pieces: ContentPiece[]; showClient: boolean; highlightOverdue?: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2">Pieza</th>
            {showClient && <th className="px-4 py-2">Cliente</th>}
            <th className="px-4 py-2">Plataforma</th>
            <th className="px-4 py-2">Fecha</th>
            <th className="px-4 py-2">Estado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {pieces.map((p) => (
            <tr key={p.id} className="hover:bg-slate-50">
              <td className="px-4 py-2.5">
                <Link href={`/piezas/${p.id}`} className="font-medium text-brand-700 hover:underline">
                  {p.title}
                </Link>
              </td>
              {showClient && <td className="px-4 py-2.5 text-slate-600">{p.clients?.brand_name}</td>}
              <td className="px-4 py-2.5">
                <PlatformBadge platform={p.platform} format={p.format} />
              </td>
              <td className={`px-4 py-2.5 ${highlightOverdue ? 'font-medium text-red-600' : 'text-slate-600'}`}>
                {formatDateTimeInTz(p.scheduled_at, p.clients?.timezone ?? 'UTC')}
              </td>
              <td className="px-4 py-2.5">
                <StatusBadge status={p.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
