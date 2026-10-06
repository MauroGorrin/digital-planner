import Link from 'next/link';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { GrillaDeContenido } from '@/components/GrillaDeContenido';
import { RevisionDeCliente } from '@/components/RevisionDeCliente';
import { BotonCopiarLink } from '@/components/BotonCopiarLink';
import { cargarVistasDeGrilla, ESTADOS_EN_GRILLA } from '@/lib/grilla-datos';
import { compartirReportesHabilitado } from '@/lib/reportes';
import { mesDePieza, tituloDelMes, urlDeLaGrilla } from '@/lib/grilla-compartir';
import type { ContentStatus } from '@/types/database';

interface ClienteDeGrilla {
  id: string;
  slug: string;
  marca: string;
}

export default async function GrillaPage(props: { searchParams: Promise<{ cliente?: string }> }) {
  const searchParams = await props.searchParams;
  const profile = await requireProfile();
  // Sesión, no servicio: la RLS decide qué piezas y marcas puede leer cada usuario -- desde 0016,
  // eso ya incluye que un agency_member solo vea las marcas que tiene asignadas.
  const supabase = await createClient();

  // Quién tiene cola de aprobación no lo decide el rol, sino `client_contacts`: un cliente real
  // siempre está ahí, y un `agency_admin` en "modo de prueba" (Ajustes) también -- las mismas
  // marcas que la RPC detrás de Aprobar/Pedir cambios ya exige. Sin ninguna fila, nadie tiene cola.
  const { data: misContactos } = await supabase.from('client_contacts').select('client_id').eq('profile_id', profile.id);
  const marcasDondeSoyContacto = new Set((misContactos ?? []).map((c) => c.client_id as string));

  // La ruta pública nunca ve nada en revisión. Aquí sí se amplía a `pendiente_revision` en cuanto
  // hay al menos una marca donde la sesión es contacto -- RLS igual solo entrega lo que cada quien
  // puede leer; lo que filtra `pendientesDeAprobar` más abajo es que además SEA su cola, no la de
  // una marca ajena que la agencia también puede ver por ser de su propia cartera.
  const estados: ContentStatus[] | undefined =
    marcasDondeSoyContacto.size > 0 ? [...ESTADOS_EN_GRILLA, 'pendiente_revision'] : undefined;
  const vistas = await cargarVistasDeGrilla(supabase, { orden: 'desc', estados });

  // Las marcas con contenido aquí, en el orden en que aparecen: una por `client_id`, sin repetir.
  const porCliente = new Map<string, ClienteDeGrilla>();
  for (const pieza of vistas) {
    if (!porCliente.has(pieza.client_id)) {
      porCliente.set(pieza.client_id, { id: pieza.client_id, slug: pieza.client_slug, marca: pieza.brand_name });
    }
  }
  const clientes = [...porCliente.values()].sort((a, b) => a.marca.localeCompare(b.marca, 'es'));
  const clienteActivo = clientes.find((c) => c.id === searchParams.cliente) ?? clientes[0] ?? null;
  const vistasDelCliente = clienteActivo ? vistas.filter((v) => v.client_id === clienteActivo.id) : [];

  const pendientesDeAprobar = vistasDelCliente.filter(
    (v) => v.status === 'pendiente_revision' && marcasDondeSoyContacto.has(v.client_id)
  );
  const vistasPublicables = vistasDelCliente.filter((v) => v.status !== 'pendiente_revision');

  // Un enlace por mes que tenga contenido público, solo de la marca que se está viendo. Nunca sale
  // de `pendiente_revision`: ese link lo puede abrir cualquiera que lo tenga, sin sesión.
  const meses = new Map<string, { slug: string; marca: string; anio: number; mes: number }>();
  for (const pieza of vistasPublicables) {
    const { anio, mes } = mesDePieza(pieza.scheduled_at, pieza.timezone);
    const clave = `${pieza.client_id}|${anio}|${mes}`;
    if (!meses.has(clave)) meses.set(clave, { slug: pieza.client_slug, marca: pieza.brand_name, anio, mes });
  }
  const enlaces = [...meses.values()].sort((a, b) => b.anio - a.anio || b.mes - a.mes);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const puedeCompartir = compartirReportesHabilitado();

  return (
    <AppShell profile={profile}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Grilla de contenido</h1>
        <p className="text-sm text-slate-500">
          {marcasDondeSoyContacto.size > 0
            ? 'Cómo se verá tu contenido en cada red. Lo pendiente de tu aprobación va primero.'
            : 'Cómo se verá el contenido aprobado o programado en cada red.'}
        </p>
      </div>

      {clientes.length === 0 ? (
        <EmptyState
          title="Nada que mostrar"
          description="No hay contenido aprobado, programado ni pendiente de revisión todavía en ninguna de tus marcas."
        />
      ) : (
        <>
          {clientes.length > 1 && (
            <div role="group" aria-label="Elegir marca" className="mb-4 flex flex-wrap gap-2">
              {clientes.map((c) => (
                <Link
                  key={c.id}
                  href={`/grilla?cliente=${c.id}`}
                  aria-current={clienteActivo?.id === c.id ? 'true' : undefined}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                    clienteActivo?.id === c.id
                      ? 'bg-ink-900 text-white'
                      : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {c.marca}
                </Link>
              ))}
            </div>
          )}

          <RevisionDeCliente piezas={pendientesDeAprobar} />

          {profile.role !== 'client' && enlaces.length > 0 && (
            <section aria-labelledby="compartir-grilla" className="card mb-6 space-y-3">
              <h2 id="compartir-grilla" className="text-base font-semibold text-slate-800">
                Compartir {clienteActivo?.marca ?? ''} con el cliente
              </h2>
              {puedeCompartir ? (
                <ul className="divide-y divide-slate-200">
                  {enlaces.map((enlace) => {
                    const url = urlDeLaGrilla(baseUrl, enlace.slug, enlace.anio, enlace.mes);
                    return (
                      <li key={url} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <p className="text-sm text-slate-500">{tituloDelMes(enlace.anio, enlace.mes)}</p>
                        <div className="flex gap-2">
                          <Link href={url} target="_blank" className="btn-secondary">
                            Ver presentación
                          </Link>
                          <BotonCopiarLink url={url} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">
                  Para generar enlaces compartibles hay que configurar REPORT_LINK_SECRET en el servidor.
                </p>
              )}
            </section>
          )}

          <GrillaDeContenido piezas={vistasPublicables} />
        </>
      )}
    </AppShell>
  );
}
