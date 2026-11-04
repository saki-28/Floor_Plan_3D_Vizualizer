/**
 * Wall-mask scoring and the CubiCasa5k annotation reader.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { fillPolygon, polygonsMask, scoreMasks, wallsMask } from './maskScore.ts';
import { parseCubiCasaSvg } from './cubicasaSvg.ts';

test('[Mask] a filled square covers exactly its pixels', () => {
  const mask = new Uint8Array(10 * 10);
  fillPolygon(mask, 10, 10, [[2, 2], [6, 2], [6, 5], [2, 5]]);
  assert.equal(mask.reduce((sum, v) => sum + v, 0), 4 * 3);
  assert.equal(mask[2 * 10 + 2], 1);
  assert.equal(mask[5 * 10 + 6], 0, 'the far edge is exclusive');
});

test('[Mask] IoU, precision and recall of overlapping walls', () => {
  const W = 100;
  const H = 40;
  const truth = wallsMask([{ id: 't', ax: 10, ay: 20, bx: 90, by: 20, thickness: 10 }], W, H);
  assert.equal(scoreMasks(truth, truth).iou, 1);

  const half = wallsMask([{ id: 'f', ax: 10, ay: 20, bx: 50, by: 20, thickness: 10 }], W, H);
  const s = scoreMasks(truth, half);
  assert.equal(s.precision, 1, 'all of the half wall is real wall');
  assert.ok(Math.abs(s.recall - 0.5) < 0.08, `recall ${s.recall}`);

  const elsewhere = polygonsMask([[[0, 0], [10, 0], [10, 5], [0, 5]]], W, H);
  assert.equal(scoreMasks(truth, elsewhere).iou, 0);
});

test('[CubiCasa] reads walls, doors and windows from model.svg, including nested groups', () => {
  const svg = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
  <g id="Model">
    <g id="Wall" class="Wall External">
      <polygon points="10,10 200,10 200,20 10,20 "/>
      <g id="Window" class="Window Regular"><polygon points="50,10 90,10 90,20 50,20"/></g>
      <polygon points="0,0 1,1 2,2"/>
    </g>
    <g id="Wall" class="Wall"><polygon points="10,10 20,10 20,300 10,300"/></g>
    <g id="Door" class="Door Swing"><polygon points="10,100 20,100 20,150 10,150"/><path d="M0 0"/></g>
    <g class="Space Kitchen"><polygon points="1,1 5,1 5,5"/></g>
  </g>
</svg>`;
  const a = parseCubiCasaSvg(svg);
  assert.equal(a.width, 800);
  assert.equal(a.height, 600);
  assert.equal(a.walls.length, 2, 'one polygon per wall group, the first one');
  assert.deepEqual(a.walls[0][1], [200, 10]);
  assert.equal(a.windows.length, 1, 'a window nested inside its wall');
  assert.equal(a.doors.length, 1);
});
