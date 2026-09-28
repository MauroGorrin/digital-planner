'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { renombrarMiAgencia } from '@/app/admin-actions';
import { LARGO_MAXIMO_DE_AGENCIA, validarNombreDeAgencia } from '@/lib/validacion-registro';
import type { UserRole } from '@/types/database';

/**
 * El nombre de la agencia, con su campo para cambiarlo.
 *
 * Sólo se dibuja para un `agency_admin`. `/ajustes` ya es una página sólo de administradores
 * (`requireAgencyAdmin`), así que hoy esta condición no esconde nada que la página no esconda ya;
 * está para que la sección no aparezca por accidente el día que se reuse en una página que vea el
 * resto del equipo. Tampoco es el control: quien decide es `renombrar_mi_agencia()` en la base
 * (0012_renombrar_agencia.sql), que rechaza a un `agency_member` aunque llegue a llamarla.
 */
export function NombreDeAgencia({ rol, nombre }: { rol: UserRole; nombre: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [valor, setValor] = useState(nombre);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  if (rol !== 'agency_admin') return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setGuardado(false);
    // El mismo validador que el alta y que la Server Action: una sola definición de qué nombre vale.
    const problema = validarNombreDeAgencia(valor);
    setError(problema);
    if (problema) return;

    startTransition(async () => {
      try {
        await renombrarMiAgencia(valor);
        setGuardado(true);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo guardar el nombre.');
      }
    });
  }

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <h2 className="mb-1 text-sm font-semibold text-slate-800">Nombre de la agencia</h2>
      <p className="mb-3 text-xs text-slate-500">Es el nombre con el que tu equipo reconoce la agencia dentro del planner.</p>
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="nombre-de-agencia" className="sr-only">
          Nombre de la agencia
        </label>
        <input
          id="nombre-de-agencia"
          value={valor}
          onChange={(e) => {
            setValor(e.target.value);
            setGuardado(false);
          }}
          maxLength={LARGO_MAXIMO_DE_AGENCIA}
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button type="submit" disabled={isPending} className="btn-primary whitespace-nowrap">
          Guardar nombre
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {guardado && !error && <p className="mt-2 text-sm text-green-700">Nombre guardado.</p>}
    </section>
  );
}
