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

type Seleccion = 'todas' | PlatformType;

export function GrillaDeContenido({ piezas }: { piezas: VistaPieza[] }) {
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
      <div role="group" aria-label="Filtrar por plataforma" className="flex flex-wrap gap-2">
        {botones.map((boton) => (
          <button
            key={boton.valor}
            type="button"
            aria-pressed={plataforma === boton.valor}
            onClick={() => setPlataforma(boton.valor)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
              plataforma === boton.valor
                ? 'bg-ink-900 text-white'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'
            }`}
          >
            {boton.etiqueta} <span className="opacity-70">({boton.cantidad})</span>
          </button>
        ))}
      </div>

      {plataforma === 'todas'
        ? grupos.map((grupo) => {
            const Vista = VISTAS[grupo.plataforma];
            return (
              <section key={grupo.plataforma} aria-labelledby={`grilla-${grupo.plataforma}`} className="space-y-3">
                <h2 id={`grilla-${grupo.plataforma}`} className="text-base font-semibold text-slate-800">
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
