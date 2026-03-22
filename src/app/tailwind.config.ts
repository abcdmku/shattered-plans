import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      boxShadow: {
        panel: '0 12px 30px rgba(4, 6, 16, 0.5)',
        glow: '0 0 20px rgba(116, 242, 255, 0.15)'
      },
      colors: {
        deep: '#070a14',
        surface: {
          DEFAULT: 'rgba(17, 22, 34, 0.9)',
          strong: 'rgba(24, 30, 44, 0.94)',
          border: 'rgba(255, 255, 255, 0.08)'
        },
        accent: {
          DEFAULT: '#74f2ff',
          mint: '#6cf7b2',
          dim: 'rgba(116, 242, 255, 0.15)'
        },
        danger: '#e6646e',
        ally: '#48d589',
        muted: '#8f9bb3'
      },
      fontFamily: {
        display: ['Oxanium', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body: ['Chakra Petch', 'ui-sans-serif', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
} satisfies Config;
