/**
 * Scores the image pipeline's walls (stages 1–7) against CubiCasa5k ground truth.
 *
 *   npx tsx scripts/evaluate-cubicasa.ts [--split val|test] [--dir data/cubicasa5k-sample] [--limit N] [--overlays] [--fill K]
 *                                        [--set option=value,...] [--masks dir] [--tag name]
 *
 * --set overrides any pipeline option (for example --set blockRatio=0,networkShare=0.15) for
 * tuning; results go to a folder named after the split and the settings, or after --tag.
 *
 * --dir may be the full dataset (data/cubicasa5k/cubicasa5k): when it holds <split>.txt, the plans
 * are the ones that list names (400 each for val and test); otherwise every plan under <dir>/<split>.
 *
 * --masks scores a trained model instead of the pipeline: <dir>/<plan with / as _>.png is its class
 * map of the plan (0 background, 1 wall, 2 door, 3 window, as written by training/train.py). Wall
 * pixels (1) are scored exactly like the pipeline's walls, and doors plus windows (2, 3) against
 * the true openings.
 *
 * For each plan, the pipeline runs on F1_scaled.png. model.svg's polygon points are pixels of that
 * image as they stand (CubiCasa's loader applies no scaling: the SVG's declared size is not the
 * image size, and scaling by it misplaces the walls). The true
 * walls are CubiCasa's wall polygons minus its door and window polygons, since our walls stop at
 * openings; the found walls are each centerline drawn at its thickness. Both become masks on the
 * image's own pixel grid and are compared by IoU, precision and recall (Cambeiro Barreiro et al.
 * 2023 report wall IoU this way). Results go to data/cubicasa-eval/<split>/results.json; with
 * --overlays, one comparison PNG per plan: teal = wall found, red = found but not wall,
 * amber = wall missed.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PNG } from 'pngjs';
import { loadOpenCv } from '../src/vision/opencv';
import { runPipeline } from '../src/vision/pipeline';
import { resolveOptions, type PipelineOptions } from '../src/vision/pipelineParams';
import { parseCubiCasaSvg } from '../src/vision/cubicasaSvg';
import { polygonsMask, scoreMasks, wallsMask } from '../src/vision/maskScore';

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const split = option('split', 'val');
const dataDir = option('dir', 'data/cubicasa5k-sample');
const limit = Number(option('limit', '1000'));
const writeOverlays = args.includes('--overlays');
const fillKernel = Number(option('fill', '0'));
const settings = option('set', '')
  .split(',')
  .filter(Boolean)
  .map((pair) => pair.split('='));
const overrides: Partial<PipelineOptions> = { ...(fillKernel ? { fillKernel } : {}) };
for (const [key, value] of settings) {
  if (!(key in resolveOptions(100, 100)) || Number.isNaN(Number(value))) {
    console.error(`Unknown option or value: ${key}=${value}`);
    process.exit(1);
  }
  (overrides as Record<string, number>)[key] = Number(value);
}
const masksDir = option('masks', '');
const runName = option(
  'tag',
  masksDir ? `${split}-model` : [split, ...(fillKernel ? [`fill${fillKernel}`] : []), ...settings.map(([k, v]) => `${k}${v}`)].join('-'),
);
const outDir = join('data', 'cubicasa-eval', runName);

/** Every folder under `dir` that holds a model.svg, in a stable order. */
function planFolders(dir: string): string[] {
  const found: string[] = [];
  const walk = (d: string) => {
    const entries = readdirSync(d).sort();
    if (entries.includes('model.svg') && entries.includes('F1_scaled.png')) found.push(d);
    for (const e of entries) if (statSync(join(d, e)).isDirectory()) walk(join(d, e));
  };
  walk(dir);
  return found;
}

