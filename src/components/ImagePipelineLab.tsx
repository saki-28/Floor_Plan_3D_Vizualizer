/**
 * Image to plan: runs the real OpenCV.js pipeline (stages 1–7) on a synthetic
 * test plan or an uploaded image. The selected stage (the walls, by default) gets
 * the big view under a strip of all seven; the side panel holds the summary, the
 * score against the real walls when the image is a test plan, and the settings.
 * The detected walls can be opened in the 3D viewer. The run is the one How it works → Pipeline
 * explains, step by step (src/vision/pipelineSession.ts).
 */

import React, { useMemo, useRef, useState } from 'react';
import { Box, ChevronDown, ImageUp, Loader2, RotateCcw, SlidersHorizontal } from 'lucide-react';
import type { FloorPlanDataset } from '../types/floorplan';
import type { StageId } from '../vision/pipeline';
import type { TunableKey } from '../vision/pipelineParams';
import {
  loadTestPlan,
  loadUploadedImage,
  planFromRun,
  setOverrides,
  useOpenCv,
  usePipelineRunner,
  usePipelineSession,
} from '../vision/pipelineSession';
import { scoreWalls } from '../vision/scoreWalls';
import { StageCanvas, StageLegend, formatEntries, formatMs } from './stageVisuals';
import { Button, KeyValue, SectionTitle, Slider } from './ui';

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

export const ImagePipelineLab: React.FC<{ onOpenIn3D?: (plan: FloorPlanDataset) => void }> = ({ onOpenIn3D }) => {
  // The image, settings and run are shared with How it works → Pipeline (pipelineSession.ts).
  const { cv, error: cvError } = useOpenCv();
  usePipelineRunner(cv);
  const { testPlans, selectedPlanId, source, sourceError, overrides, run, runError, running } = usePipelineSession();
  const [stageId, setStageId] = useState<StageId>(7);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // so picking the same file again still fires
    if (file) void loadUploadedImage(file);
  };

  const changed = Object.keys(overrides).length;
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
    if (run && source && onOpenIn3D) onOpenIn3D(planFromRun(run, source).plan);
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
    <div className="flex flex-col gap-4 lg:h-full">
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

      <div className="grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="flex min-w-0 flex-col gap-3 lg:min-h-0" aria-label="Pipeline stages">
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
              <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border border-line bg-raised lg:aspect-auto lg:min-h-[240px] lg:flex-1">
                <StageCanvas image={stage.image} className="h-full w-full object-contain" label={`${stage.title} output`} />
              </div>
              <div className="flex flex-col gap-1.5 text-[13px]">
                <p className="text-[14px] text-ink">{STAGE_NOTES[stage.id]}</p>
                <StageLegend id={stage.id} />
                <p className="num text-muted">Settings: {formatEntries(stage.params)}</p>
                <p className="num text-muted">Result: {formatEntries(stage.counts)}</p>
              </div>

            </>
          ) : (
            <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-lg border border-line bg-raised text-[13px] text-muted lg:aspect-auto lg:flex-1">
              {!cvError && !runError && <Loader2 className="h-5 w-5 animate-spin" />}
              <span>{placeholder}</span>
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-5 lg:min-h-0 lg:overflow-y-auto" aria-label="Summary and settings">
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

                {source.note && <p className="mt-1 text-[13px] text-muted">{source.note}</p>}
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

          {/* The six detection settings are for tuning, not for every visit: kept behind a disclosure. */}
          <details
            className="rounded-md border border-line"
            open={settingsOpen}
            onToggle={(e) => setSettingsOpen((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary className="flex h-10 cursor-pointer list-none items-center justify-between gap-2 px-3 text-[14px] font-medium [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-muted" strokeWidth={1.5} />
                Adjust detection
              </span>
              <span className="flex items-center gap-1.5 text-[13px] font-normal text-muted">
                {changed ? `${changed} changed` : `${TUNABLES.length} settings`}
                <ChevronDown className={`h-4 w-4 transition-transform ${settingsOpen ? 'rotate-180' : ''}`} strokeWidth={1.5} />
              </span>
            </summary>
            <div className="border-t border-line px-3 pb-3 pt-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-[13px] text-muted">For drawings the defaults miss.</p>
                <Button variant="ghost" onClick={() => setOverrides({})} disabled={!changed} className="h-7 px-2">
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} /> Defaults
                </Button>
              </div>
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
                    onChange={(v) => setOverrides({ ...overrides, [t.key]: v })}
                  />
                );
              })}
            </div>
          </details>

          <section className="rounded-md bg-raised p-4 text-[13px]">
            <h2 className="font-semibold">Not 100% accurate</h2>
            <p className="mt-1 text-muted">
              Detected walls can be missing, misplaced or extra, and an upload’s size is a guess. Check them against the real plan and fix them in Edit plan
              before relying on them.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
};
