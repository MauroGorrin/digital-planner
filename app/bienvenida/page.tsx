import { redirect } from 'next/navigation';
import { requireProfile } from '@/lib/auth';
import { altaDeAgenciaPendiente, nombreDeAgenciaSugerido } from '@/lib/alta-de-agencia';
import { AltaDeAgencia } from '@/components/AltaDeAgencia';

export const metadata = {
  title: 'Crea tu agencia — Planner de Contenido',
};

/**
 * Dónde aterriza quien acaba de confirmar su correo.
 *
 * Es la pieza que impide que un alta quede en un callejón sin salida. Entre el registro y esta
 * pantalla la persona tiene una cuenta confirmada, rol `client`, ninguna agencia y ninguna marca: un
 * estado que no sirve para nada y en el que se puede quedar por cerrar la pestaña en el momento
 * equivocado. Esta ruta lo termina, y lo termina TANTAS VECES COMO HAGA FALTA — se puede recargar,
 * volver al día siguiente o llegar desde `/`, porque el destino no depende de haber seguido un
 * camino concreto sino del estado del perfil, que se consulta aquí cada vez.
 *
 * Quien ya no está en ese estado no la ve: si ya tiene agencia, o es contacto de una marca, se le
 * manda al calendario. Es la misma pregunta que responde `crear_mi_agencia()` en la base, hecha
 * aquí para elegir pantalla.
 */
export default async function BienvenidaPage() {
  const profile = await requireProfile();

  if (!(await altaDeAgenciaPendiente(profile))) redirect('/calendario');

  const nombreSugerido = await nombreDeAgenciaSugerido();

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-slate-900">
            Un paso más, <span className="title-accent">{profile.full_name.split(' ')[0]}</span>
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Confirmaste tu correo. Sólo falta darle nombre a tu agencia para entrar a tu espacio de
            trabajo.
          </p>
        </div>
        <AltaDeAgencia nombreSugerido={nombreSugerido} />
        <p className="mt-6 text-center text-xs text-slate-400">
          Tu agencia nace vacía: sin marcas, sin piezas y sin nadie más dentro. Nadie fuera de ella
          ve lo que crees aquí.
        </p>
      </div>
    </main>
  );
}
