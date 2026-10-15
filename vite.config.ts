import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' makes the build work from any folder or sub-path
// (GitHub Pages /medunited-sales-crm/, an intranet /crm/, a bucket, etc.).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 3000,
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
