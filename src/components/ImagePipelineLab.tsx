/**
 * Image to plan: runs the real OpenCV.js pipeline (stages 1–7) on a synthetic
 * test plan or an uploaded image. The selected stage (the walls, by default) gets
 * the big view under a strip of all seven; the side panel holds the summary, the
 * score against the real walls when the image is a test plan, and the settings.
 * The detected walls can be opened in the 3D viewer.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, ImageUp, Loader2, RotateCcw } from 'lucide-react';
import type { FloorPlanDataset, Segment2D } from '../types/floorplan';
import { describeCvError, loadOpenCv, type CV } from '../vision/opencv';
import {
  HOUGH_COLORS,
  REMOVED_COLOR,
  WALL_COLORS,
  runPipeline,
  type PipelineRun,
  type RgbaImage,
  type StageId,
} from '../vision/pipeline';
import type { PipelineOptions, TunableKey } from '../vision/pipelineParams';
import { scoreWalls } from '../vision/scoreWalls';
import { guessMetersPerPixel, wallsToPlan } from '../vision/wallsToPlan';
import { Button, KeyValue, SectionTitle, Slider } from './ui';

interface TestPlanEntry {
  id: string;
  file: string;
  name: string;
  description: string;
  wallCount: number;
  pixelsPerMeter: number;
  /** Solid wall pieces between openings, as centerlines in image pixels. */
  groundTruthPieces: Segment2D[];
}

interface SourceImage {
  label: string;
  image: RgbaImage;
  /** Known walls and scale (synthetic test plans only). */
  wallCount?: number;
  truth?: Segment2D[];
  pixelsPerMeter?: number;
  note?: string;
}

const TEST_PLAN_DIR = `${import.meta.env.BASE_URL}test-plans/`;
/** Huge photos are scaled down while decoding so they fit comfortably in WASM memory. */
const MAX_DECODE_SIDE = 4096;

const STAGE_NOTES: Record<StageId, string> = {
  1: 'The longest side is capped, so the settings behave the same on every image.',
  2: 'Colour is dropped, then the lighting is evened out tile by tile.',
  3: 'Ink turns white and paper black; the cut-off is picked automatically.',
  4: 'Thin strokes and small blobs (text, ticks, specks) are removed.',
  5: 'The outlines of what is left.',
  6: 'Straight segments found in the outlines. These are not walls yet.',
  7: 'Faces paired into wall centerlines, gaps inside a wall bridged, corners and junctions closed.',
};

const TUNABLES: { key: TunableKey; label: string; min: number; max: number; step: number; unit: string; hint: string }[] = [
  { key: 'fillKernel', label: 'Fill outlined walls', min: 1, max: 25, step: 2, unit: ' px', hint: 'Step 4: joins double-line and hatched walls before thin lines are erased; 9 worked best on real scans (1 = off)' },
  { key: 'minBlobArea', label: 'Min blob area', min: 0, max: 3000, step: 10, unit: ' px', hint: 'Step 4: smaller blobs are dropped' },
  { key: 'closeKernel', label: 'Closing size', min: 1, max: 15, step: 2, unit: ' px', hint: 'Step 4: bridges small breaks in walls' },
  { key: 'houghVotes', label: 'Hough votes', min: 5, max: 200, step: 1, unit: '', hint: 'Step 6: edge pixels needed to accept a line' },
  { key: 'minLineLength', label: 'Min line length', min: 5, max: 200, step: 1, unit: ' px', hint: 'Step 6: shorter segments are ignored' },
  { key: 'maxLineGap', label: 'Max line gap', min: 0, max: 50, step: 1, unit: ' px', hint: 'Step 6: gaps up to this are joined' },
];

