/**
 * How it works → Pipeline: the steps that turn an image of a plan into walls in 3D, explained on a
 * real run. It is the same run Image to plan shows (src/vision/pipelineSession.ts): every image and
 * number here comes from running the steps on that image in this browser. One step fills the
 * screen at a time (no long scrolling page): its image with this run's numbers under it, and beside
 * it what it does, its formula (typeset with KaTeX) and, on request, the call behind it. The list of
 * steps, Previous / Next and the arrow keys move between them.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Box, ImageUp, Loader2 } from 'lucide-react';
import type { FloorPlanDataset } from '../types/floorplan';
import { PIPELINE_STEPS, type PipelineStep, type StepId } from '../data/pipelineSteps';
import { model as modelScore, rules as rulesScore, plans as testPlanCount } from '../data/evaluationResults.json';
import { hrefOf } from '../router';
import {
  loadTestPlan,
  loadUploadedImage,
  planFromRun,
  useOpenCv,
  usePipelineRunner,
  usePipelineSession,
} from '../vision/pipelineSession';
import { Formula, MathText } from './Formula';
import { PlanThumbnail } from './PlanThumbnail';
import { StageCanvas, StageLegend, formatMs } from './stageVisuals';
import { Button, LinkButton, PageHeader } from './ui';

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

type View = StepId | 'results';
const ORDER: View[] = [...PIPELINE_STEPS.map((s) => s.id), 'results'];
const titleOf = (view: View) => (view === 'results' ? 'How well it works' : PIPELINE_STEPS.find((s) => s.id === view)!.title);

/** Settings or results of one step, as name–value rows. */
const Figures: React.FC<{ title: string; entries: [string, React.ReactNode][] }> = ({ title, entries }) =>
  entries.length === 0 ? null : (
    <div>
      <h3 className="mb-1 text-[13px] font-medium text-muted">{title}</h3>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 text-[13px]">
        {entries.map(([name, value]) => (
          <React.Fragment key={name}>
            <dt className="border-b border-rule py-1 text-muted">{name}</dt>
            <dd className="num border-b border-rule py-1 text-right text-ink">{value}</dd>
          </React.Fragment>
        ))}
      </dl>
    </div>
  );

/** What a step does, its formula and what the symbols mean; the code is there on request. */
const StepText: React.FC<{ step: PipelineStep; children?: React.ReactNode }> = ({ step, children }) => (
  <div className="flex min-w-0 flex-col gap-4">
    <h2 className="flex items-baseline gap-2 text-[20px] font-semibold leading-7">
      <span className="num text-muted">{step.id}</span>
      {step.title}
    </h2>
    <p className="max-w-[65ch] text-[15px] leading-6 text-ink">{step.does}</p>
    {step.parts && (
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-[14px] leading-5 text-ink marker:text-muted">
        {step.parts.map((part) => (
          <li key={part}>{part}</li>
        ))}
      </ol>
    )}
    <div className="rounded-lg bg-raised px-4 py-2">
      <Formula tex={step.tex} className="text-[15px]" />
      <p className="pb-2 text-[14px] leading-6 text-muted">
        <MathText>{step.symbols}</MathText>
      </p>
    </div>
    {children}
    <details className="group">
      <summary className="cursor-pointer text-[13px] text-muted hover:text-ink">Show the code{step.source ? ` · method: ${step.source}` : ''}</summary>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-line px-3 py-2 font-mono text-xs leading-5 text-ink">{step.code}</pre>
    </details>
  </div>
);

/** A step's picture (with this run's numbers under it) beside its explanation, filling the step area. */
const StepLayout: React.FC<{ picture: React.ReactNode; below?: React.ReactNode; text: React.ReactNode }> = ({ picture, below, text }) => (
  <div className="grid gap-6 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
    <div className="flex min-w-0 flex-col gap-3 lg:min-h-0">
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border border-line bg-raised lg:aspect-auto lg:min-h-[220px] lg:flex-1">
        {picture}
      </div>
      {below}
    </div>
    <div className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pr-2">{text}</div>
  </div>
);

