import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Preview build: one self-contained HTML file with the real backend running
// in the page on sample data (src/demo/). Never deploy this as the real app.
//   npm run build:demo  →  dist-demo/index.demo.html
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  define: { 'import.meta.env.VITE_DEMO': JSON.stringify('true') },
  publicDir: false,
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
    rollupOptions: { input: 'index.demo.html' },
  },
});
