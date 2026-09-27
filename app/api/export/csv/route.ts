import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth';
import { FORMAT_LABELS, PLATFORM_LABELS, STATUS_LABELS } from '@/types/database';
import { csvEscape } from '@/lib/csv';

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  // CN-028: la ruta comprobaba unicamente que hubiera sesion, asi que un contacto de cliente podia
  // llamarla aunque la interfaz solo le ofrezca el boton a la agencia (PendingList.tsx). No era una
  // fuga -- usa el cliente con RLS y content_pieces_select ya limita al cliente a su propia marca --
  // pero la ruta se apoyaba ENTERAMENTE en la RLS mientras la interfaz insinuaba que era solo de
  // agencia. El rol se comprueba aqui para que quien edite esto despues no herede una suposicion que
  // el codigo nunca hizo. La RLS sigue siendo la frontera de verdad; esto es intencion explicita.
  //
  // Es un 403 y no un redirect (requireAgency() redirige a '/'): esta ruta devuelve un archivo, y
  // contestar un HTML de redireccion a una peticion de descarga es un fallo confuso para un cliente
  // de API. El caso sin sesion lo ataja el middleware antes de llegar aqui, no el 401 de arriba.
  if (profile.role === 'client') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const supabase = createClient();
  const { data: pieces } = await supabase
    .from('content_pieces')
    .select('*, clients(name,brand_name,timezone)')
    .order('scheduled_at');

  const header = ['Cliente', 'Marca', 'Título', 'Plataforma', 'Formato', 'Fecha y hora', 'Estado', 'Copy', 'Enlace de referencia'];
  const rows = (pieces ?? []).map((p: any) => [
    p.clients?.name ?? '',
    p.clients?.brand_name ?? '',
    p.title,
    PLATFORM_LABELS[p.platform as keyof typeof PLATFORM_LABELS] ?? p.platform,
    FORMAT_LABELS[p.format as keyof typeof FORMAT_LABELS] ?? p.format,
    new Date(p.scheduled_at).toLocaleString('es-MX'),
    STATUS_LABELS[p.status as keyof typeof STATUS_LABELS] ?? p.status,
    p.copy_text ?? '',
    p.reference_link ?? '',
  ]);

  const csv = [header, ...rows].map((row) => row.map((v) => csvEscape(String(v ?? ''))).join(',')).join('\n');

  return new NextResponse('﻿' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="calendario-contenido-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
