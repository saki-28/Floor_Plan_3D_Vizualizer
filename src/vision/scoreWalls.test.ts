/**
 * Length-based wall scoring and the walls → 3D plan conversion.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { Segment2D } from '../types/floorplan.ts';
import { scoreWalls } from './scoreWalls.ts';
import { guessMetersPerPixel, wallsToPlan } from './wallsToPlan.ts';

const seg = (ax: number, ay: number, bx: number, by: number, thickness = 10): Segment2D => ({ id: '', ax, ay, bx, by, thickness });

test('[Score] a perfect match scores 1, half a wall scores half the recall, a far line scores 0', () => {
  const truth = [seg(0, 0, 100, 0), seg(0, 0, 0, 100)];
  assert.equal(scoreWalls(truth, truth).f1, 1);

  const half = scoreWalls([seg(0, 0, 100, 0)], truth);
  assert.ok(Math.abs(half.recall - 0.5) < 0.02, `recall ${half.recall}`);
  assert.equal(half.precision, 1);
  assert.equal(half.piecesFound, 1);

  const far = scoreWalls([seg(0, 20, 100, 20)], truth);
  assert.ok(far.recall < 0.15 && far.precision < 0.15, 'a parallel line 20 px away is not the wall');

  const crossing = scoreWalls([seg(50, -50, 50, 50)], [seg(0, 0, 100, 0)]);
  assert.equal(crossing.precision, 0, 'a perpendicular line through the wall is not the wall');
});

test('[Plan] detected walls become a metric plan, centred, with no mirroring', () => {
  const walls = [seg(100, 100, 300, 100, 20), seg(300, 100, 300, 250, 20)];
  const plan = wallsToPlan(walls, 0.05, { name: 'Detected: test', width: 400, height: 300 });
  const [top, right] = plan.walls;
  assert.deepEqual([top.start.x, top.start.z, top.end.x], [-5, -3.75, 5], 'image (100,100) maps to (−5 m, −3.75 m) from the centre');
  assert.ok(right.end.z > right.start.z, 'image-down is +Z');
  assert.ok(Math.abs(top.thickness - 1) < 1e-9, '20 px at 0.05 m/px is 1 m');
  assert.equal(plan.rooms.length, 1, 'one floor under the walls');

  assert.ok(Math.abs(guessMetersPerPixel(walls) - 0.01) < 1e-9, 'a 20 px wall is taken as 0.2 m when there is no scale');

  // The same walls tilted 2° in the image come out straight when the skew is passed.
  const t = (2 * Math.PI) / 180;
  const tilt = (x: number, y: number) => [200 + (x - 200) * Math.cos(t) - (y - 150) * Math.sin(t), 150 + (x - 200) * Math.sin(t) + (y - 150) * Math.cos(t)];
  const tilted = walls.map((w) => {
    const [ax, ay] = tilt(w.ax, w.ay);
    const [bx, by] = tilt(w.bx, w.by);
    return { ...w, ax, ay, bx, by };
  });
  const straight = wallsToPlan(tilted, 0.05, { name: 'Detected: tilted', width: 400, height: 300, skewDeg: 2 }).walls[0];
  assert.ok(Math.abs(straight.start.z - straight.end.z) < 1e-9, 'the top wall is level again');
  assert.ok(Math.abs(straight.end.x - straight.start.x - 10) < 1e-9, 'and keeps its 10 m length');
});
