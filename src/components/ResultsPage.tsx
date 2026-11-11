/**
 * How it works → Results: how well walls are found on real floor plans, the Pipeline page's rules
 * against the neural network we trained, on the same 400 CubiCasa5k test plans with the same scorer.
 * The numbers come from src/data/evaluationResults.json, which scripts/export-results.ts copies out
 * of the evaluation outputs (scores only; no images from the dataset are in the app).
 */

import React, { useMemo } from 'react';
import results from '../data/evaluationResults.json';
import { RESULTS_TEX } from '../data/formulas';
import { hrefOf } from '../router';
import { Formula, MathText } from './Formula';
import { GroupedBars, Legend, PlanScatter, TrainingCurve, pct, type BarGroup, type PlanPoint } from './resultsCharts';
import { LinkButton, PageHeader } from './ui';

type Row = [plan: string, rules: number, model: number, openings: number | null];

/** The first training run (4 Nov 2026), kept for the comparison in "Read with care". */
const EARLIER_RUN = { minutes: 95, wallIoU: 0.744 };
const ROWS = results.rows as Row[];

/** CubiCasa5k's own three groups of drawings. */
const KINDS: { id: string; label: string }[] = [
  { id: 'high_quality_architectural', label: 'High-quality architectural' },
  { id: 'high_quality', label: 'High-quality' },
  { id: 'colorful', label: 'Colourful' },
];
const kindOf = (plan: string) => plan.split('/')[0];
const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length);

/** A dashboard card: a title, the one thing to take away from it, then its chart or text. */
const Card: React.FC<{ title: string; takeaway?: React.ReactNode; aside?: React.ReactNode; className?: string; children: React.ReactNode }> = ({
  title,
  takeaway,
  aside,
  className = '',
  children,
}) => (
  <section className={`flex min-w-0 flex-col gap-4 rounded-xl border border-line p-5 ${className}`} aria-label={title}>
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0 max-w-[60ch]">
        <h2 className="text-[16px] font-semibold leading-6">{title}</h2>
        {takeaway && <p className="mt-1 text-[14px] leading-5 text-muted">{takeaway}</p>}
      </div>
      {aside}
    </div>
    {children}
  </section>
);

const Stat: React.FC<{ label: string; value: string; note: string; color?: string }> = ({ label, value, note, color }) => (
  <div className="flex flex-col gap-1 rounded-lg border border-line p-3 sm:p-4">
    <span className="flex items-center gap-1.5 text-[13px] text-muted">
      {color && <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />}
      {label}
    </span>
    <span className="text-[22px] font-semibold leading-8 text-ink sm:text-[28px] sm:leading-9">{value}</span>
    <span className="text-[13px] text-muted">{note}</span>
  </div>
);

