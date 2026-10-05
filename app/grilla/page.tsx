import Link from 'next/link';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/AppShell';
import { GrillaDeContenido } from '@/components/GrillaDeContenido';
import { BotonCopiarLink } from '@/components/BotonCopiarLink';
import { cargarVistasDeGrilla } from '@/lib/grilla-datos';
import { compartirReportesHabilitado } from '@/lib/reportes';
import { mesDePieza, tituloDelMes, urlDeLaGrilla } from '@/lib/grilla-compartir';

export default async function GrillaPage() {
  const profile = await requireProfile();
  // Sesión, no servicio: la RLS decide qué piezas y marcas puede leer cada usuario.
  const supabase = await createClient();
  const vistas = await cargarVistasDeGrilla(supabase, { orden: 'desc' });

  // Un enlace por marca y mes que tenga contenido público.
  const meses = new Map<string, { clientId: string; marca: string; anio: number; mes: number }>();
  for (const pieza of vistas) {
    const { anio, mes } = mesDePieza(pieza.scheduled_at, pieza.timezone);
    const clave = `${pieza.client_id}|${anio}|${mes}`;
    if (!meses.has(clave)) meses.set(clave, { clientId: pieza.client_id, marca: pieza.brand_name, anio, mes });
  }
  const enlaces = [...meses.values()].sort((a, b) => b.anio - a.anio || b.mes - a.mes);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const puedeCompartir = compartirReportesHabilitado();

  return (
    <AppShell profile={profile}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Grilla de contenido</h1>
        <p className="text-sm text-slate-500">Cómo se verá el contenido aprobado o programado en cada red.</p>
      </div>

      {enlaces.length > 0 && (
        <section aria-labelledby="compartir-grilla" className="card mb-6 space-y-3">
          <h2 id="compartir-grilla" className="text-base font-semibold text-slate-800">
            Compartir con el cliente
          </h2>
          {puedeCompartir ? (
            <ul className="divide-y divide-slate-200">
              {enlaces.map((enlace) => {
                const url = urlDeLaGrilla(baseUrl, enlace.clientId, enlace.anio, enlace.mes);
                return (
                  <li key={url} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="font-medium text-slate-900">{enlace.marca}</p>
                      <p className="text-sm text-slate-500">{tituloDelMes(enlace.anio, enlace.mes)}</p>
                    </div>
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

      <GrillaDeContenido piezas={vistas} />
    </AppShell>
  );
}
