import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The dev proxy mirrors the compose topology: the browser only ever talks to
// one origin, and /api is the API. No VITE_* variable carries a secret.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
