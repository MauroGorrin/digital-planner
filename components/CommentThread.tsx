'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Comment, Profile } from '@/types/database';
import { addComment } from '@/app/actions';

function roleLabel(role?: string) {
  if (role === 'agency_admin') return 'Agencia · Admin';
  if (role === 'agency_member') return 'Agencia';
  if (role === 'client') return 'Cliente';
  return '';
}

export function CommentThread({ pieceId, comments, profile }: { pieceId: string; comments: Comment[]; profile: Profile }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (!body.trim()) return;
    startTransition(async () => {
      await addComment(pieceId, body, replyTo ?? undefined);
      setBody('');
      setReplyTo(null);
      router.refresh();
    });
  }

  return (
    <div>
      <div className="space-y-3">
        {comments.length === 0 && <p className="text-sm text-slate-400">Sé el primero en comentar.</p>}
        {comments.map((c) => (
          <div key={c.id} className={`rounded-lg p-3 ${c.parent_comment_id ? 'ml-6 bg-slate-50' : 'bg-slate-50'}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-800">{c.author?.full_name ?? 'Usuario'}</span>
              <span className="text-[11px] text-slate-400">{roleLabel(c.author?.role)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{c.body}</p>
            <div className="mt-1 flex items-center gap-3">
              <span className="text-[11px] text-slate-400">{new Date(c.created_at).toLocaleString('es-MX')}</span>
              <button onClick={() => setReplyTo(c.id)} className="text-[11px] font-medium text-brand-600 hover:underline">
                Responder
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3">
        {replyTo && (
          <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
            <span>Respondiendo comentario</span>
            <button onClick={() => setReplyTo(null)} className="text-slate-400 hover:underline">
              Cancelar
            </button>
          </div>
        )}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="Escribe un comentario…"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <div className="mt-2 flex justify-end">
          <button onClick={submit} disabled={isPending || !body.trim()} className="btn-primary">
            {isPending ? 'Enviando…' : 'Comentar'}
          </button>
        </div>
      </div>
    </div>
  );
}
