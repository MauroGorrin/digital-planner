import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth';
import { FORMAT_LABELS, PLATFORM_LABELS, STATUS_LABELS } from '@/types/database';

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

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
