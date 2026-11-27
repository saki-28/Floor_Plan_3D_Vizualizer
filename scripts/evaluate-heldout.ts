/**
 * Scores the rules and the trained model on plans the model never saw in training, to measure how
 * well each copes with other drawing styles:
 *
 *   npm run eval:heldout -- --model data/models/<run>/floorplan3d_walls.onnx [--cvc data/cvc-fp] [--limit N] [--tag name]
 *   npm run eval:heldout -- --model-scores heldout_cvcfp.json [--tag name]
 *
 * The model is heavy on a laptop (four cores flat out for about 20 minutes). The second form runs
 * only the rules here and takes the model's CVC-FP scores from the file that
 * training/kaggle/heldout_cvcfp.py writes on Kaggle; the generated plans are then left out.
 *
 * 1. CVC-FP (de las Heras et al. 2015; CC BY-NC 4.0): 121 scanned plans in four styles, as the
 *    Kaggle copy asutoshprad/floor-plan-dataset stores them (X/<n>.png the scan), with the labels
 *    lined up to the scans by scripts/align-cvcfp.py (labels/<n>.png, run that first). Walls are
 *    scored by pixel IoU, as on CubiCasa5k, on the image at the size the pipeline works at; doors
 *    and windows together likewise (model only).
 * 2. Our own generated test plans (public/test-plans), by wall length found, as Image to plan does.
 *
 * Results go to data/heldout-eval/<tag>.json. Nothing here is used for training.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import * as ort from 'onnxruntime-web';
import type { Segment2D } from '../src/types/floorplan';
import { loadOpenCv } from '../src/vision/opencv';
import { runPipeline, workingImage, type ModelInput, type RgbaImage } from '../src/vision/pipeline';
import { scoreMasks, wallsMask } from '../src/vision/maskScore';
import { scoreWalls } from '../src/vision/scoreWalls';
import { CLASS_DOOR, CLASS_WALL, CLASS_WINDOW, inkFromRgba, predictClasses, solidWallPieces } from '../src/vision/wallModel';

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const modelPath = option('model', '');
const modelScoresPath = option('model-scores', '');
if (!modelPath && !modelScoresPath) throw new Error('Pass --model <the .onnx file of a training run>, or --model-scores <heldout_cvcfp.json from Kaggle>.');
type ModelRow = { plan: string; model: number; modelPrecision: number; modelRecall: number; openings: number };
const modelScores = modelScoresPath ? new Map((JSON.parse(readFileSync(modelScoresPath, 'utf8')).rows as ModelRow[]).map((r) => [r.plan, r])) : null;
const cvcDir = option('cvc', 'data/cvc-fp');
const limit = Number(option('limit', '1000'));
const tag = option('tag', 'baseline');

const { cv } = await loadOpenCv();
const session = modelPath ? await ort.InferenceSession.create(new Uint8Array(readFileSync(modelPath))) : null;

/** A PNG as RGBA on white paper (transparent scans would otherwise read as black ink). */
function readImage(file: string): RgbaImage {
  const png = PNG.sync.read(readFileSync(file));
  const data = new Uint8ClampedArray(png.data);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    if (a < 1) for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * a + 255 * (1 - a));
    data[i + 3] = 255;
  }
  return { width: png.width, height: png.height, data };
}

async function runModel(image: RgbaImage): Promise<ModelInput> {
  if (!session) throw new Error('No model was given.');
  const started = performance.now();
  let tiles = 0;
  const map = await predictClasses(
    inkFromRgba(image.data, image.width, image.height),
    image.width,
    image.height,
    async (input, size) => {
      const output = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 1, size, size]) });
      return output[session.outputNames[0]].data as Float32Array;
    },
    { onProgress: (_, total) => (tiles = total) },
  );
  return { map, ms: performance.now() - started, tiles, ranOn: 'on the processor' };
}

/** A plan's labels (labels/<n>.png: 0 background, 1 wall, 2 door, 3 window) as wall and opening masks on a grid of another size (nearest pixel). */
function truthMasks(file: string, width: number, height: number) {
  const png = PNG.sync.read(readFileSync(file));
  const walls = new Uint8Array(width * height);
  const openings = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(png.height - 1, Math.floor(((y + 0.5) * png.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(png.width - 1, Math.floor(((x + 0.5) * png.width) / width));
      const c = png.data[(sy * png.width + sx) * 4];
      if (c === CLASS_WALL) walls[y * width + x] = 1;
      else if (c === CLASS_DOOR || c === CLASS_WINDOW) openings[y * width + x] = 1;
    }
  }
  return { walls, openings };
}

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length);
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

