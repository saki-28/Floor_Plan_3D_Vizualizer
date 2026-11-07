/**
 * How it works → Pipeline: the steps that turn an image of a plan into walls in 3D, explained on a
 * real run. It is the same run Image to plan shows (src/vision/pipelineSession.ts): every image and
 * number here comes from running the steps on that image in this browser. Each step has its image,
 * what it does, its formula (typeset with KaTeX), its settings and results, and the call behind it.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, ImageUp, Loader2 } from 'lucide-react';
import type { FloorPlanDataset } from '../types/floorplan';
import { PIPELINE_STEPS, type PipelineStep, type StepId } from '../data/pipelineSteps';
import { model as modelScore, rules as rulesScore, plans as testPlanCount } from '../data/evaluationResults.json';
import { hrefOf } from '../router';
import type { StageResult } from '../vision/pipeline';
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
const sectionId = (id: StepId | 'results') => `pipeline-step-${id}`;

/** Settings or results of one step, as name–value rows. */
const Figures: React.FC<{ title: string; entries: [string, React.ReactNode][] }> = ({ title, entries }) =>
  entries.length === 0 ? null : (
    <div>
      <h4 className="mb-1 text-xs font-medium text-muted">{title}</h4>
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

const StepText: React.FC<{ step: PipelineStep; children?: React.ReactNode }> = ({ step, children }) => (
  <div className="flex min-w-0 flex-col gap-4">
    <h2 id={`${sectionId(step.id)}-title`} className="flex items-baseline gap-2 text-[18px] font-semibold leading-6">
      <span className="num text-muted">{step.id}</span>
      {step.title}
    </h2>
    <p className="text-[14px] leading-6 text-ink">{step.does}</p>
    {step.parts && (
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-[13px] leading-5 text-ink marker:text-muted">
        {step.parts.map((part) => (
          <li key={part}>{part}</li>
        ))}
      </ol>
    )}
    <div className="rounded-lg bg-raised px-4 py-2">
      <Formula tex={step.tex} className="text-[15px]" />
      <p className="pb-2 text-[13px] leading-5 text-muted">
        <MathText>{step.symbols}</MathText>
      </p>
    </div>
    {children}
    <div>
      <h4 className="mb-1 text-xs font-medium text-muted">Code</h4>
      <pre className="overflow-x-auto rounded-md border border-line px-3 py-2 font-mono text-xs leading-5 text-ink">{step.code}</pre>
      {step.source && <p className="mt-2 text-xs text-muted">Method: {step.source}. Full references are on the About page.</p>}
    </div>
  </div>
);

/** One of the seven image steps: its picture beside its explanation and its numbers from this run. */
const StageSection: React.FC<{ step: PipelineStep; stage: StageResult | null; placeholder: string }> = ({ step, stage, placeholder }) => (
  <section id={sectionId(step.id)} aria-labelledby={`${sectionId(step.id)}-title`} className="grid scroll-mt-4 gap-6 py-10 first:pt-2 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
    <figure className="flex min-w-0 flex-col gap-2 self-start lg:sticky lg:top-4">
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border border-line bg-raised">
        {stage ? (
          <StageCanvas image={stage.image} className="h-full w-full object-contain" label={`Step ${step.id}, ${step.title}: the image after this step`} />
        ) : (
          <span className="text-[13px] text-muted">{placeholder}</span>
        )}
      </div>
      {stage && (
        <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <StageLegend id={stage.id} />
          <span className="num text-xs text-muted">{stage.image.width}×{stage.image.height} px · {formatMs(stage.timingMs)}</span>
        </figcaption>
      )}
    </figure>
    <StepText step={step}>
      {stage && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <Figures title="Settings" entries={Object.entries(stage.params)} />
          <Figures title="In this run" entries={Object.entries(stage.counts).map(([k, v]) => [k, v.toLocaleString('en')])} />
        </div>
      )}
    </StepText>
  </section>
);

