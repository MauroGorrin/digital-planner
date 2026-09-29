'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Client, ContentFormat, PlatformType } from '@/types/database';
import { FORMAT_LABELS, PLATFORM_LABELS } from '@/types/database';
import { createContentPieces } from '@/app/actions-lote';
import { createClient } from '@/lib/supabase/client';
import { fechaParaInputLocal } from '@/lib/date-utils';
import { TAMANO_MAXIMO_BYTES, TIPOS_PERMITIDOS, formatearBytes, subirArchivoAPieza, validarArchivo } from '@/lib/attachments';

const TOPE_DE_ARCHIVOS = 10;

interface FilaDeLote {
  archivo: File;
  title: string;
  copyText: string;
  scheduledAt: string;
}

type EstadoDeFila =
  | { tipo: 'pendiente' }
  | { tipo: 'creada'; id: string }
  // La pieza sí existe (por eso lleva `id`, igual que 'creada') pero subirle el archivo falló. Se
  // distingue de 'error' -- que significa que la pieza nunca se creó -- porque acá sí hay una
  // ficha a la que ir y el archivo se puede reintentar desde ahí; tratarla como 'error' escondería
  // el enlace y contradiría que la pieza es real.
  | { tipo: 'creada-sin-archivo'; id: string; mensaje: string }
  | { tipo: 'error'; mensaje: string };

/**
 * Carga múltiple: de una tanda de archivos (ej. una sesión de fotos) crea una pieza independiente
 * por archivo, con cliente/plataforma/formato compartidos y título/copy/fecha por fila.
 *
 * Sin link de referencia ni responsable aquí -- quien los necesite los agrega después editando esa
 * pieza. Una fila con diez campos ya es densa; recortar los dos menos usados es lo que la mantiene
 * legible. Ver docs/superpowers/specs/2026-09-29-creacion-rapida-de-piezas-design.md.
 */
