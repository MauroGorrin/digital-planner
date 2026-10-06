'use client';

import { useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { COLOR_DE_PLATAFORMA, VISTA_POR_PLATAFORMA } from '@/lib/grilla-vistas';
import { agruparPorPlataforma, type VistaPieza } from '@/lib/grilla';
import { PLATFORM_LABELS, type PlatformType } from '@/types/database';

type Seleccion = 'todas' | PlatformType;

export function GrillaDeContenido({
  piezas,
  stickyFiltro = false,
}: {
  piezas: VistaPieza[];
  /** La presentación pública la pasa en `true`: la barra de redes queda fija arriba al bajar el feed. */
  stickyFiltro?: boolean;
}) {
  const [plataforma, setPlataforma] = useState<Seleccion>('todas');

  if (piezas.length === 0) {
    return (
      <EmptyState
        title="Nada que mostrar"
        description="No hay contenido aprobado o programado todavía."
      />
    );
  }

  const grupos = agruparPorPlataforma(piezas);
  const botones: { valor: Seleccion; etiqueta: string; cantidad: number }[] = [
    { valor: 'todas', etiqueta: 'Todas', cantidad: piezas.length },
    ...grupos.map((g) => ({
      valor: g.plataforma,
      etiqueta: PLATFORM_LABELS[g.plataforma],
      cantidad: g.piezas.length,
    })),
  ];

  return (
    <div className="space-y-6">
      <div
        role="group"
        aria-label="Filtrar por plataforma"
        className={`flex flex-wrap gap-2 overflow-x-auto pb-1 ${
          stickyFiltro ? 'sticky top-0 z-10 -mx-4 bg-slate-50/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8' : ''
        }`}
      >
        {botones.map((boton) => {
          const color = boton.valor === 'todas' ? '#0F172A' : COLOR_DE_PLATAFORMA[boton.valor];
          const activo = plataforma === boton.valor;
          return (
            <button
              key={boton.valor}
              type="button"
              aria-pressed={activo}
              onClick={() => setPlataforma(boton.valor)}
              style={activo ? { backgroundColor: color } : undefined}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                activo ? 'text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'
              }`}
            >
              {boton.etiqueta} <span className="opacity-70">({boton.cantidad})</span>
            </button>
          );
        })}
      </div>

      {plataforma === 'todas'
        ? grupos.map((grupo) => {
            const Vista = VISTA_POR_PLATAFORMA[grupo.plataforma];
            return (
              <section key={grupo.plataforma} aria-labelledby={`grilla-${grupo.plataforma}`} className="space-y-3">
                <h2 id={`grilla-${grupo.plataforma}`} className="flex items-center gap-2 text-base font-semibold text-slate-800">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: COLOR_DE_PLATAFORMA[grupo.plataforma] }}
                  />
                  {PLATFORM_LABELS[grupo.plataforma]}
                </h2>
                <Vista piezas={grupo.piezas} />
              </section>
            );
          })
        : (() => {
            const grupo = grupos.find((g) => g.plataforma === plataforma);
            if (!grupo) return null;
            const Vista = VISTA_POR_PLATAFORMA[grupo.plataforma];
            return <Vista piezas={grupo.piezas} />;
          })()}
    </div>
  );
}
