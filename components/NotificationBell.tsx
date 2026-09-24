'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  content_piece_id: string | null;
  read_at: string | null;
  created_at: string;
}

export function NotificationBell({ profileId }: { profileId: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const supabase = createClient();

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('notifications')
      .select('id,title,body,content_piece_id,read_at,created_at')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .limit(20);
    setItems(data ?? []);
  }, [profileId, supabase]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('notifications-' + profileId)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `profile_id=eq.${profileId}` },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, profileId, supabase]);

  const unread = items.filter((i) => !i.read_at).length;

  async function markAllRead() {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('profile_id', profileId).is('read_at', null);
    load();
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
        aria-label="Notificaciones"
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 01-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 max-w-[90vw] rounded-xl bg-white p-2 shadow-lg ring-1 ring-slate-200">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-sm font-semibold text-slate-800">Notificaciones</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-brand-600 hover:underline">
                Marcar todo leído
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto scrollbar-thin">
            {items.length === 0 && <p className="px-2 py-6 text-center text-sm text-slate-400">Sin notificaciones</p>}
            {items.map((n) => (
              <Link
                key={n.id}
                href={n.content_piece_id ? `/piezas/${n.content_piece_id}` : '#'}
                onClick={() => setOpen(false)}
                className={`block rounded-lg px-3 py-2 text-sm hover:bg-slate-50 ${!n.read_at ? 'bg-brand-50/60' : ''}`}
              >
                <p className="font-medium text-slate-800">{n.title}</p>
                {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{n.body}</p>}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
