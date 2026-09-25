import { describe, expect, it } from 'vitest';
import type { Attachment } from '@/types/database';
import { estaReemplazado, formatearSegundos } from '@/lib/comentarios';

function adjunto(id: string, replacesId: string | null = null): Attachment {
  return {
    id,
    content_piece_id: 'pieza-1',
    file_path: `cliente-1/pieza-1/${id}.mp4`,
    file_name: `${id}.mp4`,
    file_type: 'video/mp4',
    file_size: 1024,
    uploaded_by: null,
    created_at: '2026-09-25T10:00:00Z',
    replaces_id: replacesId,
    review_round: 1,
  };
}

describe('formatearSegundos', () => {
  it('muestra minutos y segundos con dos digitos', () => {
    expect(formatearSegundos(12)).toBe('0:12');
    expect(formatearSegundos(65)).toBe('1:05');
    expect(formatearSegundos(0)).toBe('0:00');
  });

  it('agrega la hora solo cuando pasa de una hora', () => {
    expect(formatearSegundos(3903)).toBe('1:05:03');
    expect(formatearSegundos(3599)).toBe('59:59');
  });

  it('trunca decimales y trata un negativo como cero', () => {
    expect(formatearSegundos(12.9)).toBe('0:12');
    expect(formatearSegundos(-5)).toBe('0:00');
  });
});

describe('estaReemplazado', () => {
  it('es verdadero cuando otro adjunto lo declara en replaces_id', () => {
    const lista = [adjunto('v1'), adjunto('v2', 'v1')];
    expect(estaReemplazado('v1', lista)).toBe(true);
  });

  it('es falso para el adjunto vigente', () => {
    const lista = [adjunto('v1'), adjunto('v2', 'v1')];
    expect(estaReemplazado('v2', lista)).toBe(false);
  });

  it('es falso cuando no hay reemplazos', () => {
    expect(estaReemplazado('suelto', [adjunto('suelto')])).toBe(false);
  });
});
