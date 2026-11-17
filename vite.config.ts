import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const emptyModule = fileURLToPath(new URL('./src/lib/emptyModule.ts', import.meta.url));

/**
 * Content-Security-Policy for the production build.
 *
 * This is the technical guarantee behind the confidentiality promise in the README:
 * the browser itself refuses to let the page talk to any other server. Scripts,
 * styles and workers may only come from the app's own origin, and network
 * requests (`connect-src`) are limited to the app's own files plus in-memory
 * `blob:`/`data:` URLs that never leave the computer.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "media-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function injectCsp(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<!--CSP-->',
        `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  // Relative asset paths: works on GitHub Pages (any repo name or casing),
  // on private hosting in a sub-folder, and from a local folder.
  base: './',
  plugins: [react(), tailwindcss(), injectCsp()],
  resolve: {
    // jsPDF's optional HTML/SVG helpers are not used; keep them out of the bundle.
    alias: { html2canvas: emptyModule, dompurify: emptyModule, canvg: emptyModule },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    sourcemap: false,
  },
});
