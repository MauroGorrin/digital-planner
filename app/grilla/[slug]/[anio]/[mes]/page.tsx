import { notFound } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/server';
import { GrillaDeContenido } from '@/components/GrillaDeContenido';
import { cargarVistasDeGrilla } from '@/lib/grilla-datos';
import { tituloDelMes, verificarAccesoAGrilla } from '@/lib/grilla-compartir';
import { limitesDelMes } from '@/lib/metricas';

/**
 * Presentación pública de la grilla de una marca en un mes -- ruta sin sesión (lib/supabase/middleware.ts
 * la lista junto a /reportes). La firma HMAC de la URL es el único control de acceso: sin ella,
 * notFound(). Lee con el cliente de servicio, así que solo selecciona lo que la presentación muestra.
 */
export default async function GrillaPublicaPage(props: {
  params: Promise<{ slug: string; anio: string; mes: string }>;
  searchParams: Promise<{ firma?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;

  const acceso = verificarAccesoAGrilla(params.slug, params.anio, params.mes, searchParams.firma);
  if (!acceso) notFound();

  const supabase = createServiceClient();

  const { data: cliente } = await supabase
    .from('clients')
    .select('id,brand_name,timezone')
    .eq('slug', acceso.slug)
    .single();
  if (!cliente) notFound();

  const { inicio, finExclusivo } = limitesDelMes(acceso.anio, acceso.mes, cliente.timezone);
  const piezas = await cargarVistasDeGrilla(supabase, {
    clientId: cliente.id,
    desde: inicio,
    hasta: finExclusivo,
    orden: 'asc',
  });

  const titulo = tituloDelMes(acceso.anio, acceso.mes);

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="bg-ink-900 px-4 py-10 text-white sm:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-sm uppercase tracking-widest text-slate-300">Plan de contenido</p>
          <h1 className="mt-2 text-3xl font-semibold">{cliente.brand_name}</h1>
          <p className="mt-1 text-lg text-slate-200">{titulo.charAt(0).toUpperCase() + titulo.slice(1)}</p>
          <p className="mt-4 text-sm text-slate-300">
            {piezas.length === 0
              ? 'Aún no hay contenido aprobado para este mes.'
              : `${piezas.length} ${piezas.length === 1 ? 'pieza aprobada o programada' : 'piezas aprobadas o programadas'}. Así se verá en cada red.`}
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
        <GrillaDeContenido piezas={piezas} />
      </div>

      <footer className="px-4 pb-10 text-center text-xs text-slate-400">
        Vista previa generada con digital-planner. Las publicaciones finales pueden variar ligeramente.
      </footer>
    </main>
  );
}
