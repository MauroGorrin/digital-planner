import type { ComponentType } from 'react';
import { PreviewFacebook } from '@/components/platform-previews/PreviewFacebook';
import { PreviewGenerica } from '@/components/platform-previews/PreviewGenerica';
import { PreviewInstagram } from '@/components/platform-previews/PreviewInstagram';
import { PreviewLinkedIn } from '@/components/platform-previews/PreviewLinkedIn';
import { PreviewPinterest } from '@/components/platform-previews/PreviewPinterest';
import { PreviewTikTok } from '@/components/platform-previews/PreviewTikTok';
import { PreviewTwitterX } from '@/components/platform-previews/PreviewTwitterX';
import { PreviewYouTube } from '@/components/platform-previews/PreviewYouTube';
import type { PropsDePreview } from '@/components/platform-previews/types';
import type { PlatformType } from '@/types/database';

/**
 * Único lugar donde cada plataforma se asocia con su vista. Lo usan `GrillaDeContenido` (el feed
 * agrupado) y `RevisionDeCliente` (una pieza a la vez, en la cola de aprobación) -- las dos
 * necesitan la misma tarjeta para la misma red, y duplicar el mapa es como se desincroniza.
 */
export const VISTA_POR_PLATAFORMA: Record<PlatformType, ComponentType<PropsDePreview>> = {
  instagram: PreviewInstagram,
  facebook: PreviewFacebook,
  tiktok: PreviewTikTok,
  linkedin: PreviewLinkedIn,
  twitter_x: PreviewTwitterX,
  youtube: PreviewYouTube,
  pinterest: PreviewPinterest,
  otra: PreviewGenerica,
};

/** El color de marca de cada red, para que elegirla se sienta como cambiar de feed y no de filtro. */
export const COLOR_DE_PLATAFORMA: Record<PlatformType, string> = {
  instagram: '#C1327A',
  facebook: '#1877F2',
  tiktok: '#000000',
  linkedin: '#0A66C2',
  twitter_x: '#000000',
  youtube: '#FF0000',
  pinterest: '#E60023',
  otra: '#334155',
};
