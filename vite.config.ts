import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('konva')) return 'canvas-engine';
          if (id.includes('lucide-react')) return 'icons';
          if (id.includes('react')) return 'react-vendor';
          return undefined;
        },
      },
    },
  },
});
