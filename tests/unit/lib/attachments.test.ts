import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  TAMANO_MAXIMO_BYTES,
  agruparPorRonda,
  formatearBytes,
  registrarAdjunto,
  subirConProgreso,
  validarArchivo,
} from '@/lib/attachments';
import type { ClienteAdjuntos } from '@/lib/attachments';
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

  it('no se cuelga si replaces_id apunta a un adjunto ausente del arreglo', () => {
    const rondas = agruparPorRonda([adjunto({ id: 'huerfano', replaces_id: 'no-esta-en-la-pieza' })]);

    expect(rondas).toHaveLength(1);
    expect(rondas[0].adjuntos.map((a) => a.vigente.id)).toEqual(['huerfano']);
    expect(rondas[0].adjuntos[0].reemplazados).toEqual([]);
  });
});

describe('registrarAdjunto', () => {
  function clienteFalso(errorDeInsert: { message: string } | null) {
    const insert = vi.fn().mockResolvedValue({ error: errorDeInsert });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ insert }));
    const storageFrom = vi.fn(() => ({ remove }));
    return {
      cliente: {
        from,
        storage: { from: storageFrom },
      },
      insert,
      remove,
      from,
      storageFrom,
    };
  }

  const base = {
    contentPieceId: 'pieza-1',
    filePath: 'cliente-1/pieza-1/reel.mp4',
    fileName: 'reel.mp4',
    fileType: 'video/mp4',
    fileSize: 2048,
    uploadedBy: 'usuario-1',
  };

  it('inserta la fila sin mandar review_round', async () => {
    const { cliente, insert, remove, from } = clienteFalso(null);

    await registrarAdjunto({ supabase: cliente, ...base });

    expect(from).toHaveBeenCalledWith('attachments');
    expect(insert).toHaveBeenCalledTimes(1);
    const fila = insert.mock.calls[0][0];
    expect(fila).toMatchObject({
      content_piece_id: 'pieza-1',
      file_path: 'cliente-1/pieza-1/reel.mp4',
      replaces_id: null,
    });
    expect(fila).not.toHaveProperty('review_round');
    expect(remove).not.toHaveBeenCalled();
  });

  it('propaga replaces_id cuando es una nueva version', async () => {
    const { cliente, insert } = clienteFalso(null);

    await registrarAdjunto({ supabase: cliente, ...base, replacesId: 'adjunto-viejo' });

    expect(insert.mock.calls[0][0].replaces_id).toBe('adjunto-viejo');
  });

  it('borra el objeto subido si falla el insert y avisa del error', async () => {
    const { cliente, remove, storageFrom } = clienteFalso({ message: 'violacion de RLS' });

    await expect(registrarAdjunto({ supabase: cliente, ...base })).rejects.toThrow(
      /violacion de RLS/
    );
    expect(storageFrom).toHaveBeenCalledWith('attachments');
    expect(remove).toHaveBeenCalledWith(['cliente-1/pieza-1/reel.mp4']);
  });

  function clienteConLimpieza(
    errorDeInsert: { message: string },
    remove: (rutas: string[]) => PromiseLike<{ error: { message: string } | null }>
  ): ClienteAdjuntos {
    return {
      from: () => ({ insert: vi.fn().mockResolvedValue({ error: errorDeInsert }) }),
      storage: { from: () => ({ remove }) },
    };
  }

  it('si la limpieza tambien falla, el mensaje nombra ambos motivos y la ruta', async () => {
    const remove = vi
      .fn<(rutas: string[]) => Promise<{ error: { message: string } | null }>>()
      .mockResolvedValue({ error: { message: 'sin permiso para borrar' } });
    const cliente = clienteConLimpieza({ message: 'violacion de RLS' }, remove);

    await expect(registrarAdjunto({ supabase: cliente, ...base })).rejects.toThrow(
      /violacion de RLS/
    );
    await expect(registrarAdjunto({ supabase: cliente, ...base })).rejects.toThrow(
      /sin permiso para borrar/
    );
    await expect(registrarAdjunto({ supabase: cliente, ...base })).rejects.toThrow(
      /cliente-1\/pieza-1\/reel\.mp4/
    );
  });

  it('si la limpieza rechaza en vez de resolver, no se pierde el error original del insert', async () => {
    const remove = vi
      .fn<(rutas: string[]) => Promise<{ error: { message: string } | null }>>()
      .mockRejectedValue(new Error('fetch failed'));
    const cliente = clienteConLimpieza({ message: 'violacion de RLS' }, remove);

    await expect(registrarAdjunto({ supabase: cliente, ...base })).rejects.toThrow(
      /violacion de RLS/
    );
  });

  it('si la limpieza falla con un mensaje vacio, igual reporta el fallo en vez del mensaje de exito', async () => {
    // Un error con message: '' es tan "hubo fallo" como cualquier otro. Si la implementación
    // usara ese string como bandera (truthy/falsy) en vez de un booleano explícito, este caso
    // caería silenciosamente al mensaje de "se registró bien" para un archivo que en realidad
    // quedó huérfano en el bucket.
    const remove = vi
      .fn<(rutas: string[]) => Promise<{ error: { message: string } | null }>>()
      .mockResolvedValue({ error: { message: '' } });
    const cliente = clienteConLimpieza({ message: 'violacion de RLS' }, remove);

    await expect(registrarAdjunto({ supabase: cliente, ...base })).rejects.toThrow(
      /tampoco se pudo limpiar/
    );
    await expect(registrarAdjunto({ supabase: cliente, ...base })).rejects.toThrow(
      /cliente-1\/pieza-1\/reel\.mp4/
    );
  });
});

