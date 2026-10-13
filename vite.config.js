import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5184 },
  preview: { port: 5184 },
  build: { chunkSizeWarningLimit: 800 },
});
