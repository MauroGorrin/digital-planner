import { describe, expect, it, vi } from 'vitest';
import type { Attachment } from '@/types/database';
import { estaReemplazado, formatearSegundos, idDeVideo, saltarAlAdjunto, saltarAlSegundo } from '@/lib/comentarios';

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

  it('cae en los limites exactos de minuto y hora', () => {
    expect(formatearSegundos(60)).toBe('1:00');
    expect(formatearSegundos(3600)).toBe('1:00:00');
    expect(formatearSegundos(3601)).toBe('1:00:01');
  });

  it('trata un valor no finito como cero', () => {
    expect(formatearSegundos(NaN)).toBe('0:00');
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

  it('es falso cuando el attachmentId no esta en el arreglo', () => {
    expect(estaReemplazado('inexistente', [adjunto('v1'), adjunto('v2', 'v1')])).toBe(false);
  });
});

type VideoDoble = {
  readyState: number;
  currentTime: number;
  closest: ReturnType<typeof vi.fn>;
  scrollIntoView: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
};

function videoDoble(readyState = 1, padre: { open: boolean } | null = null): VideoDoble {
  return {
    readyState,
    currentTime: 0,
    closest: vi.fn(() => padre),
    scrollIntoView: vi.fn(),
    addEventListener: vi.fn(),
  };
}

describe('saltarAlSegundo', () => {
  it('mueve el reproductor cuando los metadatos ya estan cargados y devuelve true', () => {
    const video = videoDoble(1);
    const resultado = saltarAlSegundo(video as unknown as HTMLVideoElement, 42);

    expect(resultado).toBe(true);
    expect(video.currentTime).toBe(42);
    expect(video.scrollIntoView).toHaveBeenCalled();
    expect(video.addEventListener).not.toHaveBeenCalled();
  });

  it('espera a loadedmetadata cuando todavia no estan cargados', () => {
    const video = videoDoble(0);
    saltarAlSegundo(video as unknown as HTMLVideoElement, 42);

    // Sin metadatos, asignar currentTime no tiene efecto: hay que esperar.
    expect(video.currentTime).toBe(0);
    expect(video.addEventListener).toHaveBeenCalledWith(
      'loadedmetadata',
      expect.any(Function),
      { once: true }
    );

    // Al dispararse el evento, ahora si salta.
    const escucha = video.addEventListener.mock.calls[0][1] as () => void;
    escucha();
    expect(video.currentTime).toBe(42);
  });

  it('despliega el details que contenga al reproductor', () => {
    const padre = { open: false };
    const video = videoDoble(1, padre);
    saltarAlSegundo(video as unknown as HTMLVideoElement, 10);

    expect(video.closest).toHaveBeenCalledWith('details');
    expect(padre.open).toBe(true);
  });

  it('despliega todos los <details> ancestros, no solo el mas cercano', () => {
    // Reproduce el anidamiento real de AttachmentUploader: un <details> por ronda de revisión
    // y, dentro, otro <details> por historial de versiones de un adjunto. Antes del arreglo,
    // solo se desplegaba el más cercano (el historial) y el de la ronda seguía cerrado, así que
    // el scrollIntoView apuntaba a un elemento oculto.
    const rondaExterna: { open: boolean; parentElement: null } = { open: false, parentElement: null };
    const historialInterno = {
      open: false,
      parentElement: { closest: vi.fn(() => rondaExterna) },
    };
    const video = videoDoble(1, historialInterno);

    saltarAlSegundo(video as unknown as HTMLVideoElement, 10);

    expect(historialInterno.open).toBe(true);
    expect(rondaExterna.open).toBe(true);
  });

  it('no lanza y devuelve false cuando el reproductor no existe', () => {
    expect(() => saltarAlSegundo(null, 10)).not.toThrow();
    expect(saltarAlSegundo(null, 10)).toBe(false);
  });
});

describe('idDeVideo', () => {
  it('construye el id de DOM del <video> a partir del id del adjunto', () => {
    expect(idDeVideo('abc-123')).toBe('video-abc-123');
  });
});

describe('saltarAlAdjunto', () => {
  it('devuelve false cuando no hay ningun <video> con ese id en el documento', () => {
    expect(saltarAlAdjunto('no-existe-en-el-dom', 10)).toBe(false);
  });

  it('resuelve el <video> por id y salta cuando existe en el documento', () => {
    const video = document.createElement('video');
    video.id = idDeVideo('adjunto-1');
    // jsdom no implementa scrollIntoView; saltarAlSegundo lo llama siempre que hay reproductor.
    video.scrollIntoView = vi.fn();
    document.body.appendChild(video);

    try {
      expect(saltarAlAdjunto('adjunto-1', 5)).toBe(true);
    } finally {
      document.body.removeChild(video);
    }
  });
});
