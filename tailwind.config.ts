import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f2f6fb',
          100: '#e2eaf6',
          200: '#c2d5ec',
          300: '#93b5db',
          400: '#5c8ec5',
          500: '#3970ab',
          600: '#2a578c',
          700: '#234771',
          800: '#213c5e',
          900: '#1f3450',
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
    },
  },
  plugins: [],
};

export default config;
