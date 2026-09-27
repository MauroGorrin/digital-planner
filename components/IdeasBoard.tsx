'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Client, Idea, IdeaStatus, IdeaStatusHistoryEntry, Profile } from '@/types/database';
import { FORMAT_LABELS, IDEA_STATUS_LABELS, PLATFORM_LABELS } from '@/types/database';
import { accionesDisponibles, type AccionDeIdea } from '@/lib/ideas';
import { urlSegura } from '@/lib/url-segura';
import {
  aprobarIdea,
  descartarIdea,
  enviarIdeaAlCliente,
  pedirCorreccionDelCliente,
  pedirCorreccionInterna,
  reenviarIdea,
} from '@/app/actions-ideas';
import { EmptyState } from './EmptyState';
import { NuevaIdeaForm } from './NuevaIdeaForm';

const ORDEN_ESTADOS: IdeaStatus[] = [
  'propuesta',
  'correccion_interna',
  'pendiente_cliente',
  'correccion_cliente',
  'aprobada',
  'convertida',
  'descartada',
];

const ACCIONES_CON_NOTA: AccionDeIdea[] = [
  'pedir_correccion_interna',
  'pedir_correccion_cliente',
  'descartar',
];

const ETIQUETAS: Record<AccionDeIdea, string> = {
  enviar_al_cliente: 'Enviar al cliente',
  pedir_correccion_interna: 'Pedir corrección',
  aprobar: 'Aprobar',
  pedir_correccion_cliente: 'Pedir cambios',
  reenviar: 'Reenviar',
  convertir: 'Crear pieza desde esta idea',
  descartar: 'Descartar',
};

function omitirClave<T>(registro: Record<string, T>, clave: string): Record<string, T> {
  if (!(clave in registro)) return registro;
  const copia = { ...registro };
  delete copia[clave];
  return copia;
}

