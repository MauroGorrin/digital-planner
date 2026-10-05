import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PreviewFacebook } from '@/components/platform-previews/PreviewFacebook';
import { PreviewGenerica } from '@/components/platform-previews/PreviewGenerica';
import { PreviewInstagram } from '@/components/platform-previews/PreviewInstagram';
import { PreviewLinkedIn } from '@/components/platform-previews/PreviewLinkedIn';
import { PreviewPinterest } from '@/components/platform-previews/PreviewPinterest';
import { PreviewTikTok } from '@/components/platform-previews/PreviewTikTok';
import { PreviewTwitterX } from '@/components/platform-previews/PreviewTwitterX';
import { PreviewYouTube } from '@/components/platform-previews/PreviewYouTube';
import type { PropsDePreview } from '@/components/platform-previews/types';
import type { VistaPieza } from '@/lib/grilla';

const VISTAS: [string, (props: PropsDePreview) => JSX.Element][] = [
  ['Instagram', PreviewInstagram],
  ['TikTok', PreviewTikTok],
  ['LinkedIn', PreviewLinkedIn],
  ['Facebook', PreviewFacebook],
  ['X', PreviewTwitterX],
  ['YouTube', PreviewYouTube],
  ['Pinterest', PreviewPinterest],
  ['Genérica', PreviewGenerica],
];

function crearVista(overrides: Partial<VistaPieza> = {}): VistaPieza {
  return {
    id: 'pieza-1',
    title: 'Lanzamiento de otoño',
    copy_text: 'Texto de la pieza',
    platform: 'instagram',
    format: 'reel',
    scheduled_at: '2026-10-01T15:00:00.000Z',
    status: 'aprobado',
    brand_name: 'Marca Uno',
    timezone: 'UTC',
    portadaUrl: 'https://example.test/firmada.jpg',
    portadaEsVideo: false,
    ...overrides,
  };
}

describe.each(VISTAS)('Preview de %s', (_nombre, Vista) => {
  it('muestra el título de la pieza (como texto o como alt de la portada)', () => {
    // Los feeds (LinkedIn, Facebook, X) muestran el copy, no el título: ahí el título llega
    // solo como alt de la imagen de portada.
    render(<Vista piezas={[crearVista()]} />);

    const visibleComoTexto = screen.queryByText('Lanzamiento de otoño');
    const visibleComoAlt = screen.queryByAltText('Lanzamiento de otoño');
    expect(visibleComoTexto ?? visibleComoAlt).not.toBeNull();
  });

  it('con portada nula muestra el bloque de respaldo y no renderiza ninguna imagen', () => {
    const { container } = render(<Vista piezas={[crearVista({ portadaUrl: null })]} />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.bg-slate-200')).not.toBeNull();
  });
});
