import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // Le build de production appelle l'API sous /api (proxy Netlify) : même chose en `vite preview`.
  preview: {
    proxy: { '/api': { target: 'http://localhost:4000', rewrite: (path) => path.replace(/^\/api/, '') } },
  },
  // hls.js représente l'essentiel du bundle ; il est nécessaire dès le premier écran (lecteur global).
  build: { chunkSizeWarningLimit: 800 },
});
