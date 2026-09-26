'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Client, ContentFormat, ContentPiece, PlatformType, Profile } from '@/types/database';
import { FORMAT_LABELS, PLATFORM_LABELS } from '@/types/database';
import { createContentPiece, updateContentPiece } from '@/app/actions';
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
}: {
  clients: Client[];
  team: Profile[];
  defaultClientId?: string;
  piece?: ContentPiece;
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
  const [clientId, setClientId] = useState(piece?.client_id ?? defaultClientId ?? clients[0]?.id ?? '');
  const [platform, setPlatform] = useState<PlatformType>(piece?.platform ?? 'instagram');
  const [contentFormat, setContentFormat] = useState<ContentFormat>(piece?.format ?? 'post');
  const [title, setTitle] = useState(piece?.title ?? '');
  const [copyText, setCopyText] = useState(piece?.copy_text ?? '');
  const [referenceLink, setReferenceLink] = useState(piece?.reference_link ?? '');
  const [scheduledAt, setScheduledAt] = useState(toLocalInputValue(piece?.scheduled_at) || toLocalInputValue(new Date().toISOString()));
  const [assigneeId, setAssigneeId] = useState(piece?.assignee_id ?? '');

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

        if (archivos.length > 0) {
          // A partir de acá la pieza ya existe y no se borra si la subida falla: volver a pedirle
          // al usuario el título, el copy y la fecha por un corte de red sería peor que dejarle un
          // borrador al que puede subirle el archivo desde su ficha.
          setPiezaCreada(id);

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

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
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
          disabled={!!piece}
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

      {!piece && (
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
          <p>La pieza sí se creó; lo que falló fue la subida del archivo.</p>
          <button
            type="button"
            onClick={() => router.push(`/piezas/${piezaCreada}`)}
            className="mt-1 font-medium underline"
          >
            Ir a la pieza para subirlo desde ahí
          </button>
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
