/**
 * How it works → Results: how well walls are found on real floor plans, the Pipeline page's rules
 * against the neural network we trained, on the same 400 CubiCasa5k test plans with the same scorer.
 * The numbers come from src/data/evaluationResults.json, which scripts/export-results.ts copies out
 * of the evaluation outputs (scores only; no images from the dataset are in the app).
 */

import React, { useMemo, useState } from 'react';
import results from '../data/evaluationResults.json';
import { RESULTS_TEX } from '../data/formulas';
import { hrefOf } from '../router';
import { Formula, MathText } from './Formula';
import { GroupedBars, Legend, PlanScatter, TrainingCurve, pct, type BarGroup, type PlanPoint } from './resultsCharts';
import { LinkButton, PageHeader } from './ui';

type Row = [plan: string, rules: number, model: number, openings: number | null];
const ROWS = results.rows as Row[];

/** CubiCasa5k's own three groups of drawings. */
const KINDS: { id: string; label: string }[] = [
  { id: 'high_quality_architectural', label: 'High-quality architectural' },
  { id: 'high_quality', label: 'High-quality' },
  { id: 'colorful', label: 'Colourful' },
];
const kindOf = (plan: string) => plan.split('/')[0];
const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length);

const Section: React.FC<{ id: string; title: string; children: React.ReactNode; aside?: React.ReactNode }> = ({ id, title, children, aside }) => (
  <section aria-labelledby={id} className="border-t border-line pt-8">
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
      <h2 id={id} className="text-[18px] font-semibold leading-6">
        {title}
      </h2>
      {aside}
    </div>
    {children}
  </section>
);

const Stat: React.FC<{ label: string; value: string; note: string; color?: string }> = ({ label, value, note, color }) => (
  <div className="flex flex-col gap-1 rounded-lg border border-line p-4">
    <span className="flex items-center gap-1.5 text-[13px] text-muted">
      {color && <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />}
      {label}
    </span>
    <span className="text-[28px] font-semibold leading-9 text-ink">{value}</span>
    <span className="text-xs text-muted">{note}</span>
  </div>
);

type SortKey = 'plan' | 'rules' | 'model' | 'gain';

