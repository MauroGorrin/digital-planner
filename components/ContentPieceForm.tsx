'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Client, ContentFormat, ContentPiece, PlatformType, Profile } from '@/types/database';
import { FORMAT_LABELS, PLATFORM_LABELS } from '@/types/database';
import { createContentPiece, updateContentPiece } from '@/app/actions';
import { createContentPieces } from '@/app/actions-lote';
import { fechasRecurrentes } from '@/lib/recurrencia';
import { vincularIdeaAPieza } from '@/app/actions-ideas';
import { createClient } from '@/lib/supabase/client';
import {
  TAMANO_MAXIMO_BYTES,
  TIPOS_PERMITIDOS,
  formatearBytes,
  subirArchivoAPieza,
  validarArchivo,
} from '@/lib/attachments';

function toLocalInputValue(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ContentPieceForm({
  clients,
  team,
  defaultClientId,
  piece,
  ideaOrigen,
}: {
  clients: Client[];
  team: Profile[];
  defaultClientId?: string;
  piece?: ContentPiece;
  ideaOrigen?: {
    id: string;
    client_id: string;
    title: string;
    description: string;
    suggested_platform: PlatformType | null;
    suggested_format: ContentFormat | null;
  };
}) {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archivos, setArchivos] = useState<File[]>([]);
  const [progreso, setProgreso] = useState<{ nombre: string; porcentaje: number } | null>(null);
  // Se guarda el id en cuanto la pieza existe, para que un fallo de subida posterior pueda
  // ofrecer "Ir a la pieza" en vez de dejar al usuario sin saber que ya fue creada.
  const [piezaCreada, setPiezaCreada] = useState<string | null>(null);
  const [reintentandoVinculo, setReintentandoVinculo] = useState(false);
  const [clientId, setClientId] = useState(piece?.client_id ?? defaultClientId ?? clients[0]?.id ?? '');
  const [platform, setPlatform] = useState<PlatformType>(piece?.platform ?? ideaOrigen?.suggested_platform ?? 'instagram');
  const [contentFormat, setContentFormat] = useState<ContentFormat>(piece?.format ?? ideaOrigen?.suggested_format ?? 'post');
  const [title, setTitle] = useState(piece?.title ?? ideaOrigen?.title ?? '');
  const [copyText, setCopyText] = useState(piece?.copy_text ?? ideaOrigen?.description ?? '');
  const [referenceLink, setReferenceLink] = useState(piece?.reference_link ?? '');
  const [scheduledAt, setScheduledAt] = useState(toLocalInputValue(piece?.scheduled_at) || toLocalInputValue(new Date().toISOString()));
  const [assigneeId, setAssigneeId] = useState(piece?.assignee_id ?? '');

  // "Repetir esta pieza" solo tiene sentido al crear (nunca al editar, piece es undefined) y no se
  // ofrece junto a ideaOrigen: convertir una idea produce una pieza, no una serie, y combinar los
  // dos casos no lo pidió nadie -- se deja fuera a propósito.
  const [repetir, setRepetir] = useState(false);
  const [diasSeleccionados, setDiasSeleccionados] = useState<number[]>([]);
  const [cantidadDeRepeticiones, setCantidadDeRepeticiones] = useState(2);

  function alternarRepetir() {
    setRepetir((valor) => {
      const activando = !valor;
      // Al activar por primera vez, se marca el día de la fecha ya elegida -- es el día que la
      // persona ya escogió a propósito. No se vuelve a sincronizar después: si cambia la fecha con
      // "Repetir" ya activo, reescribirle los días marcados sería sorprender una elección propia.
      if (activando && diasSeleccionados.length === 0) {
        setDiasSeleccionados([new Date(scheduledAt).getDay()]);
      }
      return activando;
    });
  }

  const DIAS_DE_LA_SEMANA: { valor: number; etiqueta: string }[] = [
    { valor: 1, etiqueta: 'L' },
    { valor: 2, etiqueta: 'M' },
    { valor: 3, etiqueta: 'M' },
    { valor: 4, etiqueta: 'J' },
    { valor: 5, etiqueta: 'V' },
    { valor: 6, etiqueta: 'S' },
    { valor: 0, etiqueta: 'D' },
  ];

  function alternarDia(dia: number) {
    setDiasSeleccionados((dias) => (dias.includes(dia) ? dias.filter((d) => d !== dia) : [...dias, dia]));
  }

  const fechasDeLaSerie =
    repetir && scheduledAt && diasSeleccionados.length > 0
      ? fechasRecurrentes(new Date(scheduledAt), diasSeleccionados, cantidadDeRepeticiones)
      : [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId) {
      setError('Selecciona un cliente. Crea uno primero en la sección Clientes.');
      return;
    }
    // Se valida antes de crear nada. Si el archivo no pasa el tope o el tipo, no queremos dejar
    // una pieza vacía creada por un error que el navegador ya podía detectar sin tocar la red.
    for (const archivo of archivos) {
      const problema = validarArchivo(archivo);
      if (problema) {
        setError(problema);
        return;
      }
    }

    setLoading(true);
    setError(null);
    setPiezaCreada(null);
    try {
      const isoDate = new Date(scheduledAt).toISOString();
      if (piece) {
        await updateContentPiece(piece.id, {
          platform,
          format: contentFormat,
          title,
          copy_text: copyText,
          reference_link: referenceLink || null,
          scheduled_at: isoDate,
          assignee_id: assigneeId || null,
        });
        router.push(`/piezas/${piece.id}`);
      } else if (repetir && fechasDeLaSerie.length > 1) {
        // Serie recurrente: un ítem por fecha calculada, mismos campos salvo scheduled_at. Sin
        // adjuntos (ver el porqué en el spec) y sin vínculo de idea -- "Repetir" no se ofrece
        // junto a ideaOrigen (Step 3c).
        const items = fechasDeLaSerie.map((fecha) => ({
          client_id: clientId,
          platform,
          format: contentFormat,
          title,
          copy_text: copyText,
          reference_link: referenceLink || undefined,
          scheduled_at: fecha.toISOString(),
          assignee_id: assigneeId || undefined,
        }));
        const resultado = await createContentPieces(items);
        if (resultado.fallidas.length > 0) {
          setError(
            `Se crearon ${resultado.creadas.length} de ${items.length} piezas. ` +
              `Fallaron: ${resultado.fallidas.map((f) => f.mensaje).join('; ')}`
          );
          return;
        }
        router.push('/calendario');
      } else {
        const id = await createContentPiece({
          client_id: clientId,
          platform,
          format: contentFormat,
          title,
          copy_text: copyText,
          reference_link: referenceLink || undefined,
          scheduled_at: isoDate,
          assignee_id: assigneeId || undefined,
        });

        // A partir de acá la pieza ya existe y no se borra si algo posterior falla: volver a
        // pedirle al usuario el título, el copy y la fecha por un corte de red o un vínculo que
        // falla sería peor que dejarle un borrador al que puede volver desde su ficha.
        setPiezaCreada(id);

        if (ideaOrigen) {
          // El vínculo es una llamada barata y va antes de la subida (que puede tardar minutos y
          // fallar por la red): si fallara después, la pieza quedaría creada con la idea todavía en
          // "aprobada", ofreciendo convertirla otra vez y perdiendo el registro de su origen.
          await vincularIdeaAPieza(ideaOrigen.id, id);
        }

        if (archivos.length > 0) {
          const {
            data: { user },
          } = await supabase.auth.getUser();

          // De a uno, igual que en la ficha: varios videos en paralelo se estorban.
          for (const archivo of archivos) {
            setProgreso({ nombre: archivo.name, porcentaje: 0 });
            await subirArchivoAPieza({
              supabase,
              clientId,
              contentPieceId: id,
              file: archivo,
              uploadedBy: user?.id ?? null,
              onProgress: (porcentaje) => setProgreso({ nombre: archivo.name, porcentaje }),
            });
          }
        }

        router.push(`/piezas/${id}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ocurrió un error al guardar.');
    } finally {
      setLoading(false);
      setProgreso(null);
    }
  }

  // Reintenta solo el vínculo idea→pieza. Es seguro repetirlo: convert_idea_to_piece exige que la
  // idea siga en 'aprobada', así que si el vínculo ya se había hecho (y solo se perdió la
  // respuesta) o la idea cambió de estado por otro camino, la base de datos rechaza el reintento
  // con un mensaje claro en vez de crear una segunda pieza o corromper el estado.
  async function reintentarVinculo() {
    if (!piezaCreada || !ideaOrigen) return;
    setReintentandoVinculo(true);
    try {
      await vincularIdeaAPieza(ideaOrigen.id, piezaCreada);
      router.push(`/piezas/${piezaCreada}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ocurrió un error al vincular la idea con la pieza.');
    } finally {
      setReintentandoVinculo(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      {clients.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Aún no tienes clientes. Crea uno en la sección Clientes antes de planificar contenido.
        </p>
      )}
      {ideaOrigen && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Esta pieza viene de la idea «{ideaOrigen.title}»; su marca queda fija, tomada de esa idea.
        </p>
      )}
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Cliente / Marca</label>
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          disabled={!!piece || !!ideaOrigen}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
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
        <label className="mb-1 block text-sm font-medium text-slate-700">Título interno</label>
        <input
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ej. Lanzamiento colección primavera"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Copy / Texto</label>
        <textarea
          value={copyText}
          onChange={(e) => setCopyText(e.target.value)}
          rows={4}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Escribe el texto de la publicación…"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Fecha y hora</label>
          <input
            type="datetime-local"
            required
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Responsable interno</label>
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">Sin asignar</option>
            {team.map((t) => (
              <option key={t.id} value={t.id}>
                {t.full_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Enlace de referencia (opcional)</label>
        <input
          type="url"
          value={referenceLink ?? ''}
          onChange={(e) => setReferenceLink(e.target.value)}
          placeholder="https://…"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      {!piece && !ideaOrigen && (
        <div className="rounded-lg border border-slate-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={repetir} onChange={alternarRepetir} />
            Repetir esta pieza
          </label>
          {repetir && (
            <div className="mt-3 space-y-3">
              <div>
                <p className="mb-1 text-xs font-medium text-slate-600">Días de la semana</p>
                <div className="flex flex-wrap gap-1.5">
                  {DIAS_DE_LA_SEMANA.map((d) => (
                    <button
                      key={d.valor}
                      type="button"
                      onClick={() => alternarDia(d.valor)}
                      aria-pressed={diasSeleccionados.includes(d.valor)}
                      className={`h-8 w-8 rounded-full text-xs font-semibold ${
                        diasSeleccionados.includes(d.valor)
                          ? 'bg-brand-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {d.etiqueta}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="cantidad-de-repeticiones" className="mb-1 block text-xs font-medium text-slate-600">
                  ¿Cuántas veces?
                </label>
                <input
                  id="cantidad-de-repeticiones"
                  type="number"
                  min={1}
                  max={12}
                  value={cantidadDeRepeticiones}
                  onChange={(e) => setCantidadDeRepeticiones(Math.min(12, Math.max(1, Number(e.target.value) || 1)))}
                  className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                />
              </div>
              {fechasDeLaSerie.length > 0 && (
                <p className="text-xs text-slate-500">
                  Se crearán {fechasDeLaSerie.length} piezas:{' '}
                  {fechasDeLaSerie
                    .map((f) => f.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }))
                    .join(', ')}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {!piece && !repetir && (
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Archivos (opcional)
          </label>
          <input
            type="file"
            multiple
            accept={TIPOS_PERMITIDOS.join(',')}
            disabled={loading}
            onChange={(e) => setArchivos(Array.from(e.target.files ?? []))}
            className="w-full text-sm"
          />
          <p className="mt-1 text-xs text-slate-400">
            Hasta {formatearBytes(TAMANO_MAXIMO_BYTES)} por archivo. Puedes dejarlo vacío y subirlos
            después desde la ficha.
          </p>
        </div>
      )}

      {progreso && (
        <div>
          <p className="mb-1 truncate text-xs text-slate-500">
            Subiendo {progreso.nombre} — {progreso.porcentaje}%
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              role="progressbar"
              aria-valuenow={progreso.porcentaje}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-full bg-brand-600 transition-all"
              style={{ width: `${progreso.porcentaje}%` }}
            />
          </div>
        </div>
      )}

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {error && piezaCreada && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <p>La pieza sí se creó; lo que falló fue un paso posterior (el vínculo con la idea o la subida del archivo).</p>
          <div className="mt-1 flex flex-wrap gap-3">
            {ideaOrigen && (
              <button
                type="button"
                onClick={reintentarVinculo}
                disabled={reintentandoVinculo}
                className="font-medium underline disabled:opacity-60"
              >
                {reintentandoVinculo ? 'Reintentando…' : 'Reintentar vínculo con la idea'}
              </button>
            )}
            <button
              type="button"
              onClick={() => router.push(`/piezas/${piezaCreada}`)}
              className="font-medium underline"
            >
              Ir a la pieza para continuar desde ahí
            </button>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={() => router.back()} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
          Cancelar
        </button>
        <button
          type="submit"
          disabled={loading || clients.length === 0}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {loading ? 'Guardando…' : piece ? 'Guardar cambios' : 'Crear como borrador'}
        </button>
      </div>
    </form>
  );
}