const rgb = (c: [number, number, number]) => `rgb(${c.join(',')})`;
const formatMs = (ms: number) => `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;
const formatEntries = (entries: Record<string, string | number>) =>
  Object.entries(entries)
    .map(([key, value]) => `${key} ${value}`)
    .join(' · ');

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

const StageCanvas: React.FC<{ image: RgbaImage; className?: string; label: string }> = ({ image, className, label }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d')?.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  }, [image]);
  return <canvas ref={ref} className={className} role="img" aria-label={label} />;
};

const Swatch: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <span className="flex items-center gap-1.5">
    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
    {label}
  </span>
);

const StageLegend: React.FC<{ id: StageId }> = ({ id }) => {
  if (id === 4) {
    return (
      <div className="flex gap-4 text-xs text-muted">
        <Swatch color="#ffffff" label="Kept" />
        <Swatch color={rgb(REMOVED_COLOR)} label="Removed" />
      </div>
    );
  }
  if (id === 7) {
    return (
      <div className="flex gap-4 text-xs text-muted">
        <Swatch color={rgb(WALL_COLORS.centerline)} label="Wall centerline" />
        <Swatch color={rgb(WALL_COLORS.body)} label="Wall thickness" />
        <Swatch color={rgb(WALL_COLORS.setAside)} label="Set aside (slanted)" />
      </div>
    );
  }
  if (id === 6) {
    return (
      <div className="flex gap-4 text-xs text-muted">
        <Swatch color={rgb(HOUGH_COLORS.horizontal)} label="Horizontal" />
        <Swatch color={rgb(HOUGH_COLORS.vertical)} label="Vertical" />
        <Swatch color={rgb(HOUGH_COLORS.oblique)} label="Slanted" />
      </div>
    );
  }
  return null;
};

export const ImagePipelineLab: React.FC<{ onOpenIn3D?: (plan: FloorPlanDataset) => void }> = ({ onOpenIn3D }) => {
  const [cv, setCv] = useState<CV | null>(null);
  const [cvError, setCvError] = useState<string | null>(null);
  const [testPlans, setTestPlans] = useState<TestPlanEntry[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [source, setSource] = useState<SourceImage | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Partial<PipelineOptions>>({});
  const [run, setRun] = useState<PipelineRun | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [stageId, setStageId] = useState<StageId>(7);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Only the latest image request may set the source (fast clicking between plans).
  const requestRef = useRef(0);

  useEffect(() => {
    let alive = true;
    loadOpenCv()
      .then(({ cv }) => alive && setCv(cv))
      .catch((err) => alive && setCvError(describeCvError(null, err)));
    return () => {
      alive = false;
    };
  }, []);

  const loadTestPlan = useCallback(async (plan: TestPlanEntry) => {
    const request = ++requestRef.current;
    setSelectedPlanId(plan.id);
    setSourceError(null);
    try {
      const response = await fetch(`${TEST_PLAN_DIR}${plan.file}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { image } = await decodeImage(await response.blob());
      if (request !== requestRef.current) return;
      setOverrides({});
      setSource({ label: plan.name, image, wallCount: plan.wallCount, truth: plan.groundTruthPieces, pixelsPerMeter: plan.pixelsPerMeter });
    } catch (err) {
      if (request === requestRef.current) setSourceError(`Could not load ${plan.file}: ${describeCvError(null, err)}`);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    fetch(`${TEST_PLAN_DIR}manifest.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ plans: TestPlanEntry[] }>;
      })
      .then((manifest) => {
        if (!alive) return;
        setTestPlans(manifest.plans);
        if (manifest.plans[0]) loadTestPlan(manifest.plans[0]);
      })
      .catch((err) => alive && setSourceError(`Could not load the test-plan list: ${describeCvError(null, err)}`));
    return () => {
      alive = false;
    };
  }, [loadTestPlan]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // so picking the same file again still fires
    if (!file) return;
    const request = ++requestRef.current;
    setSourceError(null);
    try {
      const { image, downscaled } = await decodeImage(file);
      if (request !== requestRef.current) return;
      setSelectedPlanId('');
      setOverrides({});
      setSource({
        label: file.name,
        image,
        note: downscaled ? `Scaled to ${image.width}×${image.height} while loading.` : undefined,
      });
    } catch (err) {
      if (request === requestRef.current) setSourceError(`Could not read ${file.name}: ${describeCvError(null, err)}`);
    }
  };

  useEffect(() => {
    if (!cv || !source) return;
    setRunning(true);
    // Debounces slider drags, and lets the busy state paint before the synchronous run.
    const timer = window.setTimeout(() => {
      try {
        setRun(runPipeline(cv, source.image, overrides));
        setRunError(null);
      } catch (err) {
        setRun(null);
        setRunError(`The pipeline failed: ${describeCvError(cv, err)}`);
      } finally {
        setRunning(false);
      }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [cv, source, overrides]);

  const stats = run?.stats;
  // Stage 1 may shrink the image; ground truth and scale are in input pixels.
  const resize = run ? run.workingSize.width / run.inputSize.width : 1;
  const score = useMemo(() => {
    if (!run || !source?.truth) return null;
    const truth = source.truth.map((t) => ({
      ...t,
      ax: t.ax * resize,
      ay: t.ay * resize,
      bx: t.bx * resize,
      by: t.by * resize,
      thickness: t.thickness * resize,
    }));
    return scoreWalls(run.walls, truth);
  }, [run, source, resize]);
  const calibrated = source?.pixelsPerMeter !== undefined;
  const openIn3D = () => {
    if (!run || !source || !onOpenIn3D) return;
    const metersPerPixel = source.pixelsPerMeter ? 1 / (source.pixelsPerMeter * resize) : guessMetersPerPixel(run.walls);
    onOpenIn3D(
      wallsToPlan(run.walls, metersPerPixel, {
        name: `Detected: ${source.label}`,
        width: run.workingSize.width,
        height: run.workingSize.height,
        skewDeg: run.vector.skewDeg,
      }),
    );
  };
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const stage = run?.stages.find((s) => s.id === stageId) ?? null;
  const twoFacePercent = stats && stats.total ? Math.round((stats.twoFaceSegments / stats.total) * 100) : 0;
  const errors = [cvError && `OpenCV.js failed to load: ${cvError}`, sourceError, runError].filter(Boolean) as string[];
  const placeholder = cvError
    ? 'OpenCV.js is not available.'
    : !cv
      ? 'Loading OpenCV.js, about 11 MB the first time…'
      : !source
        ? 'Loading the test plan…'
        : 'Running the pipeline…';

  const finding = !run
    ? 'Upload a floor plan image, or pick a test plan, and see what each processing step does to it.'
    : score
      ? `${run.walls.length} wall pieces from ${run.stats.total} raw segments. They cover ${percent(score.recall)} of the real wall length, and ${percent(score.precision)} of what was found is real wall.`
      : `${run.walls.length} wall pieces from ${run.stats.total} raw segments. This image has no known walls to score against.`;

  return (
    <div className="flex min-h-full flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          <h1 className="text-[22px] font-semibold leading-7">Image to plan</h1>
          <p className="num mt-1 text-muted">{finding}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {running && run && <Loader2 className="h-4 w-4 animate-spin text-muted" aria-label="Running" />}
          <label className="sr-only" htmlFor="test-plan">
            Test plan
          </label>
          <select
            id="test-plan"
            value={selectedPlanId}
            onChange={(e) => {
              const plan = testPlans.find((p) => p.id === e.target.value);
              if (plan) loadTestPlan(plan);
            }}
            className="h-8 max-w-[18rem] rounded-md border border-control bg-surface px-2 text-[13px] text-ink"
          >
            {!selectedPlanId && <option value="">{source ? `Uploaded: ${source.label}` : 'Choose a test plan'}</option>}
            {testPlans.map((plan) => (
              <option key={plan.id} value={plan.id} title={plan.description}>
                {plan.name}
              </option>
            ))}
          </select>
          <Button onClick={() => fileInputRef.current?.click()}>
            <ImageUp className="h-4 w-4" strokeWidth={1.5} /> Upload image
          </Button>
          {onOpenIn3D && (
            <Button variant="primary" onClick={openIn3D} disabled={!run || run.walls.length === 0}>
              <Box className="h-4 w-4" strokeWidth={1.5} /> Open in 3D viewer
            </Button>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
        </div>
      </header>

      {errors.map((message) => (
        <p key={message} role="alert" className="rounded-md bg-negative-soft px-3 py-2 text-[13px] text-negative-ink">
          {message}
        </p>
      ))}

      <div className="grid flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section className="flex min-w-0 flex-col gap-3" aria-label="Pipeline stages">
          {run && stage ? (
            <>
              <div role="tablist" aria-label="Stages" className="grid grid-cols-4 gap-2 md:grid-cols-7">
                {run.stages.map((s) => {
                  const selected = s.id === stage.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      title={`${s.id}. ${s.title}`}
                      onClick={() => setStageId(s.id)}
                      className={`flex flex-col gap-1.5 rounded-md border p-1.5 text-left transition-colors ${
                        selected ? 'border-ink bg-raised' : 'border-line hover:bg-raised'
                      }`}
                    >
                      <span className="block aspect-[4/3] overflow-hidden rounded-[4px] bg-raised">
                        <StageCanvas image={s.image} className="h-full w-full object-contain" label={`${s.title} thumbnail`} />
                      </span>
                      <span className={`truncate px-0.5 text-xs ${selected ? 'font-medium text-ink' : 'text-muted'}`}>
                        {s.id}. {s.title}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-[16px] font-semibold">
                  {stage.id}. {stage.title}
                </h2>
                <span className="num text-[13px] text-muted">{formatMs(stage.timingMs)}</span>
              </div>
              <div className="flex aspect-[4/3] max-h-[52vh] items-center justify-center overflow-hidden rounded-lg border border-line bg-raised">
                <StageCanvas image={stage.image} className="h-full w-full object-contain" label={`${stage.title} output`} />
              </div>
              <div className="flex flex-col gap-1.5 text-[13px]">
                <p className="text-ink">{STAGE_NOTES[stage.id]}</p>
                <StageLegend id={stage.id} />
                <p className="num text-muted">Settings: {formatEntries(stage.params)}</p>
                <p className="num text-muted">Result: {formatEntries(stage.counts)}</p>
              </div>

            </>
          ) : (
            <div className="flex aspect-[4/3] max-h-[62vh] flex-col items-center justify-center gap-2 rounded-lg border border-line bg-raised text-[13px] text-muted">
              {!cvError && !runError && <Loader2 className="h-5 w-5 animate-spin" />}
              <span>{placeholder}</span>
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-6" aria-label="Summary and settings">
          <section>
            <SectionTitle>Summary</SectionTitle>
            {run && source && stats ? (
              <>
                <KeyValue label="Image">
                  <span className="block max-w-[150px] truncate" title={source.label}>
                    {source.label}
                  </span>
                </KeyValue>
                <KeyValue label="Size">
                  {run.inputSize.width}×{run.inputSize.height}
                  {run.workingSize.width !== run.inputSize.width && ` → ${run.workingSize.width}×${run.workingSize.height}`}
                </KeyValue>
                <KeyValue label="Total time">{formatMs(run.totalMs)}</KeyValue>
                <KeyValue label="Walls found">{run.walls.length}</KeyValue>
                <KeyValue label="Deskew">{run.vector.skewDeg.toFixed(1)}°</KeyValue>
                <KeyValue label="Raw segments">{stats.total}</KeyValue>
                <KeyValue label="Horizontal / vertical / slanted">
                  {stats.horizontal} / {stats.vertical} / {stats.oblique}
                </KeyValue>
                <KeyValue label="In wall-face pairs">
                  {stats.twoFaceSegments} <span className="text-muted">({twoFacePercent}%)</span>
                </KeyValue>
                <KeyValue label="Same-edge duplicates">{stats.sameEdgeDuplicates}</KeyValue>

                {source.note && <p className="mt-1 text-xs text-muted">{source.note}</p>}
              </>
            ) : (
              <p className="text-[13px] text-muted">Waiting for the first run.</p>
            )}
          </section>

          {score && (
            <section>
              <SectionTitle aside={<span className="text-xs text-muted">within 6 px</span>}>Against the real walls</SectionTitle>
              <KeyValue label="Real wall length found">{percent(score.recall)}</KeyValue>
              <KeyValue label="Found length that is real">{percent(score.precision)}</KeyValue>
              <KeyValue label="F1 score">{score.f1.toFixed(3)}</KeyValue>
              <KeyValue label="Real pieces found">
                {score.piecesFound} <span className="text-muted">of {score.truthPieces}</span>
              </KeyValue>
            </section>
          )}

          {run && !calibrated && run.walls.length > 0 && (
            <p className="rounded-md bg-warning-soft px-3 py-2 text-[13px] text-warning-ink">
              This image has no scale yet, so the 3D size is a guess from wall thickness.
            </p>
          )}

          <section>
            <SectionTitle
              aside={
                <Button variant="ghost" onClick={() => setOverrides({})} disabled={Object.keys(overrides).length === 0} className="h-7 px-2">
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} /> Defaults
                </Button>
              }
            >
              Settings
            </SectionTitle>
            {TUNABLES.map((t) => {
              const value = overrides[t.key] ?? run?.options[t.key];
              return (
                <Slider
                  key={t.key}
                  label={t.label}
                  value={value ?? t.min}
                  display={value !== undefined ? `${value}${t.unit}` : '–'}
                  min={t.min}
                  max={t.max}
                  step={t.step}
                  disabled={!run}
                  hint={t.hint}
                  onChange={(v) => setOverrides((prev) => ({ ...prev, [t.key]: v }))}
                />
              );
            })}
          </section>

          <section className="rounded-md bg-raised p-4 text-[13px]">
            <h2 className="font-semibold">Next</h2>
            <p className="mt-1 text-muted">
              A scale step (click two points, type the real distance) so uploads open in 3D at their true size, and telling
              doors from windows in the gaps between wall pieces.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
};
