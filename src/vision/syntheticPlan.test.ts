/**
 * Synthetic floor-plan renderer tests: orientation (no mirroring), openings,
 * and ground truth under rotation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { FloorPlanDataset, Opening2D, WallSegment2D } from '../types/floorplan.ts';
import { renderSyntheticPlan } from './syntheticPlan.ts';

function planWith(walls: WallSegment2D[], openings: Opening2D[] = []): FloorPlanDataset {
  return {
    id: 'test',
    name: 'Test',
    description: '',
    difficulty: 'Clean Orthogonal',
    widthPx: 0,
    heightPx: 0,
    scale: 0.015,
    u0: 0,
    v0: 0,
    walls,
    openings,
    rooms: [],
    furniture: [],
  };
}

const wall = (id: string, x1: number, z1: number, x2: number, z2: number, extra: Partial<WallSegment2D> = {}): WallSegment2D => ({
  id,
  start: { x: x1, z: z1 },
  end: { x: x2, z: z2 },
  thickness: 0.3,
  height: 2.8,
  ...extra,
});

const at = (img: { width: number; gray: Uint8Array }, u: number, v: number) => img.gray[Math.round(v) * img.width + Math.round(u)];

test('[Synth] +Z walls render lower in the image and +X walls further right (no mirroring)', () => {
  const img = renderSyntheticPlan(
    planWith([wall('north', -2, -2, 2, -2), wall('south', -2, 2, 2, 2), wall('east', 3, -1, 3, 1)]),
    { labels: false, dimensions: false },
  );
  const [north, south, east] = img.groundTruth;
  assert.ok(south.ay > north.ay, 'z = +2 is below z = −2');
  assert.ok(east.ax > north.bx, 'x = 3 is right of x = 2');
  assert.equal(img.groundTruth.length, 3);
  assert.equal(east.thickness, 0.3 * img.pixelsPerMeter);
});

test('[Synth] walls are dark ink and door openings are cut out of them', () => {
  const img = renderSyntheticPlan(planWith([wall('w', -3, 0, 3, 0)], [{ id: 'd', kind: 'door', wallId: 'w', position: 0.5, width: 1.0, sill: 0, height: 2.1 }]), {
    labels: false,
    dimensions: false,
    doorSwings: false,
  });
  const [w] = img.groundTruth;
  const midV = (w.ay + w.by) / 2;
  assert.ok(at(img, w.ax + 30, midV) < 50, 'solid part of the wall is ink');
  assert.ok(at(img, (w.ax + w.bx) / 2, midV) > 200, 'door gap is paper');
  assert.equal(img.groundTruthPieces.length, 2, 'the door splits the wall into two solid pieces');
  const piecesLength = img.groundTruthPieces.reduce((sum, p) => sum + Math.hypot(p.bx - p.ax, p.by - p.ay), 0);
  assert.ok(Math.abs(piecesLength - (6 - 1) * img.pixelsPerMeter) < 1e-6, 'pieces cover the wall minus the 1 m door');
});

test('[Synth] rotation moves ground-truth endpoints with the drawing', () => {
  const plan = planWith([wall('w', -3, 0, 3, 0)]);
  const options = { labels: false, dimensions: false, rotationDeg: 10 };
  const img = renderSyntheticPlan(plan, options);
  const [w] = img.groundTruth;
  const angle = (Math.atan2(w.by - w.ay, w.bx - w.ax) * 180) / Math.PI;
  assert.ok(Math.abs(angle - 10) < 1e-6, `centerline rotated by 10°, got ${angle}`);
  const t = 0.25; // a point a quarter of the way along the rotated centerline is still on ink
  assert.ok(at(img, w.ax + (w.bx - w.ax) * t, w.ay + (w.by - w.ay) * t) < 80);
});
