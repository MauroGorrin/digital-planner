import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GrillaDeContenido } from '@/components/GrillaDeContenido';
import type { VistaPieza } from '@/lib/grilla';

function crearVista(overrides: Partial<VistaPieza> = {}): VistaPieza {
  return {
    id: 'pieza-1',
    client_id: 'cliente-1',
    title: 'Pieza de prueba',
    copy_text: 'Copy de prueba',
    platform: 'instagram',
    format: 'post',
    scheduled_at: '2026-10-01T15:00:00.000Z',
    status: 'programado',
    brand_name: 'Marca Uno',
    timezone: 'UTC',
    portadaUrl: null,
    portadaEsVideo: false,
    ...overrides,
  };
}

describe('GrillaDeContenido', () => {
  it('muestra "Todas" y un botón por cada plataforma que tiene piezas, con su cantidad', () => {
    const piezas = [
      crearVista({ id: 'a', platform: 'instagram' }),
      crearVista({ id: 'b', platform: 'instagram' }),
      crearVista({ id: 'c', platform: 'tiktok' }),
    ];

    render(<GrillaDeContenido piezas={piezas} />);

    expect(screen.getByRole('button', { name: /Todas \(3\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Instagram \(2\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /TikTok \(1\)/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /LinkedIn/ })).not.toBeInTheDocument();
  });

  it('al elegir una plataforma muestra solo sus piezas', () => {
    const piezas = [
      crearVista({ id: 'a', copy_text: 'Post en Instagram', platform: 'instagram' }),
      crearVista({ id: 'b', copy_text: 'Video en TikTok', platform: 'tiktok' }),
    ];

    render(<GrillaDeContenido piezas={piezas} />);
    expect(screen.getByText(/Post en Instagram/)).toBeInTheDocument();
    expect(screen.getByText(/Video en TikTok/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /TikTok/ }));

    expect(screen.queryByText('Post en Instagram')).not.toBeInTheDocument();
    expect(screen.getByText(/Video en TikTok/)).toBeInTheDocument();
  });

  it('sin piezas muestra el estado vacío', () => {
    render(<GrillaDeContenido piezas={[]} />);

    expect(screen.getByText('No hay contenido aprobado o programado todavía.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Todas/ })).not.toBeInTheDocument();
  });
});
