import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/* The widget ships as one self-contained HTML file (scripts and styles
   inlined): hosts load it from an MCP resource into a sandboxed iframe with
   no server to fetch assets from. Output: ui/dist/widget.html */
const ui = fileURLToPath(new URL('./ui/', import.meta.url));

export default defineConfig({
  root: ui,
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { input: ui + 'widget.html' }
  }
});
