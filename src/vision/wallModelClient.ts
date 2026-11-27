/**
 * The page's side of the wall model: starts the worker that runs it (wallModelWorker.ts), keeps
 * what is known about the model (not asked for yet, downloading, ready, not in this copy of the
 * app, failed) where the pages can read it, and predicts the classes of an image's pixels.
 */

import { useSyncExternalStore } from 'react';
import type { RgbaImage } from './pipeline';
import { inkFromRgba, type ClassMap } from './wallModel';
import type { ModelBackend, WorkerReply, WorkerRequest } from './wallModelWorker';

export type { ModelBackend };

export interface WallModelState {
  status: 'idle' | 'loading' | 'ready' | 'missing' | 'failed';
  /** Bytes of the model file downloaded so far, and its size when the server says. */
  loaded: number;
  total: number;
  backend: ModelBackend | null;
  threads: number;
  message: string | null;
}

/** What a prediction brings back, for the pipeline and for the page's summary. */
export interface ModelResult {
  map: ClassMap;
  ms: number;
  tiles: number;
  backend: ModelBackend;
  threads: number;
}

const MODEL_URL = `${import.meta.env.BASE_URL}models/floorplan3d_walls.onnx`;
const RUNTIME_PATH = `${import.meta.env.BASE_URL}ort/`;

let state: WallModelState = { status: 'idle', loaded: 0, total: 0, backend: null, threads: 0, message: null };
const listeners = new Set<() => void>();
const setState = (patch: Partial<WallModelState>) => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useWallModel(): WallModelState {
  return useSyncExternalStore(subscribe, () => state);
}

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, (reply: WorkerReply) => void>();

function send(request: WorkerRequest, transfer: Transferable[] = []): void {
  if (!worker) {
    worker = new Worker(new URL('./wallModelWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerReply>) => waiting.get(event.data.id)?.(event.data);
    worker.onerror = (event) => {
      // The worker itself broke (it could not start, say): every request waiting on it fails.
      for (const [id, done] of [...waiting]) done({ type: 'error', id, message: event.message || 'The model could not be started.' });
    };
  }
  worker.postMessage(request, transfer);
}

let loading: Promise<void> | null = null;

/** Downloads the model and gets it ready, once. Rejects when it is not in this copy of the app or cannot run. */
export function loadWallModel(): Promise<void> {
  loading ??= new Promise<void>((resolve, reject) => {
    const id = nextId++;
    setState({ status: 'loading', loaded: 0, total: 0, message: null });
    waiting.set(id, (reply) => {
      if (reply.type === 'download') {
        setState({ loaded: reply.loaded, total: reply.total });
        return;
      }
      waiting.delete(id);
      if (reply.type === 'loaded') {
        setState({ status: 'ready', backend: reply.backend, threads: reply.threads });
        resolve();
      } else if (reply.type === 'missing') {
        setState({ status: 'missing' });
        reject(new Error('its file is not in this copy of the app (the weights are not in the repository; the README says how to add them).'));
      } else {
        const message = reply.type === 'error' ? reply.message : 'The model could not be loaded.';
        setState({ status: 'failed', message });
        loading = null; // a later try may work (a dropped download, say)
        reject(new Error(message));
      }
    });
    send({ type: 'load', id, modelUrl: new URL(MODEL_URL, location.href).href, runtimeUrl: new URL(RUNTIME_PATH, location.href).href });
  });
  return loading;
}

/** The class of every pixel of an image (already at the size the pipeline works at). */
export async function runWallModel(image: RgbaImage, onProgress?: (done: number, total: number) => void): Promise<ModelResult> {
  await loadWallModel();
  const ink = inkFromRgba(image.data, image.width, image.height);
  return new Promise<ModelResult>((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, (reply) => {
      if (reply.type === 'progress') {
        onProgress?.(reply.done, reply.total);
        return;
      }
      waiting.delete(id);
      if (reply.type === 'result') {
        // The processor may have taken over from the graphics card part-way.
        if (reply.backend !== state.backend) setState({ backend: reply.backend, threads: reply.threads });
        resolve({ map: { width: image.width, height: image.height, classes: reply.classes }, ms: reply.ms, tiles: reply.tiles, backend: reply.backend, threads: reply.threads });
      } else {
        reject(new Error(reply.type === 'error' ? reply.message : 'The model did not answer.'));
      }
    });
    send({ type: 'predict', id, ink, width: image.width, height: image.height }, [ink.buffer]);
  });
}

/** "on the graphics card" or "on the processor (4 threads)", for sentences about where the model ran. */
export function describeBackend(backend: ModelBackend | null, threads: number): string {
  if (backend === 'webgpu') return 'on the graphics card';
  return threads > 1 ? `on the processor (${threads} threads)` : 'on the processor';
}
