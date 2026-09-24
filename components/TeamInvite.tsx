'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Profile } from '@/types/database';
import { inviteUser } from '@/app/admin-actions';

export function TeamInvite({ team }: { team: Profile[] }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'agency_admin' | 'agency_member'>('agency_member');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await inviteUser({ email, full_name: fullName, role });
        setEmail('');
        setFullName('');
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo invitar.');
      }
    });
  }

  return (
    <div>
      <ul className="mb-3 space-y-1.5">
        {team.map((t) => (
          <li key={t.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
            <span>{t.full_name}</span>
            <span className="text-xs text-slate-400">{t.role === 'agency_admin' ? 'Administrador' : 'Equipo'}</span>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <input
          required
          placeholder="Nombre completo"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          required
          type="email"
          placeholder="correo@agencia.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <select value={role} onChange={(e) => setRole(e.target.value as any)} className="filter-select">
          <option value="agency_member">Equipo</option>
          <option value="agency_admin">Administrador</option>
        </select>
        <button type="submit" disabled={isPending} className="btn-primary whitespace-nowrap">
          Invitar
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
