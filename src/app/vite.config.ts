import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiOrigin = env.VITE_API_ORIGIN ?? 'http://127.0.0.1:8080';

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: apiOrigin,
          changeOrigin: true
        },
        '/ws': {
          target: apiOrigin,
          ws: true,
          changeOrigin: true
        }
      }
    },
    preview: {
      host: '0.0.0.0'
    }
  };
});
