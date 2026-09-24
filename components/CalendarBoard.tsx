'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { addDays, addMonths, addWeeks, format, isSameMonth, isToday } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Client, ContentPiece, ContentFormat, ContentStatus, PlatformType } from '@/types/database';
import { FORMAT_LABELS, PLATFORM_LABELS, STATUS_LABELS } from '@/types/database';
import { getDaysBetween, getMonthGridRange, getWeekRange, formatMonthTitle, formatWeekTitle } from '@/lib/date-utils';
import { formatTimeInTz, combineDateKeepTime } from '@/lib/tz';
import { PlatformDot } from './PlatformBadge';
import { StatusBadge } from './StatusBadge';
import { rescheduleContentPiece } from '@/app/actions';
import { EmptyState } from './EmptyState';
import type { Profile } from '@/types/database';

export function CalendarBoard({
  profile,
  clients,
  pieces,
  view,
  anchorDate,
}: {
  profile: Profile;
  clients: Client[];
  pieces: ContentPiece[];
  view: 'mes' | 'semana';
  anchorDate: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [clientFilter, setClientFilter] = useState('todos');
  const [platformFilter, setPlatformFilter] = useState('todas');
  const [formatFilter, setFormatFilter] = useState('todos');
  const [statusFilter, setStatusFilter] = useState('todos');
  const [dragId, setDragId] = useState<string | null>(null);
  const anchor = new Date(anchorDate);
  const canDrag = profile.role !== 'client';

  const filtered = useMemo(() => {
    return pieces.filter((p) => {
      if (clientFilter !== 'todos' && p.client_id !== clientFilter) return false;
      if (platformFilter !== 'todas' && p.platform !== platformFilter) return false;
      if (formatFilter !== 'todos' && p.format !== formatFilter) return false;
      if (statusFilter !== 'todos' && p.status !== statusFilter) return false;
      return true;
    });
  }, [pieces, clientFilter, platformFilter, formatFilter, statusFilter]);

  const { start, end } = view === 'semana' ? getWeekRange(anchor) : getMonthGridRange(anchor);
  const days = getDaysBetween(start, end);

  function piecesForDay(day: Date) {
    return filtered
      .filter((p) => format(new Date(p.scheduled_at), 'yyyy-MM-dd') === format(day, 'yyyy-MM-dd'))
      .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  }

  function navigate(nextView: 'mes' | 'semana', nextDate: Date) {
    router.push(`/calendario?view=${nextView === 'mes' ? 'mes' : 'semana'}&date=${format(nextDate, 'yyyy-MM-dd')}`);
  }

  function goToday() {
    navigate(view, new Date());
  }

  function goPrev() {
    navigate(view, view === 'mes' ? addMonths(anchor, -1) : addWeeks(anchor, -1));
  }

  function goNext() {
    navigate(view, view === 'mes' ? addMonths(anchor, 1) : addWeeks(anchor, 1));
  }

  function handleDrop(day: Date, piece: ContentPiece) {
    if (!canDrag) return;
    const clientTz = piece.clients?.timezone ?? 'UTC';
    const newDateStr = format(day, 'yyyy-MM-dd');
    const newIso = combineDateKeepTime(piece.scheduled_at, newDateStr, clientTz);
    startTransition(async () => {
      await rescheduleContentPiece(piece.id, newIso);
    });
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <button onClick={goPrev} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-600 hover:bg-slate-50">
            ‹
          </button>
          <button onClick={goToday} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
            Hoy
          </button>
          <button onClick={goNext} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-600 hover:bg-slate-50">
            ›
          </button>
          <h2 className="ml-2 text-lg font-semibold text-slate-900">
            {view === 'mes' ? formatMonthTitle(anchor) : formatWeekTitle(getWeekRange(anchor).start, getWeekRange(anchor).end)}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
            <button
              onClick={() => navigate('mes', anchor)}
              className={`rounded-md px-3 py-1.5 ${view === 'mes' ? 'bg-brand-600 text-white' : 'text-slate-600'}`}
            >
              Mes
            </button>
            <button
              onClick={() => navigate('semana', anchor)}
              className={`rounded-md px-3 py-1.5 ${view === 'semana' ? 'bg-brand-600 text-white' : 'text-slate-600'}`}
            >
              Semana
            </button>
          </div>
          {profile.role !== 'client' && (
            <Link
              href="/piezas/nueva"
              className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              + Nueva pieza
            </Link>
          )}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {profile.role !== 'client' && (
          <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className="filter-select">
            <option value="todos">Todos los clientes</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.brand_name}
              </option>
            ))}
          </select>
        )}
        <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)} className="filter-select">
          <option value="todas">Todas las plataformas</option>
          {Object.entries(PLATFORM_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select value={formatFilter} onChange={(e) => setFormatFilter(e.target.value)} className="filter-select">
          <option value="todos">Todos los formatos</option>
          {Object.entries(FORMAT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="filter-select">
          <option value="todos">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <Link href="/pendientes" className="ml-auto rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
          Ver pendientes y vencimientos →
        </Link>
      </div>

      {filtered.length === 0 && (
        <EmptyState
          title="No hay contenido en este rango"
          description="Ajusta los filtros o crea una nueva pieza para empezar a planificar."
        />
      )}

      {filtered.length > 0 && (
        <div
          className={`grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 ${
            view === 'mes' ? 'grid-cols-7' : 'grid-cols-1 sm:grid-cols-7'
          }`}
        >
          {view === 'mes' &&
            ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => (
              <div key={d} className="hidden bg-slate-50 px-2 py-1.5 text-center text-xs font-medium text-slate-500 sm:block">
                {d}
              </div>
            ))}
          {days.map((day) => {
            const dayPieces = piecesForDay(day);
            return (
              <div
                key={day.toISOString()}
                onDragOver={(e) => canDrag && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const piece = filtered.find((p) => p.id === dragId);
                  if (piece) handleDrop(day, piece);
                }}
                className={`min-h-[110px] bg-white p-1.5 ${view === 'mes' && !isSameMonth(day, anchor) ? 'bg-slate-50/60' : ''}`}
              >
                <div className="mb-1 flex items-center justify-between px-0.5">
                  <span className="text-[11px] text-slate-400 sm:hidden">{format(day, 'EEE d MMM', { locale: es })}</span>
                  <span
                    className={`hidden h-5 w-5 items-center justify-center rounded-full text-xs sm:flex ${
                      isToday(day) ? 'bg-brand-600 font-semibold text-white' : 'text-slate-500'
                    }`}
                  >
                    {format(day, 'd')}
                  </span>
                </div>
                <div className="space-y-1">
                  {dayPieces.map((piece) => (
                    <Link
                      key={piece.id}
                      href={`/piezas/${piece.id}`}
                      draggable={canDrag}
                      onDragStart={() => setDragId(piece.id)}
                      className="block rounded-md border border-slate-100 bg-slate-50 px-1.5 py-1 text-[11px] leading-tight hover:bg-slate-100"
                    >
                      <div className="flex items-center gap-1">
                        <PlatformDot platform={piece.platform} />
                        <span className="font-medium text-slate-700">{formatTimeInTz(piece.scheduled_at, piece.clients?.timezone ?? 'UTC')}</span>
                      </div>
                      <p className="truncate text-slate-600">{piece.title}</p>
                      {profile.role !== 'client' && <p className="truncate text-[10px] text-slate-400">{piece.clients?.brand_name}</p>}
                      <StatusBadge status={piece.status} className="mt-0.5 px-1.5 py-0.5 text-[9px]" />
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {isPending && <p className="mt-2 text-xs text-slate-400">Guardando cambios…</p>}
    </div>
  );
}
