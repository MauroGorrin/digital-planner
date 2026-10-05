import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: '', ...options });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  // Fuera `/api/webhooks`: no existe ninguna ruta detras de ese prefijo (CN-016). Dejarlo en la
  // lista significa que quien anada app/api/webhooks/** manana hereda un endpoint SIN AUTENTICAR
  // por omision, sin haberlo decidido. Cuando exista esa ruta, volvera aqui junto con su propia
  // verificacion de firma, no antes.
  //
  // `/registro` es la segunda ruta publica, desde el paso 3 del spec (el alta de agencia). Sin
  // ponerla aqui el middleware manda a `/login` a quien viene a registrarse, que es el bucle que
  // deja el alta inalcanzable: para registrarte tendrias que tener ya una cuenta.
  //
  // Abrir esta ruta NO abre el alta por si solo: el endpoint `/auth/v1/signup` lo abre
  // `enable_signup` en el proyecto de Supabase, y en produccion eso vive en el panel. Ver la regla
  // 7 de CLAUDE.md.
  //
  // `/reportes` y `/api/reportes/pdf` son la tercera y cuarta ruta publica: el link compartible
  // del reporte de metricas (lib/reportes.ts) y su descarga en PDF. No dependen de sesion -- se
  // protegen con una firma HMAC en la propia URL, verificada dentro de cada ruta
  // (verificarAccesoAReporte()), no con el login. Abrirlas aqui es lo que deja que alguien sin
  // cuenta -- el cliente que recibe el link por WhatsApp -- las vea; sin RLS de por medio, porque
  // ambas leen con el cliente de servicio, la firma ES el control de acceso.
  // `/grilla/[clientId]/[anio]/[mes]` es la presentación compartida de la grilla (lib/grilla-compartir.ts).
  // Se abre solo con esa forma exacta: `/grilla` a secas sigue siendo la vista privada de la app.
  const isPublic =
    path.startsWith('/login') ||
    path.startsWith('/registro') ||
    path.startsWith('/reportes') ||
    path.startsWith('/api/reportes/pdf') ||
    /^\/grilla\/[^/]+\/\d{4}\/\d{1,2}\/?$/.test(path) ||
    path.startsWith('/_next');

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', path);
    return NextResponse.redirect(url);
  }

  // Quien ya tiene sesion no ve ni el login ni el registro. En `/registro` no es cosmetico: el
  // formulario llama a `signUp()`, que con una sesion abierta ni crea una cuenta ni avisa de forma
  // util. Se le manda a `/`, que reparte segun su perfil (app/page.tsx) -- asi, si su alta quedo a
  // medias, termina en /bienvenida en vez de en un calendario que no puede usar.
  if (user && (path === '/login' || path === '/registro')) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return response;
}