export const PipelinePage: React.FC<{ onOpenIn3D?: (plan: FloorPlanDataset) => void }> = ({ onOpenIn3D }) => {
  const { cv, error: cvError } = useOpenCv();
  usePipelineRunner(cv);
  const { testPlans, selectedPlanId, source, sourceError, overrides, run, runError, running } = usePipelineSession();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState<StepId | 'results'>(1);

  const detected = useMemo(() => (run && source ? planFromRun(run, source) : null), [run, source]);
  const extent = useMemo(() => {
    if (!detected || detected.plan.walls.length === 0) return null;
    const xs = detected.plan.walls.flatMap((w) => [w.start.x, w.end.x]);
    const zs = detected.plan.walls.flatMap((w) => [w.start.z, w.end.z]);
    return { width: Math.max(...xs) - Math.min(...xs), depth: Math.max(...zs) - Math.min(...zs) };
  }, [detected]);

  // The step nearest the top of the page is highlighted in the index.
  useEffect(() => {
    const sections = [...PIPELINE_STEPS.map((s) => s.id), 'results' as const].map((id) => document.getElementById(sectionId(id)));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const id = visible?.target.id.replace('pipeline-step-', '');
        if (id) setCurrent(id === 'results' ? 'results' : (Number(id) as StepId));
      },
      { rootMargin: '-10% 0px -60% 0px' },
    );
    for (const section of sections) if (section) observer.observe(section);
    return () => observer.disconnect();
  }, []);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void loadUploadedImage(file);
  };

  const errors = [cvError && `OpenCV.js failed to load: ${cvError}`, sourceError, runError].filter(Boolean) as string[];
  const placeholder = cvError ? 'OpenCV.js is not available.' : !cv ? 'Loading OpenCV.js, about 11 MB the first time…' : 'Running the steps…';
  const changedSettings = Object.keys(overrides).length;
  const index: [StepId | 'results', string][] = [...PIPELINE_STEPS.map((s): [StepId, string] => [s.id, s.title]), ['results', 'How well it works']];
  const intoStep = PIPELINE_STEPS[PIPELINE_STEPS.length - 1];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Pipeline"
        description="How an image of a floor plan becomes walls in 3D, one step at a time. Every image and number on this page comes from running the steps on the plan below, in your browser."
        actions={<LinkButton href={hrefOf('imageLab')}>Change settings in Image to plan</LinkButton>}
      />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-line px-4 py-3">
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

      <div className="grid gap-8 xl:grid-cols-[176px_minmax(0,1fr)]">
        <nav aria-label="Steps" className="hidden xl:block">
          <ol className="sticky top-4 flex flex-col gap-0.5 text-[13px]">
            {index.map(([id, title]) => (
              <li key={id}>
                <button
                  type="button"
                  aria-current={current === id ? 'step' : undefined}
                  onClick={() => document.getElementById(sectionId(id))?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition-colors ${
                    current === id ? 'bg-active font-medium text-ink' : 'text-muted hover:bg-raised hover:text-ink'
                  }`}
                >
                  <span className="num w-3 text-xs text-muted">{id === 'results' ? '' : id}</span>
                  {title}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="flex min-w-0 flex-col divide-y divide-line">
          {PIPELINE_STEPS.filter((step) => step.id !== 8).map((step) => (
            <StageSection key={step.id} step={step} stage={run?.stages.find((s) => s.id === step.id) ?? null} placeholder={placeholder} />
          ))}

          <section id={sectionId(8)} aria-labelledby={`${sectionId(8)}-title`} className="grid scroll-mt-4 gap-6 py-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <figure className="flex min-w-0 flex-col gap-2 self-start lg:sticky lg:top-4">
              <div className="flex aspect-[4/3] items-center justify-center rounded-lg border border-line bg-raised p-4">
                {detected && detected.plan.walls.length > 0 ? (
                  <PlanThumbnail walls={detected.plan.walls} openings={[]} className="h-full w-full" title="Top view of the detected walls, in metres" />
                ) : (
                  <span className="text-[13px] text-muted">{run ? 'No walls were found in this image.' : placeholder}</span>
                )}
              </div>
              <figcaption className="text-xs text-muted">Top view of the walls in metres, as the 3D viewer receives them.</figcaption>
            </figure>
            <StepText step={intoStep}>
              {detected && (
                <Figures
                  title="In this run"
                  entries={[
                    ['Metres per pixel', `${detected.metersPerPixel.toFixed(4)} m`],
                    ['Scale', detected.scaleKnown ? 'known for this test plan' : 'guessed from wall thickness'],
                    ['Walls', detected.plan.walls.length],
                    ...(extent ? ([['Building size', `${extent.width.toFixed(1)} × ${extent.depth.toFixed(1)} m`]] as [string, string][]) : []),
                  ]}
                />
              )}
              {onOpenIn3D && (
                <div>
                  <Button variant="primary" disabled={!detected || detected.plan.walls.length === 0} onClick={() => detected && onOpenIn3D(detected.plan)}>
                    <Box className="h-4 w-4" strokeWidth={1.5} /> Open these walls in 3D
                  </Button>
                </div>
              )}
            </StepText>
          </section>

          <section id={sectionId('results')} aria-labelledby="pipeline-results-title" className="scroll-mt-4 py-10">
            <div className="max-w-3xl">
              <h2 id="pipeline-results-title" className="text-[18px] font-semibold leading-6">
                How well it works
              </h2>
              <p className="mt-3 text-[14px] leading-6">
                These steps are rules written by hand. On {testPlanCount} real plans from the CubiCasa5k test set they find walls with{' '}
                <strong className="font-semibold">{percent(rulesScore.meanIoU)}</strong> overlap with the true walls (IoU). A neural network we trained
                on the same kind of plans reaches <strong className="font-semibold">{percent(modelScore.meanIoU)}</strong> on the same plans, scored the
                same way. The rules do best on clean drawings with solid walls, like the test plans above.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <LinkButton href={hrefOf('results')}>See the results</LinkButton>
                <LinkButton href={hrefOf('graphics')} variant="ghost">
                  How the 3D is drawn
                </LinkButton>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
