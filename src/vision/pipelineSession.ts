/**
 * The one pipeline run the app shows. Image to plan and How it works → Pipeline both read it: the
 * image, the settings and the result of running the steps on it. Picking a plan or moving a slider
 * on either page changes it for both, so the explanation always matches the run, and coming back
 * to a page shows the same image instead of starting over.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { FloorPlanDataset, Segment2D } from '../types/floorplan';
import { describeCvError, loadOpenCv, type CV } from './opencv';
import { runPipeline, type PipelineRun, type RgbaImage } from './pipeline';
import type { PipelineOptions } from './pipelineParams';
import { guessMetersPerPixel, wallsToPlan } from './wallsToPlan';

export interface TestPlanEntry {
  id: string;
  file: string;
  name: string;
  description: string;
  wallCount: number;
  pixelsPerMeter: number;
  /** Solid wall pieces between openings, as centerlines in image pixels. */
  groundTruthPieces: Segment2D[];
}

export interface SourceImage {
  label: string;
  image: RgbaImage;
  /** Known walls and scale (synthetic test plans only). */
  wallCount?: number;
  truth?: Segment2D[];
  pixelsPerMeter?: number;
  note?: string;
}

export interface PipelineSession {
  testPlans: TestPlanEntry[];
  /** The test plan shown, or '' for an uploaded image. */
  selectedPlanId: string;
  source: SourceImage | null;
  sourceError: string | null;
  overrides: Partial<PipelineOptions>;
  run: PipelineRun | null;
  runError: string | null;
  running: boolean;
}

const TEST_PLAN_DIR = `${import.meta.env.BASE_URL}test-plans/`;
/** Huge photos are scaled down while decoding so they fit comfortably in WASM memory. */
const MAX_DECODE_SIDE = 4096;

let session: PipelineSession = {
  testPlans: [],
  selectedPlanId: '',
  source: null,
  sourceError: null,
  overrides: {},
  run: null,
  runError: null,
  running: false,
};
/** The source and settings the current run (or failure) came from, so it is not repeated. */
let ranOn: { source: SourceImage; overrides: Partial<PipelineOptions> } | null = null;
const listeners = new Set<() => void>();

function update(patch: Partial<PipelineSession>) {
  session = { ...session, ...patch };
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function usePipelineSession(): PipelineSession {
  return useSyncExternalStore(subscribe, () => session);
}

async function decodeImage(blob: Blob): Promise<{ image: RgbaImage; downscaled: boolean }> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, MAX_DECODE_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    // Transparent pixels would read as black ink, so composite onto white paper.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    return { image: { width, height, data: ctx.getImageData(0, 0, width, height).data }, downscaled: scale < 1 };
  } finally {
    bitmap.close();
  }
}

// Only the latest image request may set the source (fast clicking between plans).
let request = 0;

export async function loadTestPlan(plan: TestPlanEntry): Promise<void> {
  const mine = ++request;
  update({ selectedPlanId: plan.id, sourceError: null });
  try {
    const response = await fetch(`${TEST_PLAN_DIR}${plan.file}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { image } = await decodeImage(await response.blob());
    if (mine !== request) return;
    update({
      overrides: {},
      source: { label: plan.name, image, wallCount: plan.wallCount, truth: plan.groundTruthPieces, pixelsPerMeter: plan.pixelsPerMeter },
    });
  } catch (err) {
    if (mine === request) update({ sourceError: `Could not load ${plan.file}: ${describeCvError(null, err)}` });
  }
}

export async function loadUploadedImage(file: File): Promise<void> {
  const mine = ++request;
  update({ sourceError: null });
  try {
    const { image, downscaled } = await decodeImage(file);
    if (mine !== request) return;
    update({
      selectedPlanId: '',
      overrides: {},
      source: { label: file.name, image, note: downscaled ? `Scaled to ${image.width}×${image.height} while loading.` : undefined },
    });
  } catch (err) {
    if (mine === request) update({ sourceError: `Could not read ${file.name}: ${describeCvError(null, err)}` });
  }
}

export function setOverrides(next: Partial<PipelineOptions>): void {
  update({ overrides: next });
}

let manifest: Promise<void> | null = null;

/** Fetches the test-plan list once, and opens the first plan if nothing is shown yet. */
export function ensureTestPlans(): void {
  manifest ??= fetch(`${TEST_PLAN_DIR}manifest.json`)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<{ plans: TestPlanEntry[] }>;
    })
    .then(({ plans }) => {
      update({ testPlans: plans });
      if (!session.source && request === 0 && plans[0]) void loadTestPlan(plans[0]);
    })
    .catch((err) => {
      manifest = null; // allow a retry when a page opens again
      update({ sourceError: `Could not load the test-plan list: ${describeCvError(null, err)}` });
    });
}

/** OpenCV.js, loaded on first use and shared after that. */
export function useOpenCv(): { cv: CV | null; error: string | null } {
  const [state, setState] = useState<{ cv: CV | null; error: string | null }>({ cv: null, error: null });
  useEffect(() => {
    let alive = true;
    loadOpenCv()
      .then(({ cv }) => alive && setState({ cv, error: null }))
      .catch((err) => alive && setState({ cv: null, error: describeCvError(null, err) }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

/**
 * Keeps the run up to date while a page that shows it is open: runs the steps again when the image
 * or the settings change, and reuses the last run when they have not (opening the other page).
 */
export function usePipelineRunner(cv: CV | null): void {
  const { source, overrides } = usePipelineSession();
  useEffect(() => {
    ensureTestPlans();
  }, []);
  useEffect(() => {
    if (!cv || !source) return;
    if (ranOn && ranOn.source === source && ranOn.overrides === overrides) return;
    update({ running: true });
    // Debounces slider drags, and lets the busy state paint before the synchronous run.
    const timer = window.setTimeout(() => {
      ranOn = { source, overrides };
      try {
        update({ run: runPipeline(cv, source.image, overrides), runError: null, running: false });
      } catch (err) {
        update({ run: null, runError: `The pipeline failed: ${describeCvError(cv, err)}`, running: false });
      }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [cv, source, overrides]);
}

/**
 * The run's walls as a plan for the 3D viewer. Stage 1 may have shrunk the image, so a test plan's
 * known scale is adjusted; an uploaded image's scale is guessed from its wall thickness.
 */
export function planFromRun(run: PipelineRun, source: SourceImage): { plan: FloorPlanDataset; metersPerPixel: number; scaleKnown: boolean } {
  const resize = run.workingSize.width / run.inputSize.width;
  const scaleKnown = source.pixelsPerMeter !== undefined;
  const metersPerPixel = source.pixelsPerMeter ? 1 / (source.pixelsPerMeter * resize) : guessMetersPerPixel(run.walls);
  const plan = wallsToPlan(run.walls, metersPerPixel, {
    name: `Detected: ${source.label}`,
    width: run.workingSize.width,
    height: run.workingSize.height,
    skewDeg: run.vector.skewDeg,
  });
  return { plan, metersPerPixel, scaleKnown };
}
