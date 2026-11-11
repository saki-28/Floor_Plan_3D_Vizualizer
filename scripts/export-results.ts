/**
 * Copies the numbers the Results page shows out of the evaluation outputs in data/ (gitignored)
 * into src/data/evaluationResults.json, so the app can show them without the dataset or the model.
 * Only scores are copied: no images, masks or drawings from CubiCasa5k.
 *
 *   npx tsx scripts/export-results.ts [--rules dir] [--model dir] [--log file]
 *
 * Inputs: the results.json that evaluate-cubicasa.ts wrote for the rules and for the model's masks
 * on the same 400 test plans, and the training log of the run the model came from.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const rulesDir = option('rules', 'data/cubicasa-eval/test400-rules');
const modelDir = option('model', 'data/cubicasa-eval/test400-model');
const logFile = option('log', 'data/models/kaggle-run1/log.txt');
const outFile = 'src/data/evaluationResults.json';

interface Row {
  plan: string;
  iou: number;
  precision: number;
  recall: number;
  openingsIoU: number | null;
}
interface Results {
  summary: {
    split: string;
    plans: number;
    overrides: Record<string, number>;
    meanIoU: number;
    medianIoU: number;
    meanPrecision: number;
    meanRecall: number;
    meanOpeningsIoU?: number;
    meanMs: number;
    falseShare: { inOpenings: number; besideWall: number; elsewhere: number };
  };
  rows: Row[];
}

const read = (dir: string) => JSON.parse(readFileSync(`${dir}/results.json`, 'utf8')) as Results;
const rules = read(rulesDir);
const model = read(modelDir);
const round = (value: number, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;

const modelByPlan = new Map(model.rows.map((row) => [row.plan, row]));
if (rules.rows.length !== model.rows.length || rules.rows.some((row) => !modelByPlan.has(row.plan))) {
  throw new Error('The rules and the model were not scored on the same plans.');
}

// The training log: its first line, each validation, the last validation and the test line.
const log = readFileSync(logFile, 'utf8').split('\n');
const header = log.find((line) => / train plans, /.test(line)) ?? '';
const finalLine = log.find((line) => /final val on/.test(line)) ?? '';
const testLine = log.find((line) => /test on \d+ plans/.test(line)) ?? '';
const curve: { step: number; wallIoU: number; openingsIoU: number }[] = [];
const loss: [number, number][] = [];
let step = 0;
for (const line of log) {
  const stepMatch = line.match(/step\s+(\d+)\s+loss ([\d.]+)/);
  if (stepMatch) {
    step = Number(stepMatch[1]);
    loss.push([step, Number(stepMatch[2])]);
  }
  const val = line.match(/^\[[^\]]+\] val on \d+ plans: wall IoU ([\d.]+).*door\+window IoU ([\d.]+)/);
  if (val) curve.push({ step, wallIoU: Number(val[1]), openingsIoU: Number(val[2]) });
}
const finalVal = finalLine.match(/wall IoU ([\d.]+).*door\+window IoU ([\d.]+)\s+after (\d+) steps, (\d+)k crops, ([\d.]+) min/);
if (finalVal) curve.push({ step: Number(finalVal[3]), wallIoU: Number(finalVal[1]), openingsIoU: Number(finalVal[2]) });

// Summary figures keep 5 decimals, so a mean such as 0.751515 still shows as 75.2% after the page rounds it to a tenth.
const summaryOf = (results: Results) => ({
  meanIoU: round(results.summary.meanIoU, 5),
  medianIoU: round(results.summary.medianIoU, 5),
  precision: round(results.summary.meanPrecision, 5),
  recall: round(results.summary.meanRecall, 5),
  openingsIoU: results.summary.meanOpeningsIoU === undefined ? null : round(results.summary.meanOpeningsIoU, 5),
  falseShare: {
    inOpenings: round(results.summary.falseShare.inOpenings),
    besideWall: round(results.summary.falseShare.besideWall),
    elsewhere: round(results.summary.falseShare.elsewhere),
  },
});

const out = {
  dataset: 'CubiCasa5k',
  split: rules.summary.split,
  plans: rules.summary.plans,
  rules: { ...summaryOf(rules), settings: rules.summary.overrides, msPerPlan: Math.round(rules.summary.meanMs) },
  model: {
    ...summaryOf(model),
    checkpointStep: Number(testLine.match(/checkpoint of step (\d+)/)?.[1] ?? 0),
    msPerPlan: Number(testLine.match(/(\d+) ms per plan/)?.[1] ?? 0),
  },
  training: {
    gpus: header.match(/(\d+ × \w+)/)?.[1]?.replace('cuda', 'T4') ?? '',
    trainPlans: Number(header.match(/(\d+) train plans/)?.[1] ?? 0),
    parametersMillions: Number(header.match(/([\d.]+) M params/)?.[1] ?? 0),
    cropsPerStep: Number(header.match(/(\d+) crops per step/)?.[1] ?? 0),
    valPlans: Number(finalLine.match(/val on (\d+) plans/)?.[1] ?? 0),
    steps: finalVal ? Number(finalVal[3]) : 0,
    thousandCrops: finalVal ? Number(finalVal[4]) : 0,
    minutes: finalVal ? Number(finalVal[5]) : 0,
    curve,
    loss,
  },
  /** One row per test plan: name, the rules' wall IoU, the model's wall IoU, the model's door and window IoU. */
  rows: rules.rows.map((row) => {
    const learned = modelByPlan.get(row.plan)!;
    return [row.plan, round(row.iou), round(learned.iou), learned.openingsIoU === null ? null : round(learned.openingsIoU)];
  }),
};

writeFileSync(outFile, `${JSON.stringify(out, null, 1)}\n`);
console.log(`Wrote ${outFile}: ${out.rows.length} plans, ${curve.length} validation points, ${loss.length} loss points.`);
