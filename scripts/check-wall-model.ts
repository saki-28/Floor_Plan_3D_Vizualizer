/**
 * Checks the browser's way of running the wall model against the PyTorch predictions of a run:
 * predicts test plans with onnxruntime-web (the same runtime and the same tiling code the app
 * uses) and compares the class of every pixel with the run's pred_test images.
 *
 *   npm run check:model -- --run data/models/<run> [--data data/cubicasa5k/cubicasa5k] [--labels data/cubicasa5k-labels] [--plans 6] [--tile 512]
 */

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import * as ort from 'onnxruntime-web';
import { BROWSER_TILE, CLASS_WALL, TILE_MARGIN, inkFromRgba, predictClasses } from '../src/vision/wallModel';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const run = arg('run', '');
if (!run) throw new Error('Pass --run data/models/<run> (a folder with floorplan3d_walls.onnx and pred_test/).');
const data = arg('data', 'data/cubicasa5k/cubicasa5k');
const labelsDir = arg('labels', 'data/cubicasa5k-labels');
const count = Number(arg('plans', '6'));
const tile = Number(arg('tile', String(BROWSER_TILE)));

const readPng = (file: string) => PNG.sync.read(fs.readFileSync(file));
const iou = (found: Uint8Array, truth: Uint8Array) => {
  let both = 0;
  let either = 0;
  for (let p = 0; p < found.length; p++) {
    const f = found[p] === CLASS_WALL;
    const t = truth[p] === CLASS_WALL;
    if (f && t) both++;
    if (f || t) either++;
  }
  return either ? both / either : 1;
};
/** The first channel of a class-map PNG (labels and predictions are single-channel images). */
const classesOf = (png: PNG) => {
  const out = new Uint8Array(png.width * png.height);
  for (let p = 0; p < out.length; p++) out[p] = png.data[p * 4];
  return out;
};

const session = await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(path.join(run, 'floorplan3d_walls.onnx'))));
const plans = fs
  .readFileSync(path.join(data, 'test.txt'), 'utf8')
  .split('\n')
  .map((line) => line.trim().replace(/^\/|\/$/g, ''))
  .filter(Boolean);
// Spread over the list, so every kind of drawing is tried.
const picked = Array.from({ length: Math.min(count, plans.length) }, (_, i) => plans[Math.floor((i * plans.length) / count)]);

let agreeSum = 0;
let gapSum = 0;
for (const plan of picked) {
  const name = plan.replace(/\//g, '_');
  const image = readPng(path.join(data, plan, 'F1_scaled.png'));
  const ink = inkFromRgba(image.data, image.width, image.height);
  const started = performance.now();
  const map = await predictClasses(
    ink,
    image.width,
    image.height,
    async (input, size) => {
      const output = await session.run({ ink: new ort.Tensor('float32', input, [1, 1, size, size]) });
      return output[session.outputNames[0]].data as Float32Array;
    },
    { tile, margin: TILE_MARGIN },
  );
  const seconds = (performance.now() - started) / 1000;
  const torch = classesOf(readPng(path.join(run, 'pred_test', `${name}.png`)));
  const truth = classesOf(readPng(path.join(labelsDir, `${name}.png`)));
  let same = 0;
  for (let p = 0; p < torch.length; p++) if (torch[p] === map.classes[p]) same++;
  const agree = same / torch.length;
  const [here, there] = [iou(map.classes, truth), iou(torch, truth)];
  agreeSum += agree;
  gapSum += here - there;
  console.log(
    `${name.padEnd(40)} ${String(image.width).padStart(5)}×${String(image.height).padEnd(5)} pixels agree ${(agree * 100).toFixed(3)}%  ` +
      `wall IoU ${here.toFixed(4)} here, ${there.toFixed(4)} PyTorch  ${seconds.toFixed(1)} s`,
  );
}
console.log(
  `${picked.length} plans, ${tile}-pixel tiles: pixels agree ${((agreeSum / picked.length) * 100).toFixed(3)}% on average; ` +
    `wall IoU differs by ${(gapSum / picked.length >= 0 ? '+' : '') + (gapSum / picked.length).toFixed(4)} on average.`,
);
