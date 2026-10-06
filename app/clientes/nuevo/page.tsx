import { requireAgencyAdmin } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { NewClientForm } from '@/components/NewClientForm';

export default async function NuevoClientePage() {
  // Solo administrador (0016): crear una marca y poder verla después van de la mano.
  const profile = await requireAgencyAdmin();
  return (
    <AppShell profile={profile}>
      <div className="mx-auto max-w-lg">
        <h1 className="mb-4 text-xl font-semibold text-slate-900">Nuevo cliente</h1>
        <NewClientForm />
      </div>
    </AppShell>
  );
}
