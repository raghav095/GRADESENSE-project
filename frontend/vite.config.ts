import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // "View Original Uploaded File" links to a bare /uploads/<file> URL,
      // which resolves against the current origin (this dev server, port
      // 3000) — without this, that request never reached the backend at
      // all. Vite has no matching static file for it and falls back to
      // serving index.html (its SPA catch-all), so the link silently opened
      // the app itself instead of the PDF.
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
