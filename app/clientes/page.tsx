import Link from 'next/link';
import { requireAgency } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import type { Client } from '@/types/database';

export default async function ClientesPage() {
  const profile = await requireAgency();
  const supabase = createClient();
  const { data: clients } = await supabase.from('clients').select('*').order('archived').order('name');

  const list = (clients ?? []) as Client[];

  return (
    <AppShell profile={profile}>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Clientes</h1>
        <Link href="/clientes/nuevo" className="btn-primary">
          + Nuevo cliente
        </Link>
      </div>

      {list.length === 0 ? (
        <EmptyState
          title="Aún no tienes clientes"
          description="Crea tu primer cliente para empezar a planificar contenido y compartirlo con ellos."
          action={
            <Link href="/clientes/nuevo" className="btn-primary">
              + Nuevo cliente
            </Link>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((c) => (
            <Link
              key={c.id}
              href={`/clientes/${c.id}`}
              className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-300 hover:shadow ${c.archived ? 'opacity-50' : ''}`}
            >
              <p className="font-semibold text-slate-900">{c.brand_name}</p>
              <p className="text-sm text-slate-500">{c.name}</p>
              <p className="mt-2 text-xs text-slate-400">Zona horaria: {c.timezone}</p>
              {c.archived && <p className="mt-1 text-xs font-medium text-amber-600">Archivado</p>}
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
