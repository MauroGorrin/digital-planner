import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/AppShell';
import { CalendarBoard } from '@/components/CalendarBoard';
import { getMonthGridRange, getWeekRange } from '@/lib/date-utils';
import { adjuntoDePortada } from '@/lib/attachments';
import type { Portada } from '@/components/TarjetaDePieza';
import type { Attachment, Client, ContentPiece } from '@/types/database';

export default async function CalendarioPage({
  searchParams,
}: {
  searchParams: { view?: string; date?: string };
}) {
  const profile = await requireProfile();
  const supabase = createClient();

  const view = searchParams.view === 'semana' ? 'semana' : 'mes';
  const anchor = searchParams.date ? new Date(searchParams.date) : new Date();
  const { start, end } = view === 'semana' ? getWeekRange(anchor) : getMonthGridRange(anchor);

  const [{ data: clients }, { data: pieces }] = await Promise.all([
    supabase.from('clients').select('id,name,brand_name,timezone,archived').eq('archived', false).order('name'),
    supabase
      .from('content_pieces')
      .select('*, clients(id,name,brand_name,timezone), assignee:profiles!content_pieces_assignee_id_fkey(id,full_name)')
      .gte('scheduled_at', start.toISOString())
      .lte('scheduled_at', end.toISOString())
      .order('scheduled_at'),
  ]);

  const listaPiezas = (pieces ?? []) as ContentPiece[];

  // Portadas para la tarjeta de vista previa: una consulta por los adjuntos de las piezas
  // visibles, y una sola llamada por lote para firmar las URLs de las que son imagen.
  //
  // Firmar no consume transferencia; descargar la imagen si. Y la imagen solo se descarga cuando
  // la tarjeta aparece, porque hasta entonces el <img> no existe en el DOM. Asi el trafico se
  // paga por lo que se mira, no por lo que se carga -- que importa con 10 GB al mes en el plan
  // gratuito de Supabase.
  const portadas: Record<string, Portada> = {};

  if (listaPiezas.length > 0) {
    const { data: adjuntos } = await supabase
      .from('attachments')
      .select('*')
      .in(
        'content_piece_id',
        listaPiezas.map((p) => p.id)
      );

    const porPieza = new Map<string, Attachment[]>();
    for (const adjunto of (adjuntos ?? []) as Attachment[]) {
      const lista = porPieza.get(adjunto.content_piece_id) ?? [];
      lista.push(adjunto);
      porPieza.set(adjunto.content_piece_id, lista);
    }

    const aFirmar: { pieceId: string; ruta: string }[] = [];
    for (const [pieceId, lista] of porPieza) {
      const portada = adjuntoDePortada(lista);
      if (!portada) continue;

      portadas[pieceId] = {
        fileName: portada.file_name,
        fileType: portada.file_type,
        url: null,
      };
      if (portada.file_type?.startsWith('image/')) {
        aFirmar.push({ pieceId, ruta: portada.file_path });
      }
    }

    if (aFirmar.length > 0) {
      const { data: firmadas } = await supabase.storage
        .from('attachments')
        .createSignedUrls(
          aFirmar.map((f) => f.ruta),
          3600
        );
      (firmadas ?? []).forEach((firmada, i) => {
        const destino = portadas[aFirmar[i].pieceId];
        if (destino && firmada.signedUrl) destino.url = firmada.signedUrl;
      });
    }
  }

  return (
    <AppShell profile={profile}>
      <CalendarBoard
        profile={profile}
        clients={(clients ?? []) as Client[]}
        pieces={listaPiezas}
        portadas={portadas}
        view={view}
        anchorDate={anchor.toISOString()}
      />
    </AppShell>
  );
}
