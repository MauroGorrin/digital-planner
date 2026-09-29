import { notFound } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/server';
import { urlDelPdf, verificarAccesoAReporte } from '@/lib/reportes';
import { agregarMetricas, limitesDelMes } from '@/lib/metricas';
import { ReportePublico } from '@/components/ReportePublico';
import type { ClientBillingMode, ClientPackage, ContentPiece } from '@/types/database';

/**
 * Vista pública del reporte de métricas -- ruta sin sesión (lib/supabase/middleware.ts la lista
 * junto a /login y /registro). Nadie entra sin la firma exacta de la URL: verificarAccesoAReporte
 * (lib/reportes.ts) es el único control de acceso, así que lee con el cliente de SERVICIO (sin
 * sesión no hay RLS que aplicar) y por eso selecciona explícitamente los mismos campos mínimos
 * que ya usa app/metricas/page.tsx -- nunca más.
 */
export default async function ReportePage(props: {
  params: Promise<{ clientId: string; anio: string; mes: string }>;
  searchParams: Promise<{ firma?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;

  const acceso = verificarAccesoAReporte(params.clientId, params.anio, params.mes, searchParams.firma);
  if (!acceso) notFound();

  const supabase = createServiceClient();

  const { data: cliente } = await supabase
    .from('clients')
    .select('brand_name,timezone,billing_mode')
    .eq('id', acceso.clientId)
    .single();
  if (!cliente) notFound();

  const { inicio, finExclusivo } = limitesDelMes(acceso.anio, acceso.mes, cliente.timezone);

  const [{ data: piezas }, { data: paquete }] = await Promise.all([
    supabase
      .from('content_pieces')
      .select('format,status')
      .eq('client_id', acceso.clientId)
      .gte('scheduled_at', inicio)
      .lt('scheduled_at', finExclusivo),
    supabase.from('client_packages').select('format,monthly_quota').eq('client_id', acceso.clientId),
  ]);

  const filas = agregarMetricas(
    (piezas ?? []) as Pick<ContentPiece, 'format' | 'status'>[],
    (paquete ?? []) as Pick<ClientPackage, 'format' | 'monthly_quota'>[]
  );

  const billingMode = cliente.billing_mode as ClientBillingMode;
  const sinPaquete = billingMode !== 'libre' && (paquete ?? []).length === 0;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  return (
    <ReportePublico
      clientName={cliente.brand_name}
      billingMode={billingMode}
      anio={acceso.anio}
      mes={acceso.mes}
      filas={filas}
      sinPaquete={sinPaquete}
      linkDelPdf={urlDelPdf(baseUrl, acceso.clientId, acceso.anio, acceso.mes)}
    />
  );
}
