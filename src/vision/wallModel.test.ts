import test from 'node:test';
import assert from 'node:assert/strict';
import type { Segment2D } from '../types/floorplan';
import { CLASS_DOOR, CLASS_WALL, CLASS_WINDOW, countClasses, inkFromRgba, openingsFromClasses, planTiles, predictClasses, solidWallPieces, wallBandMask, type ClassMap } from './wallModel';

test('[Model] the input is ink: 0 for white paper, 1 for black, from OpenCV’s grayscale', () => {
  const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
  const ink = inkFromRgba(rgba, 3, 1);
  assert.equal(ink[0], 0);
  assert.equal(ink[1], 1);
  assert.ok(Math.abs(ink[2] - (1 - 76 / 255)) < 1e-6, 'red is gray 76');
});

test('[Model] tiles cover the whole padded canvas once, as training/model.py predict_plan does', () => {
  for (const [w, h, tile] of [[300, 200, 512], [1600, 1120, 512], [1000, 1700, 1024], [513, 512, 512]]) {
    const plan = planTiles(w, h, tile, 96);
    assert.ok(plan.width % 32 === 0 && plan.height % 32 === 0 && plan.width >= Math.max(w, tile) && plan.height >= Math.max(h, tile));
    const covered = new Uint8Array(plan.width * plan.height);
    for (const t of plan.tiles) {
      assert.ok(t.x >= 0 && t.y >= 0 && t.x + tile <= plan.width && t.y + tile <= plan.height, 'every tile is inside the canvas');
      for (let y = t.y + t.keep.top; y < t.y + t.keep.bottom; y++) for (let x = t.x + t.keep.left; x < t.x + t.keep.right; x++) covered[y * plan.width + x] = 1;
    }
    assert.ok(covered.every((v) => v === 1), `${w}×${h}: no pixel is left out`);
  }
  assert.equal(planTiles(300, 200).tiles.length, 1, 'a small plan is one tile');
});

test('[Model] a plan is predicted tile by tile and every pixel takes its highest-scoring class', async () => {
  // A stand-in network: wall where the ink is dark, door where it is mid-gray, else background.
  const runTile = async (ink: Float32Array, tile: number) => {
    const scores = new Float32Array(4 * tile * tile);
    for (let p = 0; p < tile * tile; p++) {
      scores[p] = 0.5;
      scores[tile * tile + p] = ink[p] > 0.8 ? 1 : 0;
      scores[2 * tile * tile + p] = ink[p] > 0.3 && ink[p] <= 0.8 ? 1 : 0;
    }
    return scores;
  };
  const [w, h] = [700, 90];
  const ink = new Float32Array(w * h);
  for (let x = 0; x < w; x++) ink[40 * w + x] = x < 600 ? 1 : 0.5;
  const steps: number[] = [];
  const map = await predictClasses(ink, w, h, runTile, { tile: 512, margin: 96, onProgress: (done) => steps.push(done) });
  assert.equal(map.classes[40 * w + 10], CLASS_WALL);
  assert.equal(map.classes[40 * w + 599], CLASS_WALL, 'across the seam between two tiles');
  assert.equal(map.classes[40 * w + 650], CLASS_DOOR);
  assert.equal(map.classes[10 * w + 10], 0);
  assert.deepEqual(steps, [0, 1, 2], 'progress after every tile');
  assert.deepEqual(countClasses(map), { wall: 600, door: 100, window: 0 });
});

/** A class map with one horizontal wall band (rows 46–53) with a door and a window in it, and a stray door patch off any wall. */
function sample(): { map: ClassMap; walls: Segment2D[] } {
  const [width, height] = [400, 100];
  const classes = new Uint8Array(width * height);
  for (let y = 46; y < 54; y++) {
    for (let x = 20; x < 380; x++) classes[y * width + x] = x >= 100 && x < 140 ? CLASS_DOOR : x >= 250 && x < 310 ? CLASS_WINDOW : CLASS_WALL;
  }
  for (let y = 10; y < 18; y++) for (let x = 30; x < 70; x++) classes[y * width + x] = CLASS_DOOR;
  for (let y = 46; y < 54; y++) for (let x = 200; x < 203; x++) classes[y * width + x] = CLASS_DOOR; // a sliver, too small
  return { map: { width, height, classes }, walls: [{ id: 'w', ax: 20, ay: 50, bx: 380, by: 50, thickness: 8 }] };
}

test('[Model] walls run on through their doors and windows in the mask the wall steps use', () => {
  const { map } = sample();
  const mask = wallBandMask(map);
  assert.equal(mask[50 * 400 + 120], 255, 'a door pixel is part of the wall band');
  assert.equal(mask[50 * 400 + 280], 255, 'so is a window pixel');
  assert.equal(mask[30 * 400 + 120], 0);
});

test('[Model] door and window pixels become openings on the wall they lie along', () => {
  const { map, walls } = sample();
  const openings = openingsFromClasses(map, walls);
  assert.deepEqual(openings.map((o) => o.kind), ['door', 'window'], 'the stray patch and the sliver are left out');
  const [door, window] = openings;
  assert.ok(Math.abs(door.position - (120 - 20) / 360) < 0.01 && Math.abs(door.widthPx - 40) <= 2, JSON.stringify(door));
  assert.ok(Math.abs(window.position - (280 - 20) / 360) < 0.01 && Math.abs(window.widthPx - 60) <= 2, JSON.stringify(window));
});

test('[Model] an opening goes on the wall it covers, not on one that only crosses it', () => {
  const { map } = sample();
  const walls: Segment2D[] = [
    { id: 'cross', ax: 120, ay: 0, bx: 120, by: 100, thickness: 8 },
    { id: 'w', ax: 20, ay: 50, bx: 380, by: 50, thickness: 8 },
  ];
  const door = openingsFromClasses(map, walls).find((o) => o.kind === 'door')!;
  assert.equal(door.wall, 1);
});

test('[Model] for scoring, a wall is its solid pieces: the stretches between its doors and windows', () => {
  const { map, walls } = sample();
  const pieces = solidWallPieces(walls, openingsFromClasses(map, walls));
  assert.equal(pieces.length, 3, 'before the door, between door and window, after the window');
  const spans = pieces.map((p) => [Math.round(p.ax), Math.round(p.bx)]);
  assert.ok(Math.abs(spans[0][1] - 100) <= 2 && Math.abs(spans[1][0] - 140) <= 2 && Math.abs(spans[1][1] - 250) <= 2 && Math.abs(spans[2][0] - 310) <= 2, JSON.stringify(spans));
  assert.deepEqual(solidWallPieces(walls, []), walls, 'a wall without openings is itself');
});