/** The plan folders a split list names (the full dataset's train.txt, val.txt, test.txt), or null without one. */
function listedPlans(dir: string, name: string): string[] | null {
  const list = join(dir, `${name}.txt`);
  if (!existsSync(list)) return null;
  return readFileSync(list, 'utf8')
    .split('\n')
    .map((line) => line.trim().replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .map((plan) => join(dir, plan));
}

const TEAL: [number, number, number] = [27, 108, 128];
const RED: [number, number, number] = [196, 36, 42];
const AMBER: [number, number, number] = [214, 163, 71];

function overlay(png: PNG, truth: Uint8Array, found: Uint8Array): Buffer {
  const out = new PNG({ width: png.width, height: png.height });
  for (let p = 0; p < truth.length; p++) {
    const o = p * 4;
    const t = truth[p] > 0;
    const f = found[p] > 0;
    const colour = t && f ? TEAL : f ? RED : t ? AMBER : null;
    if (colour) {
      [out.data[o], out.data[o + 1], out.data[o + 2]] = colour;
    } else {
      // The plan itself, faded, so the colours stand out.
      const g = (png.data[o] * 0.3 + png.data[o + 1] * 0.59 + png.data[o + 2] * 0.11) * 0.35 + 255 * 0.65;
      out.data[o] = out.data[o + 1] = out.data[o + 2] = g;
    }
    out.data[o + 3] = 255;
  }
  return PNG.sync.write(out);
}

/** Square dilation by `r` pixels, separably with running sums. */
function dilate(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const rows = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = -r; x < width; x++) {
      if (x + r < width && mask[y * width + x + r]) count++;
      if (x - r - 1 >= 0 && mask[y * width + x - r - 1]) count--;
      if (x >= 0 && count > 0) rows[y * width + x] = 1;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = -r; y < height; y++) {
      if (y + r < height && rows[(y + r) * width + x]) count++;
      if (y - r - 1 >= 0 && rows[(y - r - 1) * width + x]) count--;
      if (y >= 0 && count > 0) out[y * width + x] = 1;
    }
  }
  return out;
}

/**
 * Where the found-but-not-wall pixels are, as shares of all found pixels: inside a door or window
 * (the wall is right, the opening was not recognised), just beside a true wall (thickness or
 * position off), or away from any wall (a false wall).
 */
