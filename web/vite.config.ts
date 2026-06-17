import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// base '/_cc/' keeps every CloudCoder asset under the /_cc namespace, so the
// preview proxy can hand /assets, /api, etc. to previewed dev servers.
export default defineConfig({
  base: '/_cc/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 4061,
    proxy: {
      '/_cc/api': { target: 'http://localhost:4060' },
      '/_cc/ws': { target: 'ws://localhost:4060', ws: true },
      '/p': { target: 'http://localhost:4060' },
      '/_preview': { target: 'http://localhost:4060' },
    },
  },
  build: {
    outDir: 'dist',
  },
});