// ---- 1. CVC-FP -------------------------------------------------------------------------------
const cvcRows: { plan: string; width: number; height: number; rules: number; model: number; modelPrecision: number; modelRecall: number; openings: number }[] = [];
if (existsSync(join(cvcDir, 'X'))) {
  // Plans whose labels are unusable in this copy (excluded.json: plan → why), left out for rules and model alike.
  const excluded: Record<string, string> = existsSync(join(cvcDir, 'excluded.json')) ? JSON.parse(readFileSync(join(cvcDir, 'excluded.json'), 'utf8')) : {};
  const plans = readdirSync(join(cvcDir, 'X'))
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.replace('.png', ''))
    .sort((a, b) => Number(a) - Number(b))
    .filter((plan) => !(plan in excluded))
    .slice(0, limit);
  for (const plan of plans) {
    const labelFile = join(cvcDir, 'labels', `${plan}.png`);
    if (!existsSync(labelFile)) continue;
    let scan: RgbaImage;
    try {
      scan = readImage(join(cvcDir, 'X', `${plan}.png`));
    } catch (err) {
      console.log(`cvc-fp ${plan.padStart(3)}  left out: the scan could not be read (${err instanceof Error ? err.message : err})`);
      continue;
    }
    const working = workingImage(cv, scan);
    const { width, height } = working;
    const truth = truthMasks(labelFile, width, height);
    const rules = scoreMasks(truth.walls, wallsMask(runPipeline(cv, working).walls, width, height));
    let model: { iou: number; precision: number; recall: number };
    let openings: { iou: number };
    const scored = modelScores?.get(plan);
    if (modelScores) {
      if (!scored) continue;
      model = { iou: scored.model, precision: scored.modelPrecision, recall: scored.modelRecall };
      openings = { iou: scored.openings };
    } else {
      const answer = await runModel(working);
      const foundWalls = new Uint8Array(width * height);
      const foundOpenings = new Uint8Array(width * height);
      for (let p = 0; p < foundWalls.length; p++) {
        const c = answer.map.classes[p];
        if (c === CLASS_WALL) foundWalls[p] = 1;
        else if (c === CLASS_DOOR || c === CLASS_WINDOW) foundOpenings[p] = 1;
      }
      model = scoreMasks(truth.walls, foundWalls);
      openings = scoreMasks(truth.openings, foundOpenings);
    }
    cvcRows.push({ plan, width, height, rules: rules.iou, model: model.iou, modelPrecision: model.precision, modelRecall: model.recall, openings: openings.iou });
    console.log(`cvc-fp ${plan.padStart(3)}  ${width}×${height}  rules ${pct(rules.iou)}  model ${pct(model.iou)} (p ${pct(model.precision)}, r ${pct(model.recall)})  openings ${pct(openings.iou)}`);
  }
}

// ---- 2. Our generated test plans --------------------------------------------------------------
const testDir = 'public/test-plans';
const manifest = JSON.parse(readFileSync(join(testDir, 'manifest.json'), 'utf8')) as { plans: { id: string; file: string; name: string; groundTruthPieces: Segment2D[] }[] };
const generated: { plan: string; rules: { recall: number; precision: number }; model: { recall: number; precision: number; doors: number; windows: number } }[] = [];
for (const plan of session ? manifest.plans : []) {
  const image = readImage(join(testDir, plan.file));
  const rules = runPipeline(cv, image);
  const resize = rules.workingSize.width / rules.inputSize.width;
  const truth = plan.groundTruthPieces.map((t) => ({ ...t, ax: t.ax * resize, ay: t.ay * resize, bx: t.bx * resize, by: t.by * resize, thickness: t.thickness * resize }));
  const withModel = runPipeline(cv, image, {}, await runModel(workingImage(cv, image)));
  const a = scoreWalls(rules.walls, truth);
  const b = scoreWalls(solidWallPieces(withModel.walls, withModel.openings), truth);
  const doors = withModel.openings.filter((o) => o.kind === 'door').length;
  generated.push({ plan: plan.name, rules: { recall: a.recall, precision: a.precision }, model: { recall: b.recall, precision: b.precision, doors, windows: withModel.openings.length - doors } });
  console.log(`generated ${plan.name.padEnd(34)} rules: found ${pct(a.recall)}, real ${pct(a.precision)}   model: found ${pct(b.recall)}, real ${pct(b.precision)}, ${doors} doors, ${withModel.openings.length - doors} windows`);
}

const summary = {
  model: modelPath || modelScoresPath,
  cvcFp: {
    plans: cvcRows.length,
    rules: { meanIoU: mean(cvcRows.map((r) => r.rules)), medianIoU: median(cvcRows.map((r) => r.rules)) },
    model: {
      meanIoU: mean(cvcRows.map((r) => r.model)),
      medianIoU: median(cvcRows.map((r) => r.model)),
      precision: mean(cvcRows.map((r) => r.modelPrecision)),
      recall: mean(cvcRows.map((r) => r.modelRecall)),
      openingsIoU: mean(cvcRows.map((r) => r.openings)),
      betterThanRules: cvcRows.filter((r) => r.model > r.rules).length,
    },
  },
  generated: {
    plans: generated.length,
    rules: { found: mean(generated.map((g) => g.rules.recall)), real: mean(generated.map((g) => g.rules.precision)) },
    model: { found: mean(generated.map((g) => g.model.recall)), real: mean(generated.map((g) => g.model.precision)) },
  },
};
mkdirSync('data/heldout-eval', { recursive: true });
writeFileSync(join('data/heldout-eval', `${tag}.json`), JSON.stringify({ summary, cvcFp: cvcRows, generated }, null, 1));
console.log(JSON.stringify(summary, null, 1));