export const PipelinePage: React.FC<{ onOpenIn3D?: (plan: FloorPlanDataset) => void }> = ({ onOpenIn3D }) => {
  const { cv, error: cvError } = useOpenCv();
  usePipelineRunner(cv);
  const { testPlans, selectedPlanId, source, sourceError, overrides, run, runError, running } = usePipelineSession();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>(1);

  const detected = useMemo(() => (run && source ? planFromRun(run, source) : null), [run, source]);
  const extent = useMemo(() => {
    if (!detected || detected.plan.walls.length === 0) return null;
    const xs = detected.plan.walls.flatMap((w) => [w.start.x, w.end.x]);
    const zs = detected.plan.walls.flatMap((w) => [w.start.z, w.end.z]);
    return { width: Math.max(...xs) - Math.min(...xs), depth: Math.max(...zs) - Math.min(...zs) };
  }, [detected]);

  const index = ORDER.indexOf(view);
  const go = (offset: number) => setView(ORDER[Math.min(ORDER.length - 1, Math.max(0, index + offset))]);

  // Left and right arrow keys step through, unless someone is typing or choosing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void loadUploadedImage(file);
  };

  const errors = [cvError && `OpenCV.js failed to load: ${cvError}`, sourceError, runError].filter(Boolean) as string[];
  const placeholder = cvError ? 'OpenCV.js is not available.' : !cv ? 'Loading OpenCV.js, about 11 MB the first time…' : 'Running the steps…';
  const changedSettings = Object.keys(overrides).length;
  const step = view === 'results' ? null : PIPELINE_STEPS.find((s) => s.id === view)!;
  const stage = typeof view === 'number' ? run?.stages.find((s) => s.id === view) ?? null : null;

  let content: React.ReactNode;
  if (view === 'results') {
    content = (
      <div className="flex h-full items-center">
        <div className="max-w-[65ch]">
          <h2 className="text-[20px] font-semibold leading-7">How well it works</h2>
          <p className="mt-3 text-[16px] leading-7">
            These steps are rules written by hand. On {testPlanCount} real plans from the CubiCasa5k test set they find walls with{' '}
            <strong className="font-semibold">{percent(rulesScore.meanIoU)}</strong> overlap with the true walls (IoU). A neural network we trained on
            the same kind of plans reaches <strong className="font-semibold">{percent(modelScore.meanIoU)}</strong> on the same plans, scored the same
            way. The rules do best on clean drawings with solid walls, like the test plans above.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <LinkButton href={hrefOf('results')} variant="primary">
              See the results
            </LinkButton>
            <LinkButton href={hrefOf('graphics')}>How the 3D is drawn</LinkButton>
          </div>
        </div>
      </div>
    );
  } else if (step && step.id === 8) {
    content = (
      <StepLayout
        picture={
          detected && detected.plan.walls.length > 0 ? (
            <div className="h-full w-full p-4">
              <PlanThumbnail walls={detected.plan.walls} openings={[]} className="h-full w-full" title="Top view of the detected walls, in metres" />
            </div>
          ) : (
            <span className="text-[13px] text-muted">{run ? 'No walls were found in this image.' : placeholder}</span>
          )
        }
        below={
          <div className="flex flex-wrap items-start justify-between gap-4">
            {detected && (
              <div className="min-w-[240px] flex-1">
                <Figures
                  title="In this run"
                  entries={[
                    ['Metres per pixel', `${detected.metersPerPixel.toFixed(4)} m`],
                    ['Scale', detected.scaleKnown ? 'known for this test plan' : 'guessed from wall thickness'],
                    ['Walls', detected.plan.walls.length],
                    ...(extent ? ([['Building size', `${extent.width.toFixed(1)} × ${extent.depth.toFixed(1)} m`]] as [string, string][]) : []),
                  ]}
                />
              </div>
            )}
            {onOpenIn3D && (
              <Button variant="primary" disabled={!detected || detected.plan.walls.length === 0} onClick={() => detected && onOpenIn3D(detected.plan)}>
                <Box className="h-4 w-4" strokeWidth={1.5} /> Open these walls in 3D
              </Button>
            )}
          </div>
        }
        text={<StepText step={step} />}
      />
    );
  } else if (step) {
    content = (
      <StepLayout
        picture={
          stage ? (
            <StageCanvas image={stage.image} className="h-full w-full object-contain" label={`Step ${step.id}, ${step.title}: the image after this step`} />
          ) : (
            <span className="text-[13px] text-muted">{placeholder}</span>
          )
        }
        below={
          stage && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <StageLegend id={stage.id} />
                <span className="num text-xs text-muted">
                  {stage.image.width}×{stage.image.height} px · {formatMs(stage.timingMs)}
                </span>
              </div>
              <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Figures title="Settings" entries={Object.entries(stage.params)} />
                <Figures title="In this run" entries={Object.entries(stage.counts).map(([k, v]) => [k, v.toLocaleString('en')])} />
              </div>
            </>
          )
        }
        text={<StepText step={step} />}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:h-full">
      <PageHeader
        title="Pipeline"
        description="How an image of a floor plan becomes walls in 3D, one step at a time. Every picture and number comes from running the steps on the plan below, in your browser."
        actions={<LinkButton href={hrefOf('imageLab')}>Change settings in Image to plan</LinkButton>}
      />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-line px-4 py-2.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-5 gap-y-1 text-[13px]">
          <span className="min-w-0 truncate font-medium text-ink" title={source?.label}>
            {source ? source.label : 'No image yet'}
          </span>
          {run && (
            <>
              <span className="num text-muted">
                {run.inputSize.width}×{run.inputSize.height} px
              </span>
              <span className="num text-muted">all steps {formatMs(run.totalMs)}</span>
              <span className="num text-muted">
                {run.walls.length} walls from {run.stats.total} segments
              </span>
              {changedSettings > 0 && (
                <span className="text-muted">
                  {changedSettings} setting{changedSettings > 1 ? 's' : ''} changed in Image to plan
                </span>
              )}
            </>
          )}
          {running && <Loader2 className="h-4 w-4 animate-spin self-center text-muted" aria-label="Running" />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="pipeline-test-plan">
            Test plan
          </label>
          <select
            id="pipeline-test-plan"
            value={selectedPlanId}
            onChange={(e) => {
              const plan = testPlans.find((p) => p.id === e.target.value);
              if (plan) void loadTestPlan(plan);
            }}
            className="h-8 max-w-[16rem] rounded-md border border-control bg-surface px-2 text-[13px] text-ink"
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
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
        </div>
      </div>

      {errors.map((message) => (
        <p key={message} role="alert" className="rounded-md bg-negative-soft px-3 py-2 text-[13px] text-negative-ink">
          {message}
        </p>
      ))}

      <div className="grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[188px_minmax(0,1fr)]">
        <nav aria-label="Steps" className="hidden lg:block">
          <ol className="flex flex-col gap-0.5 text-[14px]">
            {ORDER.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  aria-current={view === id ? 'step' : undefined}
                  onClick={() => setView(id)}
                  className={`flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left transition-colors ${
                    view === id ? 'bg-active font-medium text-ink' : 'text-muted hover:bg-raised hover:text-ink'
                  }`}
                >
                  <span className="num w-3 text-[13px] text-muted">{id === 'results' ? '' : id}</span>
                  {titleOf(id)}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <section aria-label={`Step: ${titleOf(view)}`} className="flex min-w-0 flex-col gap-4 lg:min-h-0">
          <label className="flex items-center gap-2 text-[13px] text-muted lg:hidden">
            Step
            <select
              value={String(view)}
              onChange={(e) => setView(e.target.value === 'results' ? 'results' : (Number(e.target.value) as StepId))}
              className="h-9 min-w-0 flex-1 rounded-md border border-control bg-surface px-2 text-[14px] text-ink"
            >
              {ORDER.map((id) => (
                <option key={id} value={String(id)}>
                  {id === 'results' ? '' : `${id}. `}
                  {titleOf(id)}
                </option>
              ))}
            </select>
          </label>
          <div className="min-w-0 lg:min-h-0 lg:flex-1">{content}</div>
          <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
            <Button onClick={() => go(-1)} disabled={index === 0}>
              <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
              <span className="hidden sm:inline">{index > 0 ? titleOf(ORDER[index - 1]) : 'Previous'}</span>
            </Button>
            <span className="num text-[13px] text-muted">
              {index + 1} of {ORDER.length} · arrow keys move
            </span>
            <Button onClick={() => go(1)} disabled={index === ORDER.length - 1}>
              <span className="hidden sm:inline">{index < ORDER.length - 1 ? titleOf(ORDER[index + 1]) : 'Next'}</span>
              <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
};
