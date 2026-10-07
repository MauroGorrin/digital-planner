/**
 * Política de privacidad pública (sin sesión, lib/supabase/middleware.ts) -- hace falta para dar de
 * alta el login de Google en Google Cloud (Branding → Application privacy policy link) y para
 * cumplir con lo que un usuario real espera encontrar antes de darle "Entrar con Google".
 *
 * Describe lo que esta app hace de verdad, no una plantilla genérica: el contenido sigue el
 * recorrido real de los datos tal como está documentado en CLAUDE.md (Supabase, RLS, Google
 * Calendar opcional, webhooks hacia Make, sin anuncios ni venta de datos).
 */
export default function PoliticaDePrivacidadPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 text-slate-700">
      <h1 className="text-2xl font-semibold text-slate-900">Política de privacidad</h1>
      <p className="mt-2 text-sm text-slate-500">Última actualización: octubre de 2026.</p>

      <section className="mt-8 space-y-4 text-sm leading-relaxed">
        <p>
          Planner de Contenido es una herramienta para que una agencia y sus clientes planifiquen,
          revisen y aprueben contenido de redes sociales. Esta página explica qué datos guarda, para
          qué los usa y con quién los comparte.
        </p>

        <h2 className="text-base font-semibold text-slate-900">Qué datos guardamos</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Nombre completo y correo electrónico, al crear tu cuenta.</li>
          <li>Si entras con Google, tu nombre y correo de tu cuenta de Google — no pedimos ningún otro permiso.</li>
          <li>El contenido que subes o revisas: títulos, textos, imágenes o videos adjuntos, comentarios y el historial de aprobaciones.</li>
          <li>Si tu agencia conecta Google Calendar, el token necesario para publicar eventos en el calendario que elijan — nada más de tu cuenta de Google.</li>
        </ul>

        <h2 className="text-base font-semibold text-slate-900">Para qué los usamos</h2>
        <p>
          Únicamente para que la app funcione: mostrarte el contenido que te corresponde ver,
          guardar tu aprobación o tus comentarios, y avisarte (dentro de la app) cuando haya algo
          pendiente. No usamos tus datos para publicidad, no los analizamos con fines comerciales y
          no los vendemos a nadie.
        </p>

        <h2 className="text-base font-semibold text-slate-900">Con quién los compartimos</h2>
        <p>
          Con nadie fuera de tu propia agencia. Cada marca solo la ven las personas de su agencia y
          sus propios contactos — nunca otra agencia ni otro cliente. Si tu agencia configura un
          webhook hacia Make o conecta Google Calendar, los datos de una pieza de contenido viajan
          únicamente hacia esas herramientas que tu propia agencia eligió conectar, y solo cuando esa
          pieza cambia de estado.
        </p>

        <h2 className="text-base font-semibold text-slate-900">Dónde se guardan</h2>
        <p>
          En Supabase (Postgres), con aislamiento por agencia a nivel de base de datos: una política
          de acceso impide técnicamente que una agencia lea los datos de otra, no solo que la
          interfaz no se los muestre.
        </p>

        <h2 className="text-base font-semibold text-slate-900">Tus opciones</h2>
        <p>
          Puedes cambiar tu contraseña desde tu perfil en cualquier momento. Si quieres que
          eliminemos tu cuenta o los datos asociados a ella, escríbenos al correo de abajo.
        </p>

        <h2 className="text-base font-semibold text-slate-900">Contacto</h2>
        <p>
          Para cualquier pregunta sobre esta política o tus datos, escribe a{' '}
          <a href="mailto:maurogorrin55@gmail.com" className="text-brand-600 hover:underline">
            maurogorrin55@gmail.com
          </a>
          .
        </p>
      </section>
    </main>
  );
}