export function ContentPiecesMultipleForm({
  clients,
  defaultClientId,
}: {
  clients: Client[];
  /** Mismo prop que ya existe en /piezas/nueva -- una marca preseleccionada por la URL (`?client=`). */
  defaultClientId?: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [clientId, setClientId] = useState(defaultClientId ?? clients[0]?.id ?? '');
  const [platform, setPlatform] = useState<PlatformType>('instagram');
  const [contentFormat, setContentFormat] = useState<ContentFormat>('post');
  const [filas, setFilas] = useState<FilaDeLote[]>([]);
  const [errorDeArchivos, setErrorDeArchivos] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [estados, setEstados] = useState<EstadoDeFila[]>([]);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);

  function elegirArchivos(lista: FileList | null) {
    const archivos = Array.from(lista ?? []);
    setErrorDeArchivos(null);
    setEstados([]);
    if (archivos.length === 0) {
      setFilas([]);
      return;
    }
    if (archivos.length > TOPE_DE_ARCHIVOS) {
      setErrorDeArchivos(`Elige hasta ${TOPE_DE_ARCHIVOS} archivos por tanda.`);
      setFilas([]);
      return;
    }
    for (const a of archivos) {
      const problema = validarArchivo(a);
      if (problema) {
        setErrorDeArchivos(problema);
        setFilas([]);
        return;
      }
    }
    setFilas(archivos.map((archivo) => ({ archivo, title: '', copyText: '', scheduledAt: fechaParaInputLocal() })));
  }

  function actualizarFila(indice: number, cambios: Partial<Omit<FilaDeLote, 'archivo'>>) {
    setFilas((previas) => previas.map((f, i) => (i === indice ? { ...f, ...cambios } : f)));
  }

  // scheduledAt entra a la condición: una fila con la fecha vacía (el campo se puede borrar a
  // mano, es un datetime-local sin `required`) no debe poder enviarse -- new Date('').toISOString()
  // lanza un RangeError, y validar acá evita llegar a ese estado en vez de recuperarse de él.
  const puedeEnviar =
    filas.length > 0 && filas.every((f) => f.title.trim().length > 0 && f.scheduledAt.trim().length > 0) && !!clientId;

  async function alEnviar(e: React.FormEvent) {
    e.preventDefault();
    if (!puedeEnviar) return;

    setEnviando(true);
    setErrorGeneral(null);
    setEstados(filas.map(() => ({ tipo: 'pendiente' })));

    try {
      // Construido DENTRO del try: new Date(f.scheduledAt).toISOString() lanza un RangeError con
      // una fecha vacía o inválida, y si eso pasara fuera del try (como pasaba antes) el `finally`
      // de abajo nunca correría -- `enviando` se quedaría en true para siempre, con el botón
      // trabado en "Creando…" sin ningún error visible. `puedeEnviar` ya debería evitar llegar
      // acá con una fecha vacía; esto es la red de seguridad si de todos modos se llega.
      const items = filas.map((f) => ({
        client_id: clientId,
        platform,
        format: contentFormat,
        title: f.title,
        copy_text: f.copyText,
        scheduled_at: new Date(f.scheduledAt).toISOString(),
      }));

      const resultado = await createContentPieces(items);
      const nuevosEstados: EstadoDeFila[] = filas.map(() => ({ tipo: 'pendiente' }));
      for (const f of resultado.fallidas) nuevosEstados[f.indice] = { tipo: 'error', mensaje: f.mensaje };
      for (const c of resultado.creadas) nuevosEstados[c.indice] = { tipo: 'creada', id: c.id };
      setEstados(nuevosEstados);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      for (const c of resultado.creadas) {
        try {
          await subirArchivoAPieza({
            supabase,
            clientId,
            contentPieceId: c.id,
            file: filas[c.indice].archivo,
            uploadedBy: user?.id ?? null,
            onProgress: () => {},
          });
        } catch (err) {
          // La pieza ya se creó (está en resultado.creadas); solo falló subirle el archivo. Se
          // refleja con su propio estado -- ni "creada" a secas (escondería que el archivo nunca
          // llegó) ni "error" (la pieza sí existe, y "error" acá significaría que nunca se creó) --
          // manteniendo el enlace a la ficha: el mismo criterio que ContentPieceForm usa para una
          // sola pieza, se puede subir el archivo después desde ahí.
          const mensaje = err instanceof Error ? err.message : 'No se pudo subir el archivo.';
          console.error('[ContentPiecesMultipleForm] no se pudo subir el archivo de la fila', c.indice, err);
          setEstados((previos) => previos.map((e, i) => (i === c.indice ? { tipo: 'creada-sin-archivo', id: c.id, mensaje } : e)));
        }
      }
    } catch (err) {
      setErrorGeneral(err instanceof Error ? err.message : 'No pudimos crear las piezas.');
    } finally {
      setEnviando(false);
    }
  }

  const yaHayResultado = estados.some((e) => e.tipo !== 'pendiente');

  return (
    <form onSubmit={alEnviar} className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      {clients.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Aún no tienes clientes. Crea uno en la sección Clientes antes de planificar contenido.
        </p>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Cliente / Marca</label>
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          required
        >
          <option value="" disabled>
            Selecciona un cliente
          </option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.brand_name} ({c.name})
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Plataforma</label>
          <select value={platform} onChange={(e) => setPlatform(e.target.value as PlatformType)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {Object.entries(PLATFORM_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Formato</label>
          <select value={contentFormat} onChange={(e) => setContentFormat(e.target.value as ContentFormat)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {Object.entries(FORMAT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Archivos (hasta {TOPE_DE_ARCHIVOS})</label>
        <input
          type="file"
          multiple
          accept={TIPOS_PERMITIDOS.join(',')}
          disabled={enviando}
          onChange={(e) => elegirArchivos(e.target.files)}
          className="w-full text-sm"
        />
        <p className="mt-1 text-xs text-slate-400">Hasta {formatearBytes(TAMANO_MAXIMO_BYTES)} por archivo.</p>
        {errorDeArchivos && <p className="mt-1 text-xs text-red-700">{errorDeArchivos}</p>}
      </div>

      {filas.length > 0 && (
        <div className="space-y-3">
          {filas.map((fila, i) => {
            const estado = estados[i];
            return (
              <div key={i} className="rounded-lg border border-slate-200 p-3">
                <p className="mb-2 truncate text-xs font-medium text-slate-500">{fila.archivo.name}</p>
                {estado?.tipo === 'creada' ? (
                  <p className="text-sm text-green-700">
                    ✓ Creada —{' '}
                    <Link href={`/piezas/${estado.id}`} className="font-medium underline">
                      Ver pieza
                    </Link>
                  </p>
                ) : estado?.tipo === 'creada-sin-archivo' ? (
                  <div className="text-sm text-amber-800">
                    <p>Pieza creada, pero no se pudo subir el archivo: {estado.mensaje} Puedes subirlo después desde la ficha.</p>
                    <Link href={`/piezas/${estado.id}`} className="font-medium underline">
                      Ver pieza
                    </Link>
                  </div>
                ) : estado?.tipo === 'error' ? (
                  <p className="text-sm text-red-700">{estado.mensaje}</p>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div>
                      <label htmlFor={`titulo-${i}`} className="mb-1 block text-xs font-medium text-slate-600">
                        Título
                      </label>
                      <input
                        id={`titulo-${i}`}
                        type="text"
                        required
                        disabled={enviando}
                        value={fila.title}
                        onChange={(e) => actualizarFila(i, { title: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label htmlFor={`copy-${i}`} className="mb-1 block text-xs font-medium text-slate-600">
                        Copy
                      </label>
                      <input
                        id={`copy-${i}`}
                        type="text"
                        disabled={enviando}
                        value={fila.copyText}
                        onChange={(e) => actualizarFila(i, { copyText: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label htmlFor={`fecha-${i}`} className="mb-1 block text-xs font-medium text-slate-600">
                        Fecha
                      </label>
                      <input
                        id={`fecha-${i}`}
                        type="datetime-local"
                        disabled={enviando}
                        value={fila.scheduledAt}
                        onChange={(e) => actualizarFila(i, { scheduledAt: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {errorGeneral && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorGeneral}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={() => router.back()} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
          {yaHayResultado ? 'Volver' : 'Cancelar'}
        </button>
        {!yaHayResultado && (
          <button
            type="submit"
            disabled={enviando || !puedeEnviar}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {enviando ? 'Creando…' : `Crear ${filas.length} piezas`}
          </button>
        )}
      </div>
    </form>
  );
}
