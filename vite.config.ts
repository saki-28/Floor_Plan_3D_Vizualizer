import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

/**
 * The trained wall model runs on onnxruntime-web, which loads its WebAssembly runtime by URL at
 * run time. This copies the two runtime files out of node_modules into public/ort/ (not in git)
 * so the dev server and the build both serve them from the app's own address. It runs while the
 * configuration is read, before the server lists what is in public/.
 */
function onnxRuntimeFiles(): Plugin {
  return {
    name: 'onnx-runtime-files',
    config() {
      const from = path.resolve(__dirname, 'node_modules/onnxruntime-web/dist');
      const to = path.resolve(__dirname, 'public/ort');
      fs.mkdirSync(to, {recursive: true});
      for (const file of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
        const source = path.join(from, file);
        const target = path.join(to, file);
        if (!fs.existsSync(target) || fs.statSync(target).size !== fs.statSync(source).size) fs.copyFileSync(source, target);
      }
    },
  };
}

/**
 * Lets the page use several processor threads for the model (browsers allow that only on a page
 * isolated from other sites). Hosting without these two headers still works, on one thread.
 */
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), onnxRuntimeFiles()],
    worker: {format: 'es' as const},
    preview: {headers: ISOLATION_HEADERS},
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      headers: ISOLATION_HEADERS,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
