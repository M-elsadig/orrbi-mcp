import { fileURLToPath } from 'node:url';
import { type Plugin, defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/* The widget ships as one self-contained HTML file (scripts and styles
   inlined): hosts load it from an MCP resource into a sandboxed iframe with
   no server to fetch assets from. Output: ui/dist/widget.html */
const ui = fileURLToPath(new URL('./ui/', import.meta.url));

/* zod (pulled in by the MCP Apps protocol code) re-exports error messages in
   64 languages as z.locales: ~260 KB of the widget, nearly half of it, and
   never used. Its English default is imported directly
   (zod/v4/classic/schemas.js), so the list can be cut down to English. */
export function zodEnglishOnly(): Plugin {
  return {
    name: 'zod-english-only',
    enforce: 'pre',
    load(id) {
      if (id.replace(/\\/g, '/').endsWith('/zod/v4/locales/index.js')) return 'export { default as en } from "./en.js";';
      return null;
    }
  };
}

export default defineConfig({
  root: ui,
  plugins: [zodEnglishOnly(), viteSingleFile()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { input: ui + 'widget.html' }
  }
});
