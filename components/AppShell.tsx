import Link from 'next/link';
import type { Profile } from '@/types/database';
import { NotificationBell } from './NotificationBell';
import { SignOutButton } from './SignOutButton';

const AGENCY_NAV = [
  { href: '/calendario', label: 'Calendario' },
  { href: '/pendientes', label: 'Pendientes' },
  { href: '/clientes', label: 'Clientes' },
  { href: '/ajustes', label: 'Ajustes' },
];

const CLIENT_NAV = [
  { href: '/calendario', label: 'Calendario' },
  { href: '/pendientes', label: 'Pendientes' },
];

export function AppShell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const nav = profile.role === 'client' ? CLIENT_NAV : AGENCY_NAV;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link href="/calendario" className="flex items-center gap-2 font-semibold text-slate-900">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm text-white">P</span>
              <span className="hidden sm:inline">Planner de Contenido</span>
            </Link>
            <nav className="hidden gap-1 md:flex">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell profileId={profile.id} />
            <div className="hidden items-center gap-2 border-l border-slate-200 pl-3 sm:flex">
              <div className="text-right leading-tight">
                <p className="text-sm font-medium text-slate-800">{profile.full_name}</p>
                <p className="text-xs text-slate-400">
                  {profile.role === 'agency_admin' ? 'Administrador' : profile.role === 'agency_member' ? 'Equipo' : 'Cliente'}
                </p>
              </div>
            </div>
            <SignOutButton />
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-2 py-1.5 md:hidden">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
