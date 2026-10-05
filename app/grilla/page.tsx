import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/AppShell';
import { GrillaDeContenido } from '@/components/GrillaDeContenido';
import { adjuntoDePortada } from '@/lib/attachments';
import type { VistaPieza } from '@/lib/grilla';
import type { Attachment, ContentPiece } from '@/types/database';

/** Solo estados públicos para la grilla. Nunca aparecen aquí los de revisión. */
const ESTADOS_EN_GRILLA = ['aprobado', 'programado', 'publicado'];

type Cliente = { brand_name: string; timezone: string };

type FilaPieza = Pick<
  ContentPiece,
  'id' | 'platform' | 'format' | 'title' | 'copy_text' | 'scheduled_at' | 'status'
> & { clients: Cliente | Cliente[] | null };

export default async function GrillaPage() {
  const profile = await requireProfile();
  // Sesión, no servicio: la RLS decide qué piezas y marcas puede leer cada usuario.
  const supabase = await createClient();

  const { data: filas } = await supabase
    .from('content_pieces')
    .select('id,client_id,platform,format,title,copy_text,scheduled_at,status,clients(brand_name,timezone)')
    .in('status', ESTADOS_EN_GRILLA)
    .order('scheduled_at', { ascending: false });

  const piezas = (filas ?? []) as FilaPieza[];
  const ids = piezas.map((p) => p.id);

  const porPieza = new Map<string, Attachment[]>();
  if (ids.length > 0) {
    const { data: adjuntos } = await supabase.from('attachments').select('*').in('content_piece_id', ids);
    for (const adjunto of (adjuntos ?? []) as Attachment[]) {
      const lista = porPieza.get(adjunto.content_piece_id) ?? [];
      lista.push(adjunto);
      porPieza.set(adjunto.content_piece_id, lista);
    }
  }

  const portadas = new Map<string, Attachment>();
  for (const [pieceId, lista] of porPieza) {
    const portada = adjuntoDePortada(lista);
    if (portada) portadas.set(pieceId, portada);
  }

  // Una sola llamada para firmar todas las portadas.
  const urlsFirmadas: Record<string, string> = {};
  const conPortada = [...portadas.entries()];
  if (conPortada.length > 0) {
    const { data: firmadas } = await supabase.storage
      .from('attachments')
      .createSignedUrls(
        conPortada.map(([, portada]) => portada.file_path),
        3600
      );
    (firmadas ?? []).forEach((firmada, i) => {
      if (firmada.signedUrl) urlsFirmadas[conPortada[i][0]] = firmada.signedUrl;
    });
  }

  const vistas: VistaPieza[] = piezas.map((fila) => {
    const cliente = Array.isArray(fila.clients) ? fila.clients[0] : fila.clients;
    const portada = portadas.get(fila.id) ?? null;
    const esVideo = portada?.file_type?.startsWith('video/') ?? false;
    return {
      id: fila.id,
      title: fila.title,
      copy_text: fila.copy_text,
      platform: fila.platform,
      format: fila.format,
      scheduled_at: fila.scheduled_at,
      status: fila.status,
      brand_name: cliente?.brand_name ?? '',
      timezone: cliente?.timezone ?? 'UTC',
      portadaUrl: esVideo ? null : (urlsFirmadas[fila.id] ?? null),
      portadaEsVideo: esVideo,
    };
  });

  return (
    <AppShell profile={profile}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Grilla de contenido</h1>
        <p className="text-sm text-slate-500">Cómo se verá el contenido aprobado o programado en cada red.</p>
      </div>
      <GrillaDeContenido piezas={vistas} />
    </AppShell>
  );
}
