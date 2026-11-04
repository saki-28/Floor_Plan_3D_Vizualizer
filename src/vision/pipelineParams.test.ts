/**
 * Image pipeline parameter and segment-statistics tests (no OpenCV needed).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { Segment2D } from '../types/floorplan.ts';
import {
  cannyThresholds,
  classifySegment,
  fitWithin,
  resolveOptions,
  summarizeSegments,
} from './pipelineParams.ts';

const seg = (ax: number, ay: number, bx: number, by: number): Segment2D => ({ id: '', ax, ay, bx, by, thickness: 0 });

test('[Params] fitWithin caps the long side at 1600 px and never upscales', () => {
  assert.deepEqual(fitWithin(3200, 2400, 1600), { width: 1600, height: 1200, scale: 0.5 });
  assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600, scale: 1 });
});

test('[Params] resolveOptions matches the plan defaults at 1600 px and keeps kernels odd', () => {
  const o = resolveOptions(1600, 1200);
  assert.equal(o.closeKernel, 5);
  assert.equal(o.minLineLength, 48);
  assert.equal(o.maxLineGap, 10);
  assert.equal(o.minBlobExtent, o.minLineLength);

  const tuned = resolveOptions(1600, 1200, { minLineLength: 60, closeKernel: 4 });
  assert.equal(tuned.minBlobExtent, 60, 'blob extent follows a tuned min line length');
  assert.equal(tuned.closeKernel, 5, 'even kernel sizes are rounded up to odd');
});

test('[Params] Canny thresholds are 0.5·Otsu and Otsu, clamped for degenerate two-tone images', () => {
  assert.deepEqual(cannyThresholds(140), { low: 70, high: 140 });
  assert.deepEqual(cannyThresholds(0), { low: 25, high: 50 });
});

test('[Params] classifySegment snaps within ±5° and flags everything else as slanted', () => {
  assert.equal(classifySegment(seg(0, 0, 100, 0), 5), 'horizontal');
  assert.equal(classifySegment(seg(0, 0, 0, -100), 5), 'vertical');
  assert.equal(classifySegment(seg(0, 0, 100, 5), 5), 'horizontal'); // ~2.9°
  assert.equal(classifySegment(seg(0, 0, 100, 100), 5), 'oblique');
  assert.equal(classifySegment(seg(5, 5, 5, 5), 5), 'oblique'); // degenerate
});

test('[Params] summarizeSegments separates wall-face pairs from same-edge fragments', () => {
  const stats = summarizeSegments(
    [
      seg(0, 100, 200, 100), // top face of a wall…
      seg(10, 112, 190, 112), // …and its bottom face, 12 px away
      seg(400, 50, 400, 250), // a vertical edge…
      seg(401, 60, 401, 240), // …and a 1 px-off fragment of the same edge
      seg(600, 0, 700, 0), // parallel to the first pair but not overlapping
    ],
    5,
    40,
  );
  assert.equal(stats.total, 5);
  assert.equal(stats.horizontal, 3);
  assert.equal(stats.vertical, 2);
  assert.equal(stats.twoFaceSegments, 2);
  assert.equal(stats.sameEdgeDuplicates, 2);
});
