import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/AppShell';
import { PanelDeMetricas, type MarcaOpcion } from '@/components/PanelDeMetricas';
import { agregarMetricas, limitesDelMes, mesActualEn } from '@/lib/metricas';
import type { Client, ClientBillingMode, ClientPackage, ContentPiece } from '@/types/database';

type MarcaConTz = MarcaOpcion & { timezone: string; billing_mode: ClientBillingMode };

export default async function MetricasPage(props: {
  searchParams: Promise<{ client?: string; anio?: string; mes?: string }>;
}) {
  const searchParams = await props.searchParams;
  const profile = await requireProfile();
  const supabase = await createClient();
  const esAgencia = profile.role !== 'client';

  // Marcas disponibles para el selector. Para la agencia, todas las no archivadas -- puede leer
  // y editar cualquiera. Para el cliente, solo aquellas de las que es contacto: normalmente una,
  // pero si por error de datos fuera contacto de más de una, no le adivinamos cuál (spec,
  // sección "Dónde se ve") -- se lista y que elija. La RLS de `clients` y `client_contacts` es la
  // que de verdad decide qué filas llegan; esto solo evita ofrecer un selector con marcas ajenas.
  let marcas: MarcaConTz[];

  if (esAgencia) {
    const { data } = await supabase
      .from('clients')
      .select('id,name,brand_name,timezone,billing_mode')
      .eq('archived', false)
      .order('name');
    marcas = ((data ?? []) as Pick<Client, 'id' | 'name' | 'brand_name' | 'timezone' | 'billing_mode'>[]).map((c) => ({
      id: c.id,
      name: c.name,
      brand_name: c.brand_name,
      timezone: c.timezone,
      billing_mode: c.billing_mode,
    }));
  } else {
    const { data } = await supabase
      .from('client_contacts')
      .select('clients(id,name,brand_name,timezone,billing_mode)')
      .eq('profile_id', profile.id);
    marcas = ((data ?? []) as unknown as { clients: MarcaConTz | null }[])
      .map((fila) => fila.clients)
      .filter((c): c is MarcaConTz => c !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  if (marcas.length === 0) {
    return (
      <AppShell profile={profile}>
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Aún no tienes clientes. Crea uno en la sección Clientes antes de ver sus métricas.
        </p>
      </AppShell>
    );
  }

  const marcaSeleccionada = marcas.find((m) => m.id === searchParams.client) ?? marcas[0];

  // El mes por omision tambien es el de la marca, no el del servidor: en UTC ya puede ser el dia
  // 1 mientras en la zona de la marca sigue siendo el ultimo dia del mes anterior, y aterrizar en
  // un paquete vacio al abrir la pantalla seria el mismo error de zona que cuida limitesDelMes.
  const actual = mesActualEn(new Date(), marcaSeleccionada.timezone);
  const anio = Number(searchParams.anio) || actual.anio;
  const mesParam = Number(searchParams.mes);
  const mes = mesParam >= 1 && mesParam <= 12 ? mesParam : actual.mes;

  // El punto que motiva todo este módulo: los límites se calculan en la zona horaria de LA
  // MARCA, no la del servidor. Una pieza a las 23:00 del último día del mes en esa zona no debe
  // saltar al paquete del mes siguiente por comparar en UTC.
  const { inicio, finExclusivo } = limitesDelMes(anio, mes, marcaSeleccionada.timezone);

  const [{ data: piezas }, { data: paquete }] = await Promise.all([
    supabase
      .from('content_pieces')
      .select('format,status')
      .eq('client_id', marcaSeleccionada.id)
      .gte('scheduled_at', inicio)
      .lt('scheduled_at', finExclusivo),
    supabase.from('client_packages').select('format,monthly_quota').eq('client_id', marcaSeleccionada.id),
  ]);

  const filas = agregarMetricas(
    (piezas ?? []) as Pick<ContentPiece, 'format' | 'status'>[],
    (paquete ?? []) as Pick<ClientPackage, 'format' | 'monthly_quota'>[]
  );

  return (
    <AppShell profile={profile}>
      <PanelDeMetricas
        role={esAgencia ? 'agency' : 'client'}
        brands={marcas}
        selectedClientId={marcaSeleccionada.id}
        clientName={marcaSeleccionada.brand_name}
        billingMode={marcaSeleccionada.billing_mode}
        anio={anio}
        mes={mes}
        filas={filas}
        paquete={(paquete ?? []) as Pick<ClientPackage, 'format' | 'monthly_quota'>[]}
      />
    </AppShell>
  );
}
