import { describe, expect, it } from 'vitest';

import {
  TAMANO_MAXIMO_BYTES,
  agruparPorRonda,
  formatearBytes,
  validarArchivo,
} from '@/lib/attachments';
import type { Attachment } from '@/types/database';

function adjunto(parcial: Partial<Attachment> & { id: string }): Attachment {
  return {
    content_piece_id: 'pieza-1',
    file_path: `ruta/${parcial.id}`,
    file_name: `${parcial.id}.mp4`,
    file_type: 'video/mp4',
    file_size: 1024,
    uploaded_by: 'usuario-1',
    replaces_id: null,
    review_round: 1,
    created_at: '2026-09-25T10:00:00.000Z',
    ...parcial,
  };
}

describe('validarArchivo', () => {
  it('acepta un video mp4 dentro del limite', () => {
    expect(validarArchivo({ name: 'reel.mp4', type: 'video/mp4', size: 1_000_000 })).toBeNull();
  });

  it('acepta un .mov de iPhone', () => {
    expect(validarArchivo({ name: 'reel.mov', type: 'video/quicktime', size: 1_000_000 })).toBeNull();
  });

  it('rechaza por tipo no permitido nombrando el archivo', () => {
    const mensaje = validarArchivo({ name: 'malo.zip', type: 'application/zip', size: 10 });
    expect(mensaje).toContain('malo.zip');
    expect(mensaje).toContain('no permitido');
  });

  it('rechaza por tamano indicando el peso real y el maximo', () => {
    const mensaje = validarArchivo({
      name: 'enorme.mp4',
      type: 'video/mp4',
      size: TAMANO_MAXIMO_BYTES + 1,
    });
    expect(mensaje).toContain('enorme.mp4');
    expect(mensaje).toContain('200');
  });
});

describe('formatearBytes', () => {
  it('usa la unidad legible mas cercana', () => {
    expect(formatearBytes(1024)).toBe('1.0 KB');
    expect(formatearBytes(209_715_200)).toBe('200.0 MB');
  });
});

describe('agruparPorRonda', () => {
  it('devuelve las rondas de la mas reciente a la mas vieja', () => {
    const rondas = agruparPorRonda([
      adjunto({ id: 'a', review_round: 1 }),
      adjunto({ id: 'b', review_round: 2 }),
    ]);
    expect(rondas.map((r) => r.ronda)).toEqual([2, 1]);
  });

  it('marca como vigente al que nadie reemplaza y pliega la cadena', () => {
    const rondas = agruparPorRonda([
      adjunto({ id: 'v1' }),
      adjunto({ id: 'v2', replaces_id: 'v1' }),
      adjunto({ id: 'v3', replaces_id: 'v2' }),
    ]);

    expect(rondas).toHaveLength(1);
    expect(rondas[0].adjuntos).toHaveLength(1);
    expect(rondas[0].adjuntos[0].vigente.id).toBe('v3');
    expect(rondas[0].adjuntos[0].reemplazados.map((a) => a.id)).toEqual(['v2', 'v1']);
  });

  it('mantiene como vigentes los adjuntos independientes de un carrusel', () => {
    const rondas = agruparPorRonda([
      adjunto({ id: 'img1' }),
      adjunto({ id: 'img2' }),
      adjunto({ id: 'img3' }),
    ]);
    expect(rondas[0].adjuntos.map((a) => a.vigente.id)).toEqual(['img1', 'img2', 'img3']);
  });

  it('no se cuelga si la cadena de reemplazos tuviera un ciclo', () => {
    const rondas = agruparPorRonda([
      adjunto({ id: 'x', replaces_id: 'y' }),
      adjunto({ id: 'y', replaces_id: 'x' }),
    ]);
    expect(rondas).toHaveLength(0);
  });

  it('devuelve una lista vacia si no hay adjuntos', () => {
    expect(agruparPorRonda([])).toEqual([]);
  });
});
