import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Vite *library mode* build for src/lib/index.ts.
// Run with: npm run build:lib   (JS bundle via Vite, then .d.ts via tsc -- see package.json)
export default defineConfig({
  // Next.js owns ./public (favicon, svgs). A library build must not copy it into the output.
  publicDir: false,
  build: {
    outDir: 'dist/lib',
    // Wipes dist/lib before building, so the .d.ts step must run AFTER this one (see the script order).
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2020',
    lib: {
      entry: fileURLToPath(new URL('./src/lib/index.ts', import.meta.url)),
      formats: ['es'], // ESM only
      fileName: 'index', // -> dist/lib/index.mjs (the package is not "type": "module", so Vite picks .mjs)
    },
    rollupOptions: {
      // Libraries should NOT bundle their peer dependencies. These modules are pure, so nothing needs to be
      // external today -- but if you ever export a React component from here, add 'react' and 'react-dom'
      // below, otherwise they would be bundled into the library (bigger file, two copies of React).
      external: [],
    },
  },
});
