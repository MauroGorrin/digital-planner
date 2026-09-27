// El origen de Supabase se deriva de NEXT_PUBLIC_SUPABASE_URL al cargar la config (Next carga los
// archivos .env antes que este módulo, así que la variable ya está aquí). No se escribe a mano el
// hostname del proyecto porque este repositorio no conoce su project ref: cada despliegue trae el
// suyo en esa variable.
function origenDeSupabase() {
  const bruta = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!bruta) return null;
  try {
    const u = new URL(bruta);
    return { protocol: u.protocol.replace(':', ''), hostname: u.hostname, port: u.port, origin: u.origin };
  } catch {
    return null;
  }
}

const supabase = origenDeSupabase();

/**
 * Patrones remotos del optimizador de imágenes.
 *
 * Antes aquí había `hostname: '**.supabase.co'`. Ese comodín no significa "mi proyecto": significa
 * TODOS los proyectos Supabase de internet. Y `/_next/image` existe en cualquier app Next aunque
 * nunca se importe `next/image` (aquí no se importa) y el matcher del middleware lo excluye a
 * propósito. Eso es exactamente lo que hacía ALCANZABLE el RCE del optimizador de imágenes de Next
 * (GHSA-2xp9-vwfh-vxw4, vía AVIF): un atacante alojaba la imagen en SU propio proyecto Supabase y
 * este despliegue la descargaba y la procesaba. Además es SSRF por sí solo.
 *
 * Si la variable no está, la lista queda vacía y el optimizador rechaza toda URL remota. Preferimos
 * que una imagen no cargue antes que volver a abrir el comodín por omisión.
 */
const patronesRemotos = supabase
  ? [
      {
        protocol: supabase.protocol,
        hostname: supabase.hostname,
        // El puerto viaja también: en local Supabase es 127.0.0.1:54321, no un host .supabase.co.
        ...(supabase.port ? { port: supabase.port } : {}),
      },
    ]
  : [];

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  images: {
    remotePatterns: patronesRemotos,
  },
};

export default nextConfig;
