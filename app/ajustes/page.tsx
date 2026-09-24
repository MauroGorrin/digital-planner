import { requireAgencyAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/AppShell';
import { WebhookSettings } from '@/components/WebhookSettings';
import { GoogleCalendarSettings } from '@/components/GoogleCalendarSettings';
import { TeamInvite } from '@/components/TeamInvite';
import type { Profile } from '@/types/database';

export default async function AjustesPage({ searchParams }: { searchParams: { error?: string; google?: string } }) {
  const profile = await requireAgencyAdmin();
  const supabase = createClient();

  const [{ data: webhooks }, { data: connections }, { data: team }] = await Promise.all([
    supabase.from('webhook_configs').select('id,name,url,active,events,created_at').order('created_at', { ascending: false }),
    supabase.from('google_calendar_connections').select('id,label,calendar_id,created_at').order('created_at', { ascending: false }),
    supabase.from('profiles').select('*').in('role', ['agency_admin', 'agency_member']).order('full_name'),
  ]);

  return (
    <AppShell profile={profile}>
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-xl font-semibold text-slate-900">Ajustes de la agencia</h1>

        {searchParams.error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">No se pudo completar la conexión: {searchParams.error}</p>
        )}
        {searchParams.google === 'conectado' && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">Calendario de Google conectado correctamente.</p>
        )}

        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-1 text-sm font-semibold text-slate-800">Equipo de la agencia</h2>
          <p className="mb-3 text-xs text-slate-500">Invita a nuevos miembros del equipo por correo.</p>
          <TeamInvite team={(team ?? []) as Profile[]} />
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-1 text-sm font-semibold text-slate-800">Google Calendar</h2>
          <p className="mb-3 text-xs text-slate-500">Conecta calendarios de Google para publicar eventos automáticamente al aprobar/programar contenido.</p>
          <GoogleCalendarSettings connections={connections ?? []} />
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-1 text-sm font-semibold text-slate-800">Automatización con Make (webhooks)</h2>
          <p className="mb-3 text-xs text-slate-500">
            Configura una URL de webhook y una clave secreta. La clave se usa para firmar cada envío (header{' '}
            <code className="rounded bg-slate-100 px-1">X-Planner-Signature</code>) y nunca se expone en el navegador.
          </p>
          <WebhookSettings webhooks={(webhooks ?? []) as any[]} />
        </section>
      </div>
    </AppShell>
  );
}
