import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      boxShadow: {
        panel: '0 20px 60px rgba(1, 6, 14, 0.35)'
      },
      colors: {
        ink: {
          950: '#040816',
          900: '#07111f',
          800: '#0c1c30',
          700: '#162946'
        },
        sea: {
          400: '#5fe2d1',
          500: '#24bfae'
        },
        ember: {
          400: '#ffb36b',
          500: '#ff8a3d'
        }
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
} satisfies Config;