function falseBreakdown(solid: Uint8Array, openings: Uint8Array, found: Uint8Array, width: number, height: number) {
  const near = dilate(solid, width, height, Math.max(3, Math.round(Math.max(width, height) * 0.006)));
  let total = 0;
  let inOpenings = 0;
  let besideWall = 0;
  let elsewhere = 0;
  for (let p = 0; p < found.length; p++) {
    if (!found[p]) continue;
    total++;
    if (solid[p]) continue;
    if (openings[p]) inOpenings++;
    else if (near[p]) besideWall++;
    else elsewhere++;
  }
  return total
    ? { inOpenings: inOpenings / total, besideWall: besideWall / total, elsewhere: elsewhere / total }
    : { inOpenings: 0, besideWall: 0, elsewhere: 0 };
}

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`.padStart(6);

const cv = masksDir ? null : (await loadOpenCv()).cv;
const listed = listedPlans(dataDir, split);
const planRoot = listed ? dataDir : join(dataDir, split);
const folders = (listed ?? planFolders(planRoot)).slice(0, limit);
if (folders.length === 0) {
  console.error(`No plans under ${planRoot}`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const rows = [];
console.log(`CubiCasa5k ${split}: ${folders.length} plans${Object.keys(overrides).length ? `, ${JSON.stringify(overrides)}` : ''}\n`);
console.log('plan                                   size        walls  IoU    prec   recall  time');
for (const folder of folders) {
  const plan = relative(planRoot, folder);
  const name = plan.replace(/[\\/]/g, '_');
  const png = PNG.sync.read(readFileSync(join(folder, 'F1_scaled.png')));
  const annotation = parseCubiCasaSvg(readFileSync(join(folder, 'model.svg'), 'utf8'));
  const { width, height } = png;
  const wallArea = polygonsMask(annotation.walls, width, height);
  const openings = polygonsMask([...annotation.doors, ...annotation.windows], width, height);
  const solid = wallArea.map((v, i) => (v && !openings[i] ? 1 : 0));

  let found: Uint8Array;
  let ms = 0;
  let foundWalls: number | null = null;
  let vector: { droppedThin: number; droppedStray: number; skewDeg: number } | null = null;
  let openingsIoU: number | null = null;
  if (masksDir) {
    const mask = PNG.sync.read(readFileSync(join(masksDir, `${name}.png`)));
    if (mask.width !== width || mask.height !== height) {
      console.error(`${plan}: mask is ${mask.width}×${mask.height}, plan is ${width}×${height}`);
      process.exit(1);
    }
    found = new Uint8Array(width * height);
    const foundOpenings = new Uint8Array(width * height);
    for (let p = 0; p < found.length; p++) {
      const v = mask.data[p * 4];
      found[p] = v === 1 ? 1 : 0;
      foundOpenings[p] = v === 2 || v === 3 ? 1 : 0;
    }
    const o = scoreMasks(openings, foundOpenings);
    openingsIoU = o.truthPixels + o.foundPixels > 0 ? o.iou : null;
  } else {
    const t0 = performance.now();
    const run = runPipeline(cv!, { width, height, data: new Uint8ClampedArray(png.data) }, overrides);
    ms = performance.now() - t0;
    const back = width / run.workingSize.width; // undo stage 1's resize
    const walls = run.walls.map((w) => ({ ...w, ax: w.ax * back, ay: w.ay * back, bx: w.bx * back, by: w.by * back, thickness: w.thickness * back }));
    found = wallsMask(walls, width, height);
    foundWalls = walls.length;
    vector = { droppedThin: run.vector.counts.droppedThin, droppedStray: run.vector.counts.droppedStray, skewDeg: run.vector.skewDeg };
  }

  const score = scoreMasks(solid, found);
  const withOpenings = scoreMasks(wallArea, found);
  const falseShare = falseBreakdown(solid, openings, found, width, height);

  if (writeOverlays) writeFileSync(join(outDir, `${name}.png`), overlay(png, solid, found));
  rows.push({
    plan,
    width,
    height,
    svgSize: annotation.width ? `${annotation.width}×${annotation.height}` : null,
    truthWalls: annotation.walls.length,
    foundWalls,
    foundPixels: score.foundPixels,
    ...(vector ?? {}),
    iou: score.iou,
    precision: score.precision,
    recall: score.recall,
    iouIncludingOpenings: withOpenings.iou,
    openingsIoU,
    falseShare,
    ms,
  });
  const walls = foundWalls === null ? '  -' : String(foundWalls).padStart(3);
  console.log(
    `${plan.padEnd(38)} ${`${width}×${height}`.padEnd(11)} ${walls}/${String(annotation.walls.length).padEnd(3)} ${pct(score.iou)} ${pct(score.precision)} ${pct(score.recall)} ${ms.toFixed(0).padStart(5)} ms`,
  );
}

const summary = {
  split,
  overrides,
  plans: rows.length,
  meanIoU: mean(rows.map((r) => r.iou)),
  medianIoU: median(rows.map((r) => r.iou)),
  meanPrecision: mean(rows.map((r) => r.precision)),
  meanRecall: mean(rows.map((r) => r.recall)),
  meanIoUIncludingOpenings: mean(rows.map((r) => r.iouIncludingOpenings)),
  plansWithNoWalls: rows.filter((r) => r.foundPixels === 0).length,
  ...(masksDir ? { masks: masksDir, meanOpeningsIoU: mean(rows.flatMap((r) => (r.openingsIoU === null ? [] : [r.openingsIoU]))) } : {}),
  falseShare: {
    inOpenings: mean(rows.map((r) => r.falseShare.inOpenings)),
    besideWall: mean(rows.map((r) => r.falseShare.besideWall)),
    elsewhere: mean(rows.map((r) => r.falseShare.elsewhere)),
  },
  meanMs: mean(rows.map((r) => r.ms)),
};
writeFileSync(join(outDir, 'results.json'), `${JSON.stringify({ summary, rows }, null, 2)}\n`);
console.log(
  `\nmean IoU ${pct(summary.meanIoU)} · median IoU ${pct(summary.medianIoU)} · precision ${pct(summary.meanPrecision)} · recall ${pct(summary.meanRecall)}` +
    ` · IoU counting openings as wall ${pct(summary.meanIoUIncludingOpenings)} · no walls found on ${summary.plansWithNoWalls} · ${summary.meanMs.toFixed(0)} ms per plan`,
);
console.log(
  `of the found pixels, not wall: ${pct(summary.falseShare.inOpenings)} in doors and windows · ${pct(summary.falseShare.besideWall)} just beside a wall · ${pct(summary.falseShare.elsewhere)} away from any wall`,
);
if (masksDir) console.log(`doors and windows: mean IoU ${pct(summary.meanOpeningsIoU ?? 0)}`);
console.log(`Results: ${join(outDir, 'results.json')}${writeOverlays ? ` · overlays in ${outDir}/` : ''}`);
