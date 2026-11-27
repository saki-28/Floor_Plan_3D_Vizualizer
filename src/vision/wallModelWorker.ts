/// <reference lib="webworker" />
/**
 * Runs the wall model off the main thread, so the page stays usable while a plan is predicted.
 * It downloads the model file once, runs it on the graphics card through WebGPU where the browser
 * has it, and otherwise on the processor (WebAssembly, on several threads when the page is allowed
 * them). Messages in: 'load', then 'predict' with a plan's ink. Messages out: progress and results.
 */

import * as ort from 'onnxruntime-web/webgpu';
import { BROWSER_TILE, predictClasses, type TileRunner } from './wallModel';

export type ModelBackend = 'webgpu' | 'wasm';

export type WorkerRequest =
  | { type: 'load'; id: number; modelUrl: string; runtimeUrl: string }
  | { type: 'predict'; id: number; ink: Float32Array; width: number; height: number };

export type WorkerReply =
  | { type: 'download'; id: number; loaded: number; total: number }
  | { type: 'loaded'; id: number; backend: ModelBackend; threads: number }
  | { type: 'missing'; id: number }
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'result'; id: number; classes: Uint8Array; ms: number; tiles: number; backend: ModelBackend; threads: number }
  | { type: 'error'; id: number; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const reply = (message: WorkerReply, transfer: Transferable[] = []) => scope.postMessage(message, transfer);

let modelBytes: Uint8Array | null = null;
let session: ort.InferenceSession | null = null;
let backend: ModelBackend = 'wasm';
let threads = 1;

/** The model file, with download progress. Null when this copy of the app does not have it. */
async function download(url: string, id: number): Promise<Uint8Array | null> {
  const response = await fetch(url);
  // A missing file comes back as the app's own page from some servers, not as a 404.
  if (!response.ok || (response.headers.get('content-type') ?? '').includes('text/html')) return null;
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    reply({ type: 'download', id, loaded, total });
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function createSession(on: ModelBackend): Promise<void> {
  if (!modelBytes) throw new Error('The model has not been loaded.');
  session = await ort.InferenceSession.create(modelBytes, { executionProviders: [on], graphOptimizationLevel: 'all' });
  backend = on;
}

const runTile: TileRunner = async (ink, tile) => {
  if (!session) throw new Error('The model has not been loaded.');
  // The tile buffer is reused by the caller, so the tensor gets its own copy.
  const output = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', ink.slice(), [1, 1, tile, tile]) });
  const scores = output[session.outputNames[0]];
  const data = (await scores.getData()) as Float32Array;
  scores.dispose?.();
  return data;
};

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  try {
    if (message.type === 'load') {
      if (!session) {
        ort.env.wasm.wasmPaths = message.runtimeUrl;
        // Several threads need a cross-origin isolated page; without it the runtime uses one.
        threads = scope.crossOriginIsolated ? Math.max(1, Math.min(6, Math.ceil((navigator.hardwareConcurrency || 2) / 2))) : 1;
        ort.env.wasm.numThreads = threads;
        modelBytes = await download(message.modelUrl, message.id);
        if (!modelBytes) {
          reply({ type: 'missing', id: message.id });
          return;
        }
        const hasGpu = 'gpu' in navigator && (await (navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null)) !== null;
        try {
          await createSession(hasGpu ? 'webgpu' : 'wasm');
        } catch (err) {
          if (!hasGpu) throw err;
          await createSession('wasm'); // the graphics card refused the model: the processor still runs it
        }
      }
      reply({ type: 'loaded', id: message.id, backend, threads: backend === 'wasm' ? threads : 0 });
      return;
    }

    const started = performance.now();
    let tiles = 0;
    const predict = () =>
      predictClasses(message.ink, message.width, message.height, runTile, {
        tile: BROWSER_TILE,
        onProgress: (done, total) => {
          tiles = total;
          reply({ type: 'progress', id: message.id, done, total });
        },
      });
    let map;
    try {
      map = await predict();
    } catch (err) {
      if (backend !== 'webgpu') throw err;
      await createSession('wasm'); // a failure part-way on the graphics card: start this plan again on the processor
      map = await predict();
    }
    reply(
      { type: 'result', id: message.id, classes: map.classes, ms: performance.now() - started, tiles, backend, threads: backend === 'wasm' ? threads : 0 },
      [map.classes.buffer],
    );
  } catch (err) {
    reply({ type: 'error', id: message.id, message: err instanceof Error ? err.message : String(err) });
  }
};
