/**
 * Image pipeline tests, running real OpenCV.js in Node on synthetic plans
 * whose walls are known.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_FLOORPLANS } from '../data/sampleFloorplans.ts';
import { loadOpenCv } from './opencv.ts';
import { runPipeline, type RgbaImage } from './pipeline.ts';
import { grayToRgba, renderSyntheticPlan, type SyntheticPlanOptions } from './syntheticPlan.ts';
import { scoreWalls } from './scoreWalls.ts';

const studio = SAMPLE_FLOORPLANS.find((p) => p.id === 'studio-loft')!;

function studioImage(options: Partial<SyntheticPlanOptions> = {}): RgbaImage {
  const img = renderSyntheticPlan(studio, options);
  return { width: img.width, height: img.height, data: grayToRgba(img.gray, img.width, img.height) };
}

test('[Vision] all seven stages run on a clean plan and find mostly axis-aligned wall faces', async () => {
  const { cv } = await loadOpenCv();
  const run = runPipeline(cv, studioImage());

  assert.deepEqual(run.stages.map((s) => s.id), [1, 2, 3, 4, 5, 6, 7]);
  for (const stage of run.stages) {
    assert.equal(stage.image.width, run.workingSize.width, `stage ${stage.id} image width`);
    assert.equal(stage.image.data.length, run.workingSize.width * run.workingSize.height * 4);
    assert.ok(stage.timingMs >= 0);
  }
  assert.ok(run.otsuThreshold > 50 && run.otsuThreshold < 200, `Otsu ${run.otsuThreshold}`);
  assert.ok(run.stats.total > studio.walls.length, 'raw Hough output is fragmented: more segments than walls');
  assert.equal(run.stats.oblique, 0, 'an axis-aligned plan gives no slanted segments');
  assert.ok(run.stats.twoFaceSegments >= run.stats.total * 0.5, 'most segments come in wall-face pairs');
});

test('[Vision] bold room labels are removed by Stage 4 on every sample plan, and no wall is', async () => {
  const { cv } = await loadOpenCv();
  for (const plan of SAMPLE_FLOORPLANS) {
    const keptBlobs = (labels: boolean, textStrokeRatio?: number) => {
      const img = renderSyntheticPlan(plan, { labels, labelScale: 3, dimensions: false });
      const rgba = { width: img.width, height: img.height, data: grayToRgba(img.gray, img.width, img.height) };
      const run = runPipeline(cv, rgba, textStrokeRatio === undefined ? {} : { textStrokeRatio });
      return run.stages[3].counts['Blobs kept'];
    };
    // Baseline: no text at all and the text rule off, so every wall piece is kept.
    assert.equal(keptBlobs(true), keptBlobs(false, 0), plan.id);
  }
});

test('[Vision] large images are resized to 1600 px and blank images give no segments', async () => {
  const { cv } = await loadOpenCv();
  const width = 3200;
  const height = 100;
  const run = runPipeline(cv, { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) });
  assert.deepEqual(run.workingSize, { width: 1600, height: 50 });
  assert.equal(run.stats.total, 0);
});

test('[Vision] step 7 finds every real wall piece on all five test images, rotated scan included', async () => {
  const { cv } = await loadOpenCv();
  const testImages: [string, Partial<SyntheticPlanOptions>][] = [
    ['apt-2bed', {}],
    ['studio-loft', {}],
    ['bungalow-l', {}],
    ['noisy-scan', { scanNoise: true, labelScale: 3, seed: 7 }],
    ['apt-2bed', { scanNoise: true, rotationDeg: 2, seed: 11 }],
  ];
  for (const [planId, options] of testImages) {
    const plan = SAMPLE_FLOORPLANS.find((p) => p.id === planId)!;
    const img = renderSyntheticPlan(plan, options);
    const run = runPipeline(cv, { width: img.width, height: img.height, data: grayToRgba(img.gray, img.width, img.height) });
    const score = scoreWalls(run.walls, img.groundTruthPieces);
    const label = `${planId} ${JSON.stringify(options)}`;
    assert.ok(score.f1 >= 0.95, `${label}: F1 ${score.f1.toFixed(3)}`);
    assert.equal(score.piecesFound, score.truthPieces, `${label}: every real piece found`);
    assert.equal(run.walls.length, score.truthPieces, `${label}: no extra pieces`);
    if (options.rotationDeg) assert.ok(Math.abs(run.vector.skewDeg - options.rotationDeg) < 0.3, `${label}: skew ${run.vector.skewDeg}`);
  }
});

test('[Vision] dark bands along the image edge (scan margins) are removed and the plan is untouched', async () => {
  const { cv } = await loadOpenCv();
  const img = renderSyntheticPlan(studio, {});
  const clean = runPipeline(cv, { width: img.width, height: img.height, data: grayToRgba(img.gray, img.width, img.height) });
  // Grey shadows like a scanned page's border: a band down the left edge, and an L along the
  // bottom and right edges that stays inside the edge strips.
  const gray = img.gray.slice();
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const left = x < 8;
      const bottomRight = x >= 20 && (y >= img.height - 6 || (x >= img.width - 6 && y >= 20));
      if (left || bottomRight) gray[y * img.width + x] = 70;
    }
  }
  const run = runPipeline(cv, { width: img.width, height: img.height, data: grayToRgba(gray, img.width, img.height) });
  assert.equal(run.stages[3].counts['Removed at the image edge'], 2, 'both shadows removed');
  const score = scoreWalls(run.walls, img.groundTruthPieces);
  assert.equal(score.piecesFound, score.truthPieces);
  assert.equal(run.walls.length, clean.walls.length, 'no wall from the shadow');
});