export function IdeasBoard({
  profile,
  ideas,
  clients,
  marcasDondeEsContacto,
  historialPorIdea,
}: {
  profile: Profile;
  ideas: Idea[];
  clients: Client[];
  marcasDondeEsContacto: string[];
  historialPorIdea: Record<string, IdeaStatusHistoryEntry[]>;
}) {
  const router = useRouter();
  const esAgencia = profile.role !== 'client';
  const marcasSet = new Set(marcasDondeEsContacto);

  // Que idea (y con que accion) tiene abierto el campo de nota. Solo una a la vez: al abrir una
  // nueva se descarta la anterior, asi que no hace falta limpiar nada mas.
  const [accionAbierta, setAccionAbierta] = useState<{ ideaId: string; accion: AccionDeIdea } | null>(null);
  const [notas, setNotas] = useState<Record<string, string>>({});
  // Id de la idea con una accion en vuelo. Mientras este puesto, los botones de esa tarjeta se
  // deshabilitan: evita que un segundo clic dispare una segunda transicion sobre la misma idea.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});

  async function ejecutar(accion: AccionDeIdea, idea: Idea, nota: string) {
    switch (accion) {
      case 'enviar_al_cliente':
        return enviarIdeaAlCliente(idea.id);
      case 'pedir_correccion_interna':
        return pedirCorreccionInterna(idea.id, nota);
      case 'aprobar':
        return aprobarIdea(idea.id);
      case 'pedir_correccion_cliente':
        return pedirCorreccionDelCliente(idea.id, nota);
      case 'reenviar':
        return reenviarIdea(idea.id);
      case 'descartar':
        return descartarIdea(idea.id, nota);
      case 'convertir':
        router.push(`/piezas/nueva?idea=${idea.id}`);
        return;
    }
  }

  async function handleAccion(accion: AccionDeIdea, idea: Idea) {
    if (pendingId) return;
    const nota = notas[idea.id]?.trim() ?? '';
    if (ACCIONES_CON_NOTA.includes(accion) && !nota) return;

    setPendingId(idea.id);
    setErrores((prev) => omitirClave(prev, idea.id));
    try {
      await ejecutar(accion, idea, nota);
      setAccionAbierta(null);
      setNotas((prev) => omitirClave(prev, idea.id));
      if (accion !== 'convertir') router.refresh();
    } catch (err) {
      setErrores((prev) => ({
        ...prev,
        [idea.id]: err instanceof Error ? err.message : 'Ocurrió un error al procesar la acción.',
      }));
    } finally {
      setPendingId(null);
    }
  }

  const grupos = ORDEN_ESTADOS.map((status) => ({
    status,
    ideas: ideas.filter((idea) => idea.status === status),
  })).filter((grupo) => grupo.ideas.length > 0);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">Ideas</h1>

      {esAgencia && <NuevaIdeaForm clients={clients} />}

      {ideas.length === 0 && (
        <EmptyState
          title="Todavía no hay ideas"
          description={
            esAgencia
              ? 'Propón la primera idea con el formulario de arriba.'
              : 'La agencia todavía no ha compartido ninguna idea contigo.'
          }
        />
      )}

      {grupos.map((grupo) => (
        <div key={grupo.status}>
          <h2 className="mb-2 text-sm font-semibold text-slate-500">
            {IDEA_STATUS_LABELS[grupo.status]} <span className="font-normal text-slate-400">({grupo.ideas.length})</span>
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {grupo.ideas.map((idea) => {
              const acciones = accionesDisponibles(idea.status, profile.role, marcasSet.has(idea.client_id));
              const accionConNotaAbierta = accionAbierta?.ideaId === idea.id ? accionAbierta.accion : null;
              const nota = notas[idea.id] ?? '';
              const error = errores[idea.id];
              const enCurso = pendingId === idea.id;
              const historial = historialPorIdea[idea.id] ?? [];
              const enlaceDeReferencia = urlSegura(idea.reference_link);

              return (
                <div key={idea.id} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm">
                  <p className="font-medium text-slate-800">{idea.title}</p>
                  <p className="text-xs text-slate-400">
                    {idea.clients?.brand_name ?? '—'} · {idea.author?.full_name ?? 'Autor desconocido'}
                  </p>
                  <p className="line-clamp-3 text-slate-600">{idea.description}</p>
                  {(idea.suggested_platform || idea.suggested_format) && (
                    <p className="text-xs text-slate-400">
                      {idea.suggested_platform && PLATFORM_LABELS[idea.suggested_platform]}
                      {idea.suggested_platform && idea.suggested_format && ' · '}
                      {idea.suggested_format && FORMAT_LABELS[idea.suggested_format]}
                    </p>
                  )}
                  {/* Validado tambien al pintar; ver el comentario equivalente en
                      ContentPieceDetail.tsx y CN-008 en lib/url-segura.ts. */}
                  {enlaceDeReferencia && (
                    <a href={enlaceDeReferencia} target="_blank" rel="noreferrer" className="text-xs text-brand-600 underline">
                      Ver referencia
                    </a>
                  )}

                  {historial.length > 0 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs font-medium text-slate-500">
                        Historial ({historial.length})
                      </summary>
                      <ul className="mt-1.5 space-y-1.5">
                        {historial.map((h) => (
                          <li key={h.id} className="border-l-2 border-slate-200 pl-2 text-xs">
                            <p className="font-medium text-slate-700">
                              {h.from_status ? `${IDEA_STATUS_LABELS[h.from_status]} → ` : ''}
                              {IDEA_STATUS_LABELS[h.to_status]}
                            </p>
                            {h.note && <p className="text-slate-500">{h.note}</p>}
                            <p className="text-[11px] text-slate-400">
                              {h.changed_by_profile?.full_name ?? 'Sistema'} ·{' '}
                              {new Date(h.created_at).toLocaleString('es-MX')}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {error && <p className="rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-700">{error}</p>}

                  {acciones.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {acciones.map((accion) => {
                        if (ACCIONES_CON_NOTA.includes(accion) && accionConNotaAbierta === accion) return null;
                        return (
                          <button
                            key={accion}
                            type="button"
                            disabled={enCurso}
                            onClick={() => {
                              if (ACCIONES_CON_NOTA.includes(accion)) {
                                setAccionAbierta({ ideaId: idea.id, accion });
                              } else {
                                handleAccion(accion, idea);
                              }
                            }}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                          >
                            {ETIQUETAS[accion]}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {accionConNotaAbierta && (
                    <div className="mt-1 space-y-1.5">
                      <textarea
                        value={nota}
                        onChange={(e) => setNotas((prev) => ({ ...prev, [idea.id]: e.target.value }))}
                        rows={2}
                        placeholder="Escribe una nota…"
                        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                      />
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          disabled={enCurso}
                          onClick={() => {
                            setAccionAbierta(null);
                            setNotas((prev) => omitirClave(prev, idea.id));
                          }}
                          className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-60"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          disabled={enCurso || !nota.trim()}
                          onClick={() => handleAccion(accionConNotaAbierta, idea)}
                          className="rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                        >
                          {ETIQUETAS[accionConNotaAbierta]}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