describe('subirConProgreso', () => {
  /**
   * Doble de XMLHttpRequest que expone los mismos "hooks" (open, setRequestHeader,
   * upload.addEventListener, addEventListener, send) que usa la implementación, y deja
   * que la prueba dispare los eventos de progreso/load/error/abort a mano con los bytes
   * que quiera — así se puede afirmar que el porcentaje sale de loaded/total del evento,
   * no que onProgress simplemente fue llamado.
   */
  class FalsoXHR {
    static ultimaInstancia: FalsoXHR;

    metodo = '';
    url = '';
    cabeceras: Record<string, string> = {};
    status = 0;
    cuerpoEnviado: unknown = null;
    /** Si el código bajo prueba llamó a xhr.abort() (a diferencia de disparaAbort(), que
     * simula el evento nativo sin pasar por ese método — p. ej. un abort disparado por el
     * navegador mismo). */
    abortLlamado = false;
    private oyentesDeCarga = new Map<string, Array<(evento: unknown) => void>>();
    private oyentesDeSubida = new Map<string, Array<(evento: unknown) => void>>();

    upload = {
      addEventListener: (tipo: string, oyente: (evento: unknown) => void) => {
        const lista = this.oyentesDeSubida.get(tipo) ?? [];
        lista.push(oyente);
        this.oyentesDeSubida.set(tipo, lista);
      },
    };

    constructor() {
      FalsoXHR.ultimaInstancia = this;
    }

    open(metodo: string, url: string) {
      this.metodo = metodo;
      this.url = url;
    }

    setRequestHeader(nombre: string, valor: string) {
      this.cabeceras[nombre] = valor;
    }

    addEventListener(tipo: string, oyente: (evento: unknown) => void) {
      const lista = this.oyentesDeCarga.get(tipo) ?? [];
      lista.push(oyente);
      this.oyentesDeCarga.set(tipo, lista);
    }

    send(cuerpo: unknown) {
      this.cuerpoEnviado = cuerpo;
    }

    disparaProgreso(loaded: number, total: number, lengthComputable = true) {
      for (const oyente of this.oyentesDeSubida.get('progress') ?? []) {
        oyente({ lengthComputable, loaded, total });
      }
    }

    /** El cuerpo del request terminó de enviarse (xhr.upload 'load'), antes de la respuesta
     * del servidor — no confundir con disparaCarga(), que es la respuesta completa del xhr. */
    disparaCargaDeSubida() {
      for (const oyente of this.oyentesDeSubida.get('load') ?? []) oyente({});
    }

    disparaCarga(status: number) {
      this.status = status;
      for (const oyente of this.oyentesDeCarga.get('load') ?? []) oyente({});
    }

    disparaError() {
      for (const oyente of this.oyentesDeCarga.get('error') ?? []) oyente({});
    }

    disparaAbort() {
      for (const oyente of this.oyentesDeCarga.get('abort') ?? []) oyente({});
    }

    abort() {
      this.abortLlamado = true;
      this.disparaAbort();
    }
  }

  function instalarFalsoXHR() {
    vi.stubGlobal('XMLHttpRequest', FalsoXHR);
    return () => FalsoXHR.ultimaInstancia;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const archivo = new File(['contenido de prueba'], 'reel.mp4', { type: 'video/mp4' });

  it('calcula el porcentaje a partir de loaded/total del evento, no solo dispara onProgress', async () => {
    const obtenerXhr = instalarFalsoXHR();
    const porcentajes: number[] = [];

    const promesa = subirConProgreso({
      signedUrl: 'https://ejemplo.local/subir?token=abc',
      file: archivo,
      onProgress: (pct) => porcentajes.push(pct),
    });

    const xhr = obtenerXhr();
    // Bytes concretos, no fracciones redondas: si la implementación solo simulara progreso
    // (p. ej. incrementos fijos) estos porcentajes exactos no coincidirían.
    xhr.disparaProgreso(37, 200); // 18.5% -> redondea a 19
    xhr.disparaProgreso(150, 200); // 75%
    xhr.disparaProgreso(200, 200); // 100%
    xhr.disparaCarga(200);

    await promesa;

    expect(porcentajes).toEqual([19, 75, 100]);
  });

  it('ignora eventos de progreso sin longitud computable, en vez de inventar un porcentaje', async () => {
    const obtenerXhr = instalarFalsoXHR();
    const porcentajes: number[] = [];

    const promesa = subirConProgreso({
      signedUrl: 'https://ejemplo.local/subir?token=abc',
      file: archivo,
      onProgress: (pct) => porcentajes.push(pct),
    });

    const xhr = obtenerXhr();
    xhr.disparaProgreso(10, 0, false);
    xhr.disparaCarga(200);

    await promesa;

    expect(porcentajes).toEqual([]);
  });

  it('abre un PUT a la URL firmada y manda el content-type del archivo', () => {
    const obtenerXhr = instalarFalsoXHR();

    void subirConProgreso({
      signedUrl: 'https://ejemplo.local/subir?token=abc',
      file: archivo,
      onProgress: () => {},
    });

    const xhr = obtenerXhr();
    expect(xhr.metodo).toBe('PUT');
    expect(xhr.url).toBe('https://ejemplo.local/subir?token=abc');
    expect(xhr.cabeceras['content-type']).toBe('video/mp4');
    expect(xhr.cuerpoEnviado).toBe(archivo);

    xhr.disparaCarga(200);
  });

  it('resuelve cuando el status HTTP esta en el rango 2xx', async () => {
    const obtenerXhr = instalarFalsoXHR();
    const promesa = subirConProgreso({
      signedUrl: 'https://ejemplo.local/subir?token=abc',
      file: archivo,
      onProgress: () => {},
    });

    obtenerXhr().disparaCarga(204);

    await expect(promesa).resolves.toBeUndefined();
  });

  it('rechaza con un mensaje accionable en espanol si el status no es 2xx', async () => {
    const obtenerXhr = instalarFalsoXHR();
    const promesa = subirConProgreso({
      signedUrl: 'https://ejemplo.local/subir?token=abc',
      file: archivo,
      onProgress: () => {},
    });

    obtenerXhr().disparaCarga(500);

    await expect(promesa).rejects.toThrow(/500/);
  });

  it('rechaza con un mensaje en espanol si se corta la conexion', async () => {
    const obtenerXhr = instalarFalsoXHR();
    const promesa = subirConProgreso({
      signedUrl: 'https://ejemplo.local/subir?token=abc',
      file: archivo,
      onProgress: () => {},
    });

    obtenerXhr().disparaError();

    await expect(promesa).rejects.toThrow(/conexión|conexion/i);
  });

  it('rechaza con un mensaje en espanol si la subida se cancela', async () => {
    const obtenerXhr = instalarFalsoXHR();
    const promesa = subirConProgreso({
      signedUrl: 'https://ejemplo.local/subir?token=abc',
      file: archivo,
      onProgress: () => {},
    });

    obtenerXhr().disparaAbort();

    await expect(promesa).rejects.toThrow(/cancel/i);
  });

  describe('vigilante de estancamiento', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('aborta y rechaza con un mensaje de estancamiento si pasa el umbral sin ningun avance', async () => {
      vi.useFakeTimers();
      const obtenerXhr = instalarFalsoXHR();

      const promesa = subirConProgreso({
        signedUrl: 'https://ejemplo.local/subir?token=abc',
        file: archivo,
        onProgress: () => {},
      });
      // Se adjunta el manejador de rechazo ya, antes de avanzar el reloj falso: si se espera
      // a que la promesa ya haya rechazado para recién entonces encadenar `.rejects`, Node la
      // marca como "unhandled rejection" en el instante entre el reject() sincrónico del
      // temporizador y el await de esta prueba.
      const promesaRechazada = expect(promesa).rejects.toThrow(/estanc/i);
      const xhr = obtenerXhr();

      xhr.disparaProgreso(10, 200); // hay algo de avance...
      await vi.advanceTimersByTimeAsync(61_000); // ...y despues nada, por mas de 60s (el umbral)

      await promesaRechazada;
      expect(xhr.abortLlamado).toBe(true);
    });

    it('no aborta por estancamiento si el progreso llega espaciado, aunque el tiempo total supere el umbral varias veces', async () => {
      vi.useFakeTimers();
      const obtenerXhr = instalarFalsoXHR();

      const promesa = subirConProgreso({
        signedUrl: 'https://ejemplo.local/subir?token=abc',
        file: archivo,
        onProgress: () => {},
      });
      const xhr = obtenerXhr();

      // Cada intervalo entre eventos de progreso queda bien por debajo del umbral (60s), pero
      // la suma de los cinco (250s) lo supera varias veces. Si el arreglo fuera un tope de
      // tiempo total disfrazado de vigilante de estancamiento (p. ej. xhr.timeout), esta
      // prueba lo delataria: la subida sigue viva porque nunca deja de avanzar por más de 60s
      // seguidos.
      const intervalo = 50_000;
      for (let i = 1; i <= 5; i++) {
        await vi.advanceTimersByTimeAsync(intervalo);
        xhr.disparaProgreso(i * 40, 200);
      }
      xhr.disparaCarga(200);

      await expect(promesa).resolves.toBeUndefined();
      expect(xhr.abortLlamado).toBe(false);
    });

    it('no aborta por estancamiento si el cuerpo ya se envio y el servidor tarda en responder', async () => {
      vi.useFakeTimers();
      const obtenerXhr = instalarFalsoXHR();

      const promesa = subirConProgreso({
        signedUrl: 'https://ejemplo.local/subir?token=abc',
        file: archivo,
        onProgress: () => {},
      });
      const xhr = obtenerXhr();

      xhr.disparaProgreso(200, 200); // el cuerpo terminó de transferirse...
      xhr.disparaCargaDeSubida(); // ...y xhr.upload dispara 'load': ya no habrá más progreso.

      // El servidor tarda más de un minuto en finalizar el objeto (200 MB). Sin más eventos de
      // progreso que lo reinicien, un vigilante que siguiera armado abortaría acá una subida que
      // en realidad terminó bien.
      await vi.advanceTimersByTimeAsync(120_000);

      expect(xhr.abortLlamado).toBe(false);

      xhr.disparaCarga(200);
      await expect(promesa).resolves.toBeUndefined();
    });

    it('rechaza con un mensaje propio si el servidor nunca responde tras recibir el cuerpo completo', async () => {
      vi.useFakeTimers();
      const obtenerXhr = instalarFalsoXHR();

      const promesa = subirConProgreso({
        signedUrl: 'https://ejemplo.local/subir?token=abc',
        file: archivo,
        onProgress: () => {},
      });
      const promesaRechazada = expect(promesa).rejects.toThrow(/no confirmó/i);
      const xhr = obtenerXhr();

      xhr.disparaProgreso(200, 200);
      xhr.disparaCargaDeSubida(); // el cuerpo terminó de enviarse...

      // ...y el servidor jamás responde ni cierra el socket. Sin un tope propio para esta
      // espera, nada vuelve a dispararse acá y la promesa quedaría colgada para siempre.
      await vi.advanceTimersByTimeAsync(300_001);

      await promesaRechazada;
      expect(xhr.abortLlamado).toBe(true);
    });
  });
});
