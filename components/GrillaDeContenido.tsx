'use client';

import { useState, type ComponentType } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { PreviewFacebook } from '@/components/platform-previews/PreviewFacebook';
import { PreviewGenerica } from '@/components/platform-previews/PreviewGenerica';
import { PreviewInstagram } from '@/components/platform-previews/PreviewInstagram';
import { PreviewLinkedIn } from '@/components/platform-previews/PreviewLinkedIn';
import { PreviewPinterest } from '@/components/platform-previews/PreviewPinterest';
import { PreviewTikTok } from '@/components/platform-previews/PreviewTikTok';
import { PreviewTwitterX } from '@/components/platform-previews/PreviewTwitterX';
import { PreviewYouTube } from '@/components/platform-previews/PreviewYouTube';
import type { PropsDePreview } from '@/components/platform-previews/types';
import { agruparPorPlataforma, type VistaPieza } from '@/lib/grilla';
import { PLATFORM_LABELS, type PlatformType } from '@/types/database';

/** Único lugar donde cada plataforma se asocia con su vista. */
const VISTAS: Record<PlatformType, ComponentType<PropsDePreview>> = {
  instagram: PreviewInstagram,
  facebook: PreviewFacebook,
  tiktok: PreviewTikTok,
  linkedin: PreviewLinkedIn,
  twitter_x: PreviewTwitterX,
  youtube: PreviewYouTube,
  pinterest: PreviewPinterest,
  otra: PreviewGenerica,
};

/** El color de marca de cada red, para que elegirla se sienta como cambiar de feed y no de filtro. */
const COLOR_DE_PLATAFORMA: Record<PlatformType, string> = {
  instagram: '#C1327A',
  facebook: '#1877F2',
  tiktok: '#000000',
  linkedin: '#0A66C2',
  twitter_x: '#000000',
  youtube: '#FF0000',
  pinterest: '#E60023',
  otra: '#334155',
};

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
            const Vista = VISTAS[grupo.plataforma];
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
            const Vista = VISTAS[grupo.plataforma];
            return <Vista piezas={grupo.piezas} />;
          })()}
    </div>
  );
}