/** Every test plan's scores: the table behind the charts. */
const PlanTable: React.FC = () => {
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: 'gain', descending: false });
  const sorted = useMemo(() => {
    const value = (row: Row) => (sort.key === 'plan' ? row[0] : sort.key === 'rules' ? row[1] : sort.key === 'model' ? row[2] : row[2] - row[1]);
    return [...ROWS].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      const order = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number);
      return sort.descending ? -order : order;
    });
  }, [sort]);
  const header = (key: SortKey, text: string, align = 'text-right') => (
    <th scope="col" aria-sort={sort.key === key ? (sort.descending ? 'descending' : 'ascending') : 'none'} className={`sticky top-0 bg-surface px-3 py-2 font-medium ${align}`}>
      <button type="button" onClick={() => setSort((s) => ({ key, descending: s.key === key ? !s.descending : key !== 'plan' }))} className="inline-flex items-center gap-1 text-muted hover:text-ink">
        {text}
        <span aria-hidden className="w-2 text-ink">
          {sort.key === key ? (sort.descending ? '↓' : '↑') : ''}
        </span>
      </button>
    </th>
  );
  return (
    <div className="max-h-[480px] overflow-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-[13px]">
        <caption className="sr-only">Wall IoU of the rules and of the trained model on each of the {ROWS.length} test plans</caption>
        <thead className="border-b border-line">
          <tr>
            {header('plan', 'Plan', 'text-left')}
            <th scope="col" className="sticky top-0 bg-surface px-3 py-2 text-left font-medium text-muted">
              Kind
            </th>
            {header('rules', 'Rules')}
            {header('model', 'Model')}
            {header('gain', 'Gain')}
            <th scope="col" className="sticky top-0 bg-surface px-3 py-2 text-right font-medium text-muted">
              Doors and windows
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(([plan, rules, model, openings]) => (
            <tr key={plan} className="border-b border-rule last:border-0">
              <td className="num px-3 py-1.5 text-ink">{plan.split('/')[1]}</td>
              <td className="px-3 py-1.5 text-muted">{KINDS.find((k) => k.id === kindOf(plan))?.label}</td>
              <td className="num px-3 py-1.5 text-right">{pct(rules)}</td>
              <td className="num px-3 py-1.5 text-right">{pct(model)}</td>
              <td className={`num px-3 py-1.5 text-right ${model < rules ? 'text-negative' : 'text-ink'}`}>
                {model >= rules ? '+' : '−'}
                {pct(Math.abs(model - rules))}
              </td>
              <td className="num px-3 py-1.5 text-right text-muted">{openings === null ? '–' : pct(openings)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

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
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Results"
        description={`How well walls are found on real floor plans: the hand-written rules of the Pipeline page against a neural network we trained, on the same ${results.plans} test plans and scored the same way.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Rules, wall IoU" value={pct(rules.meanIoU)} note={`median ${pct(rules.medianIoU)}`} color="var(--series-rules)" />
        <Stat label="Trained model, wall IoU" value={pct(model.meanIoU)} note={`median ${pct(model.medianIoU)}`} color="var(--series-model)" />
        <Stat label="Plans where the model is better" value={`${better} of ${ROWS.length}`} note="each plan scored on its own" />
        <Stat label="Model, door and window IoU" value={pct(model.openingsIoU ?? 0)} note="the rules do not find openings" />
      </div>

      <Section id="results-measure" title="What is measured">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
          <div className="flex flex-col gap-3 text-[14px] leading-6">
            <p>
              Each plan in CubiCasa5k comes with its walls, doors and windows traced by hand as polygons. The true walls <MathText>{'$T$'}</MathText> are
              those polygons with the doors and windows cut out, drawn on the plan’s own pixel grid. The walls found <MathText>{'$F$'}</MathText> are
              drawn on the same grid: the rules’ walls as centerlines at their thickness, the model’s as the pixels it labels wall. Then the two are
              compared pixel by pixel.
            </p>
            <p>
              IoU (intersection over union) is the main score: 100% only when every wall pixel is found and nothing else is. Precision and recall say
              which way it falls short. Doors and windows are scored the same way against their own polygons.
            </p>
          </div>
          <div className="self-start rounded-lg bg-raised px-4 py-2">
            <Formula tex={RESULTS_TEX.scores} className="text-[15px]" />
          </div>
        </div>
      </Section>

      <Section id="results-compare" title="Rules against the trained model" aside={<Legend />}>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <GroupedBars groups={metrics} label="Mean wall IoU, precision, recall and door and window IoU for the rules and the trained model" missingText="does not find them" />
          <div className="flex flex-col gap-3 text-[14px] leading-6">
            <p>
              The model finds more of the walls (recall {pct(rules.recall)} → {pct(model.recall)}), and far less of what it finds is not wall (precision{' '}
              {pct(rules.precision)} → {pct(model.precision)}).
            </p>
            <p>
              Both ran on the same {results.plans} test plans. Neither saw them before: the model was trained on {training.trainPlans.toLocaleString('en')} other
              plans, and the rules’ one tuned setting (“Fill outlined walls”, {rules.settings.fillKernel} px) was chosen on the validation plans.
            </p>
            <p className="text-[13px] text-muted">
              Time per plan: rules {rules.msPerPlan} ms on a laptop CPU (OpenCV.js); model {model.msPerPlan} ms on a Kaggle T4 GPU (PyTorch). The hardware
              differs, so these are not a speed comparison.
            </p>
          </div>
        </div>
      </Section>

      <Section id="results-plans" title="Plan by plan">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <PlanScatter points={points} label={`Wall IoU of the trained model against the rules for each of the ${ROWS.length} test plans`} />
          <div className="flex flex-col gap-3 text-[14px] leading-6">
            <p>
              Each dot is one test plan. Above the line the model scored higher, below it the rules did: the model is better on {better} of {ROWS.length}{' '}
              plans. Point at a dot to see its plan and scores.
            </p>
            <p>
              The rules range from {pct(Math.min(...ROWS.map((r) => r[1])))} to {pct(Math.max(...ROWS.map((r) => r[1])))}: they do well on clean plans, and
              badly where text, hatching and furniture get taken for walls. The model is steadier: only {ROWS.filter((r) => r[2] < rules.meanIoU).length} of its{' '}
              {ROWS.length} plans score below the rules’ average of {pct(rules.meanIoU)}.
            </p>
          </div>
        </div>
      </Section>

      <Section id="results-kinds" title="By kind of drawing" aside={<Legend />}>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <GroupedBars groups={byKind} label="Mean wall IoU by kind of drawing for the rules and the trained model" />
          <div className="flex flex-col gap-3 text-[14px] leading-6">
            <p>
              CubiCasa5k sorts its plans into three kinds. The architectural drawings, most of the test set, are the hardest for both: thin walls drawn as
              outlines, hatching, and dense labels. That is where the model gains most.
            </p>
          </div>
        </div>
      </Section>

      <Section id="results-errors" title="Where the wrong wall pixels are" aside={<Legend />}>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <GroupedBars groups={falseShares} max={0.25} label="Share of found wall pixels that are not wall, by where they are, for the rules and the trained model" />
          <div className="flex flex-col gap-3 text-[14px] leading-6">
            <p>
              Of every pixel marked as wall, the share that is not wall, by where it is. For the rules that is {pct(falseTotal(rules.falseShare))} of what they
              find; for the model {pct(falseTotal(model.falseShare))}.
            </p>
            <p>
              The biggest change is in doors and windows. The rules see the lines drawn across a doorway or a window as wall; the model has learnt that they are
              openings. “Just beside a real wall” means a wall drawn a little too thick or a little off; “away from any wall” is something that is not a wall
              at all.
            </p>
          </div>
        </div>
      </Section>

      <Section id="results-training" title="How the model was trained">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <h3 className="mb-2 text-[13px] text-muted">Wall IoU on the {training.valPlans} validation plans during training</h3>
            <TrainingCurve points={training.curve} kept={model.checkpointStep} label="The model's wall IoU on the validation plans at each check during training" />
          </div>
          <div className="flex flex-col gap-3 text-[14px] leading-6">
            <p>
              A U-Net with {training.parametersMillions} million parameters labels every pixel as background, wall, door or window. It was trained on{' '}
              {training.trainPlans.toLocaleString('en')} plans for {Math.round(training.minutes)} minutes on {training.gpus} GPUs (Kaggle): {training.steps.toLocaleString('en')}{' '}
              steps of {training.cropsPerStep} crops of 512 × 512 px, {training.thousandCrops}k crops in all, each randomly scaled, rotated, flipped and degraded so
              it looks like another scan.
            </p>
            <p>
              The loss adds cross-entropy, which scores each pixel, and soft Dice, which scores the overlap of each class and keeps thin walls and small
              doors from being ignored:
            </p>
            <div className="rounded-lg bg-raised px-4 py-1">
              <Formula tex={RESULTS_TEX.loss} />
            </div>
            <p className="text-[13px] text-muted">
              <MathText>{RESULTS_TEX.lossSymbols}</MathText>
            </p>
            <p>
              The checkpoint kept is the one that scored best on the validation plans, at step {model.checkpointStep.toLocaleString('en')}. The test plans were only
              used once, at the end.
            </p>
          </div>
        </div>
      </Section>

      <Section id="results-care" title="Read with care">
        <ul className="flex max-w-3xl list-disc flex-col gap-2 pl-5 text-[14px] leading-6 marker:text-muted">
          <li>This is one training run of about an hour and a half. A longer run, or a larger model, would likely do better.</li>
          <li>
            Published results on CubiCasa5k use other splits, other ways of drawing the true walls and other scores, so these numbers cannot be put side by side
            with theirs.
          </li>
          <li>
            The trained model is not in the app yet: Image to plan still uses the rules. Running the model in the browser is the next step (see{' '}
            <a href={hrefOf('status')} className="underline underline-offset-2">
              Project status
            </a>
            ).
          </li>
          <li>CubiCasa5k may only be used for non-commercial work, so the same holds for a model trained on it.</li>
        </ul>
      </Section>

      <Section id="results-table" title={`All ${ROWS.length} test plans`}>
        <p className="mb-3 max-w-3xl text-[14px] leading-6">Every plan’s wall IoU for both, and the model’s door and window IoU. Click a column to sort; the plans the model does worst on relative to the rules come first.</p>
        <PlanTable />
        <div className="mt-6 flex flex-wrap gap-2">
          <LinkButton href={hrefOf('pipeline')}>How the rules work</LinkButton>
          <LinkButton href={hrefOf('about')} variant="ghost">
            Sources and limits
          </LinkButton>
        </div>
      </Section>
    </div>
  );
};
