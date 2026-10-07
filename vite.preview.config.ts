import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/* The partner preview (scripts/preview-business.ts): the real widget in a
   stub host, as one self-contained HTML file. Never deployed.
   Output: preview/dist/index.html */
const root = fileURLToPath(new URL('./preview/', import.meta.url));

export default defineConfig({
  root,
  plugins: [viteSingleFile()],
  build: { outDir: 'dist', emptyOutDir: true }
});
