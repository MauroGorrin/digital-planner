'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useConfirm } from './ConfirmDialog';
import { activarModoDePrueba, desactivarModoDePrueba } from '@/app/admin-actions';

/**
 * Interruptor único: te vuelve contacto de todas las marcas de tu agencia (o te quita de todas),
 * para probar la grilla y la aprobación con tu propia cuenta de administrador.
 */
export function ModoDePrueba({ activo }: { activo: boolean }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ocurrió un error.');
      }
    });
  }

  return (
    <div>
      {dialog}
      <p className="mb-3 text-xs text-slate-500">
        {activo
          ? 'Estás como contacto de todas tus marcas. Ves y puedes aprobar o pedir cambios en cualquiera, igual que lo haría el cliente. Queda registrado con tu nombre.'
          : 'Te vuelve contacto de todas las marcas de tu agencia, para que veas la grilla y apruebes como lo haría un cliente, sin cambiar de cuenta.'}
      </p>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {activo ? (
        <button
          disabled={isPending}
          onClick={() =>
            confirm({
              title: 'Desactivar el modo de prueba',
              description: 'Te quita como contacto de todas las marcas de tu agencia. Si algún cliente real también te había agregado como contacto aparte, eso no se toca.',
              confirmLabel: 'Desactivar',
              onConfirm: () => run(desactivarModoDePrueba),
            })
          }
          className="btn-secondary"
        >
          Desactivar modo de prueba
        </button>
      ) : (
        <button
          disabled={isPending}
          onClick={() =>
            confirm({
              title: 'Activar el modo de prueba',
              description: 'Quedas como contacto de todas las marcas de tu agencia. Vas a ver y poder aprobar contenido pendiente, y quedará registrado con tu nombre.',
              confirmLabel: 'Activar',
              onConfirm: () => run(activarModoDePrueba),
            })
          }
          className="btn-primary"
        >
          Activar modo de prueba
        </button>
      )}
    </div>
  );
}
