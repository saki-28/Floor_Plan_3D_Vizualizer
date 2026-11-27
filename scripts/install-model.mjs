/**
 * Puts a trained wall model where the app looks for it: public/models/floorplan3d_walls.onnx.
 * The weights are not in the repository (CubiCasa5k, and so a model trained on it, is for
 * non-commercial use only), so this copies them from a training run:
 *
 *   npm run model:install -- data/models/<run>            (a run folder, or the .onnx file itself)
 */

import fs from 'node:fs';
import path from 'node:path';

const given = process.argv[2];
if (!given) {
  console.error('Usage: npm run model:install -- data/models/<run>   (the folder of a training run, or its .onnx file)');
  process.exit(1);
}
const source = fs.statSync(given).isDirectory() ? path.join(given, 'floorplan3d_walls.onnx') : given;
if (!fs.existsSync(source)) {
  console.error(`No model at ${source}. Train one with training/floorplan3d_walls.ipynb, or pass the .onnx file.`);
  process.exit(1);
}
const target = path.join('public', 'models', 'floorplan3d_walls.onnx');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);
console.log(`Copied ${source} (${(fs.statSync(target).size / 1e6).toFixed(1)} MB) to ${target}. Image to plan can now use the trained model.`);