export const ResultsPage: React.FC = () => {
  const { rules, model, training } = results;
  const better = ROWS.filter(([, r, m]) => m > r).length;
  const points: PlanPoint[] = useMemo(
    () => ROWS.map(([plan, r, m]) => ({ plan, label: `Plan ${plan.split('/')[1]}, ${KINDS.find((k) => k.id === kindOf(plan))?.label ?? ''}`, rules: r, model: m })),
    [],
  );
  const byKind: BarGroup[] = useMemo(
    () =>
      KINDS.map((kind) => {
        const rows = ROWS.filter(([plan]) => kindOf(plan) === kind.id);
        return { label: kind.label, note: `${rows.length} plans`, values: { rules: mean(rows.map((r) => r[1])), model: mean(rows.map((r) => r[2])) } };
      }),
    [],
  );
  const metrics: BarGroup[] = [
    { label: 'Wall IoU', values: { rules: rules.meanIoU, model: model.meanIoU } },
    { label: 'Precision', note: 'found wall that is wall', values: { rules: rules.precision, model: model.precision } },
    { label: 'Recall', note: 'wall that was found', values: { rules: rules.recall, model: model.recall } },
    { label: 'Door and window IoU', values: { rules: null, model: model.openingsIoU } },
  ];
  const falseShares: BarGroup[] = [
    { label: 'In a door or window', values: { rules: rules.falseShare.inOpenings, model: model.falseShare.inOpenings } },
    { label: 'Just beside a real wall', values: { rules: rules.falseShare.besideWall, model: model.falseShare.besideWall } },
    { label: 'Away from any wall', values: { rules: rules.falseShare.elsewhere, model: model.falseShare.elsewhere } },
  ];
  const falseTotal = (s: typeof rules.falseShare) => s.inOpenings + s.besideWall + s.elsewhere;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Results"
        description={`How well walls are found on real floor plans: the Pipeline page's hand-written rules against a neural network we trained, on the same ${results.plans} test plans and scored the same way.`}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Stat label="Rules, wall IoU" value={pct(rules.meanIoU)} note={`median ${pct(rules.medianIoU)}`} color="var(--series-rules)" />
        <Stat label="Trained model, wall IoU" value={pct(model.meanIoU)} note={`median ${pct(model.medianIoU)}`} color="var(--series-model)" />
        <Stat label="Plans where the model is better" value={`${better} of ${ROWS.length}`} note="each plan scored on its own" />
        <Stat label="Model, door and window IoU" value={pct(model.openingsIoU ?? 0)} note="the rules do not find openings" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <Card
          title="Rules against the trained model"
          takeaway={`The model finds more of the walls (recall ${pct(rules.recall)} → ${pct(model.recall)}), and far less of what it marks is not wall (precision ${pct(rules.precision)} → ${pct(model.precision)}).`}
          aside={<Legend />}
        >
          <GroupedBars groups={metrics} label="Mean wall IoU, precision, recall and door and window IoU for the rules and the trained model" missingText="does not find them" />
        </Card>

        <Card
          title="Plan by plan"
          takeaway={`Each dot is a test plan; above the line the model scored higher, on ${better} of ${ROWS.length}. Only ${ROWS.filter((r) => r[2] < rules.meanIoU).length} of its plans fall below the rules' average. Point at a dot for its scores.`}
        >
          <div className="mx-auto w-full max-w-[380px]">
            <PlanScatter points={points} label={`Wall IoU of the trained model against the rules for each of the ${ROWS.length} test plans`} />
          </div>
        </Card>

        <Card title="By kind of drawing" takeaway="CubiCasa5k's three kinds. Architectural drawings, most of the test set, are the hardest for both; the model gains most there." aside={<Legend />}>
          <GroupedBars groups={byKind} label="Mean wall IoU by kind of drawing for the rules and the trained model" />
        </Card>

        <Card
          title="Where the wrong wall pixels are"
          takeaway={`Of everything marked as wall, ${pct(falseTotal(rules.falseShare))} is not wall for the rules and ${pct(falseTotal(model.falseShare))} for the model. The rules mistake the lines across doorways and windows for wall; the model has learnt they are openings.`}
          aside={<Legend />}
        >
          <GroupedBars groups={falseShares} max={0.25} label="Share of found wall pixels that are not wall, by where they are, for the rules and the trained model" />
        </Card>

        <Card
          title="How the model was trained"
          takeaway={`A U-Net (${training.parametersMillions} M parameters) labels each pixel as background, wall, door or window. ${training.trainPlans.toLocaleString('en')} plans, ${Math.round(training.minutes)} minutes on ${training.gpus} GPUs; the checkpoint kept scored best on the validation plans, at step ${model.checkpointStep.toLocaleString('en')}.`}
        >
          <div>
            <h3 className="mb-2 text-[13px] text-muted">Wall IoU on the {training.valPlans} validation plans during training</h3>
            <TrainingCurve points={training.curve} kept={model.checkpointStep} label="The model's wall IoU on the validation plans at each check during training" />
          </div>
          <details>
            <summary className="cursor-pointer text-[13px] text-muted hover:text-ink">The loss it learns from</summary>
            <div className="mt-2 rounded-lg bg-raised px-4 py-1">
              <Formula tex={RESULTS_TEX.loss} />
            </div>
            <p className="mt-2 text-[13px] leading-5 text-muted">
              <MathText>{RESULTS_TEX.lossSymbols}</MathText>
            </p>
          </details>
          <p className="text-[13px] leading-5 text-muted">
            The whole run is one notebook in the repository, <code className="font-mono text-[12px]">training/floorplan3d_walls.ipynb</code>.
          </p>
        </Card>

        <Card
          title="What is measured"
          takeaway="Both are compared with walls traced by hand, pixel by pixel. IoU is 100% only when every wall pixel is found and nothing else is."
        >
          <div className="rounded-lg bg-raised px-4 py-2">
            <Formula tex={RESULTS_TEX.scores} className="text-[15px]" />
          </div>
          <p className="text-[14px] leading-6">
            <MathText>{'$T$ is the true walls (CubiCasa5k’s wall polygons with doors and windows cut out), $F$ the walls found, both drawn on the plan’s own pixel grid. Doors and windows are scored the same way.'}</MathText>
          </p>
        </Card>
      </div>

      <section aria-labelledby="results-care" className="rounded-xl border border-line p-5">
        <h2 id="results-care" className="text-[16px] font-semibold leading-6">
          Read with care
        </h2>
        <ul className="mt-3 grid list-disc gap-x-10 gap-y-2 pl-5 text-[14px] leading-6 marker:text-muted lg:grid-cols-2">
          <li>
            Neither method is 100% accurate. These scores say how well walls are found on plans like CubiCasa5k’s; any single plan can do better or worse,
            so check a result against the real plan before relying on it. FloorPlan3D is used at your own risk.
          </li>
          <li>
            These numbers come from one training run of about {Math.round(training.minutes / 60)} hours. An earlier run of {EARLIER_RUN.minutes} minutes scored{' '}
            {pct(EARLIER_RUN.wallIoU)}: nearly twice the training time added less than a point.
          </li>
          <li>
            Published results on CubiCasa5k use other splits, other ways of drawing the true walls and other scores, so these numbers cannot be put side by side
            with theirs.
          </li>
          <li>
            The trained model is not in the app yet: Image to plan still uses the rules. CubiCasa5k may only be used for non-commercial work, and so may the
            model. Times per plan were measured on different hardware ({rules.msPerPlan} ms CPU, {model.msPerPlan} ms GPU).
          </li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <LinkButton href={hrefOf('pipeline')}>How the rules work</LinkButton>
          <LinkButton href={hrefOf('about')} variant="ghost">
            Sources and limits
          </LinkButton>
        </div>
      </section>
    </div>
  );
};
