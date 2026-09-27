import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Acento violeta-índigo: enlaces, focus rings, estados seleccionados, barras de
        // progreso. Reemplaza el azul genérico anterior — como `brand-*` ya era el token
        // central en ~20 componentes (CalendarBoard, IdeasBoard, ContentPieceForm,
        // PanelDeMetricas, AppShell...), este único cambio re-pinta toda la app sin tocar
        // esos archivos uno por uno.
        brand: {
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
        },
        // Grafito/negro para los CTA principales (`.btn-primary`, logo, secciones oscuras de
        // impacto) — el acento no vive en el botón principal, vive en enlaces y detalles.
        ink: {
          50: '#f7f7f8',
          100: '#eeeef0',
          200: '#d9d9de',
          300: '#b3b3bd',
          400: '#82828f',
          500: '#565660',
          600: '#3a3a42',
          700: '#26262c',
          800: '#18181d',
          900: '#0a0a0f',
        },
        state: {
          draft: '#94a3b8',
          review: '#f59e0b',
          changes: '#ef4444',
          approved: '#22c55e',
          scheduled: '#3b82f6',
          published: '#16a34a',
          cancelled: '#71717a',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // Itálica serif de acento para palabras clave en títulos, no para texto de cuerpo.
        accent: ['var(--font-accent)', 'ui-serif', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};

export default config;
