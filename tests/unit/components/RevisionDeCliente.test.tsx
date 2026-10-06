import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RevisionDeCliente } from '@/components/RevisionDeCliente';
import type { VistaPieza } from '@/lib/grilla';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/app/actions', () => ({
  approvePiece: vi.fn(),
  requestPieceChanges: vi.fn(),
}));

function crearVista(overrides: Partial<VistaPieza> = {}): VistaPieza {
  return {
    id: 'pieza-1',
    client_id: 'cliente-1',
    client_slug: 'marca-uno',
    title: 'Lanzamiento de otoño',
    copy_text: 'Texto de la pieza',
    platform: 'instagram',
    format: 'post',
    scheduled_at: '2026-10-01T15:00:00.000Z',
    status: 'pendiente_revision',
    brand_name: 'Marca Uno',
    timezone: 'UTC',
    portadaUrl: null,
    portadaEsVideo: false,
    ...overrides,
  };
}

describe('RevisionDeCliente', () => {
  it('sin piezas pendientes no muestra nada', () => {
    const { container } = render(<RevisionDeCliente piezas={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('muestra el título con la cantidad y las acciones de aprobación por pieza', () => {
    const piezas = [
      crearVista({ id: 'a', platform: 'instagram' }),
      crearVista({ id: 'b', platform: 'tiktok', copy_text: 'Video de TikTok' }),
    ];

    render(<RevisionDeCliente piezas={piezas} />);

    expect(screen.getByText('Pendiente de tu aprobación (2)')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '✓ Aprobar' })).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: /Ver detalle completo/ })[0]).toHaveAttribute('href', '/piezas/a');
    expect(screen.getAllByRole('link', { name: /Ver detalle completo/ })[1]).toHaveAttribute('href', '/piezas/b');
  });

  it('cada pieza se ve con la tarjeta de su propia red', () => {
    const piezas = [crearVista({ id: 'a', platform: 'tiktok', copy_text: 'Video vertical' })];

    render(<RevisionDeCliente piezas={piezas} />);

    expect(screen.getByText(/Video vertical/)).toBeInTheDocument();
  });
});
