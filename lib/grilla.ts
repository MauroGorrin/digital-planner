import type { ContentFormat, ContentStatus, PlatformType } from '@/types/database';
import { PLATFORM_LABELS } from '@/types/database';

/** Una pieza lista para la grilla: datos de presentación más la portada ya firmada. */
export interface VistaPieza {
  id: string;
  client_id: string;
  /** Slug de la marca, para armar el enlace compartible. */
  client_slug: string;
  title: string;
  copy_text: string;
  platform: PlatformType;
  format: ContentFormat;
  scheduled_at: string;
  status: ContentStatus;
  brand_name: string;
  timezone: string;
  /** URL firmada de la portada, o null si la pieza no tiene adjuntos. */
  portadaUrl: string | null;
  /** True si la portada es un video: en la grilla se muestra un bloque con ▶, nunca un <video>. */
  portadaEsVideo: boolean;
}

export interface GrupoPlataforma {
  plataforma: PlatformType;
  piezas: VistaPieza[];
}

/**
 * Agrupa las piezas por plataforma. Sale en el orden del catálogo PLATFORM_LABELS, omite las
 * plataformas sin piezas, y conserva el orden original dentro de cada grupo.
 */
export function agruparPorPlataforma(piezas: VistaPieza[]): GrupoPlataforma[] {
  const porPlataforma = new Map<PlatformType, VistaPieza[]>();
  for (const pieza of piezas) {
    const lista = porPlataforma.get(pieza.platform) ?? [];
    lista.push(pieza);
    porPlataforma.set(pieza.platform, lista);
  }

  return (Object.keys(PLATFORM_LABELS) as PlatformType[])
    .filter((plataforma) => porPlataforma.has(plataforma))
    .map((plataforma) => ({ plataforma, piezas: porPlataforma.get(plataforma) ?? [] }));
}
