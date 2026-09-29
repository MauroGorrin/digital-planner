import { NextResponse, type NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createServiceClient } from '@/lib/supabase/server';
import { verificarAccesoAReporte } from '@/lib/reportes';
import { agregarMetricas, limitesDelMes } from '@/lib/metricas';
import { ReporteMetricasPdf } from '@/components/pdf/ReporteMetricasPdf';
import type { ClientPackage, ContentPiece } from '@/types/database';

// @react-pdf/renderer usa pdfkit por dentro (Node puro: fs, zlib), así que esta ruta necesita el
// runtime de Node y no el de Edge. Explícito por si el default del proyecto cambia algún día.
export const runtime = 'nodejs';

/**
 * PDF del mismo reporte de métricas que app/reportes/[clientId]/[anio]/[mes]/page.tsx -- mismo
 * control de acceso (verificarAccesoAReporte), misma ruta pública sin sesión (ver
 * lib/supabase/middleware.ts), mismos campos mínimos leídos con el cliente de servicio. La usan
 * los dos botones "Descargar PDF": el de /metricas (agencia) y el de /reportes/... (quien tenga
 * el link).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const acceso = verificarAccesoAReporte(
    searchParams.get('client') ?? '',
    searchParams.get('anio') ?? '',
    searchParams.get('mes') ?? '',
    searchParams.get('firma')
  );
  if (!acceso) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

  const supabase = createServiceClient();

  const { data: cliente } = await supabase
    .from('clients')
    .select('brand_name,timezone')
    .eq('id', acceso.clientId)
    .single();
  if (!cliente) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

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

  const buffer = await renderToBuffer(
    <ReporteMetricasPdf clientName={cliente.brand_name} anio={acceso.anio} mes={acceso.mes} filas={filas} />
  );

  const nombreDeArchivo = `reporte-${acceso.clientId}-${acceso.anio}-${String(acceso.mes).padStart(2, '0')}.pdf`;

  // BodyInit no acepta un Buffer de Node directamente (el tipo de @types/node no coincide con el
  // Uint8Array que pide la lib DOM), así que se envuelve -- Buffer YA ES un Uint8Array en runtime.
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      // "inline" y no "attachment": quien recibe el link por WhatsApp debe poder verlo directo en
      // el navegador, no forzosamente descargarlo -- el navegador sigue ofreciendo guardarlo.
      'Content-Disposition': `inline; filename="${nombreDeArchivo}"`,
    },
  });
}
