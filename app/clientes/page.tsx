import Link from 'next/link';
import { requireAgency } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import type { Client } from '@/types/database';

export default async function ClientesPage() {
  const profile = await requireAgency();
  const supabase = await createClient();
  const { data: clients } = await supabase.from('clients').select('*').order('archived').order('name');

  const list = (clients ?? []) as Client[];

  return (
    <AppShell profile={profile}>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="eyebrow mb-1">Agencia</p>
          <h1 className="text-xl font-semibold text-slate-900">
            Tus <span className="title-accent">clientes</span>
          </h1>
        </div>
        {profile.role === 'agency_admin' && (
          <Link href="/clientes/nuevo" className="btn-primary">
            + Nuevo cliente
          </Link>
        )}
      </div>

      {list.length === 0 ? (
        <EmptyState
          title={profile.role === 'agency_admin' ? 'Aún no tienes clientes' : 'Todavía no tienes marcas asignadas'}
          description={
            profile.role === 'agency_admin'
              ? 'Crea tu primer cliente para empezar a planificar contenido y compartirlo con ellos.'
              : 'Pide a un administrador de tu agencia que te asigne una marca desde su ficha, en Ajustes.'
          }
          action={
            profile.role === 'agency_admin' ? (
              <Link href="/clientes/nuevo" className="btn-primary">
                + Nuevo cliente
              </Link>
            ) : undefined
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
