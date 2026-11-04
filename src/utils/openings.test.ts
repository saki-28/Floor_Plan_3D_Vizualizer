/**
 * Openings as the plan's own list: placement along a wall, the cuts handed to the 3D extrusion,
 * ids, and reading the older per-wall door/window fields.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { Opening2D, WallSegment2D } from '../types/floorplan.ts';
import { fromLegacyWalls, makeOpening, nextOpeningId, openingSpan, pruneOpenings, wallCuts } from './openings.ts';

const wall: WallSegment2D = { id: 'w', start: { x: 0, z: 0 }, end: { x: 4, z: 0 }, thickness: 0.2, height: 2.8 };
const window: Opening2D = { id: 'window-1', kind: 'window', wallId: 'w', position: 0.5, width: 1.2, sill: 0.9, height: 1.5 };

test('[Openings] an opening keeps its width and stays inside its wall', () => {
  assert.deepEqual(openingSpan({ ...window, position: 0.5, width: 1 }, 4), { from: 1.5, to: 2.5 });
  assert.deepEqual(openingSpan({ ...window, position: 0.95, width: 1 }, 4), { from: 3, to: 4 }, 'slid back inside the wall end');
  assert.deepEqual(openingSpan({ ...window, position: 0.02, width: 1 }, 4), { from: 0, to: 1 });
  assert.deepEqual(openingSpan({ ...window, width: 9 }, 4), { from: 0, to: 4 }, 'never wider than the wall');
});

test('[Openings] cuts are fractions of the wall, with heights limited to the wall', () => {
  const [cut] = wallCuts([window, { ...window, id: 'other', wallId: 'x' }], wall, 2.0);
  assert.equal(cut.wallId, 'w');
  assert.ok(Math.abs(cut.t0 - 0.35) < 1e-12 && Math.abs(cut.t1 - 0.65) < 1e-12, `t ${cut.t0}..${cut.t1}`);
  assert.deepEqual([cut.sill, cut.head], [0.9, 2.0], 'the window top is cut at the 2 m wall top');
  assert.equal(wallCuts([window], { ...wall, end: { x: 0, z: 0 } }).length, 0, 'a zero-length wall has nothing to cut');
});

test('[Openings] new ids are unique, and a deleted wall takes its openings with it', () => {
  const list = [window, { ...window, id: 'window-3' }];
  assert.equal(nextOpeningId(list, 'window'), 'window-4');
  assert.equal(nextOpeningId(list, 'door'), 'door-1');
  const door = makeOpening(list, 'door', 'w');
  assert.deepEqual(door, { id: 'door-1', kind: 'door', wallId: 'w', position: 0.5, width: 0.9, sill: 0, height: 2.1 });
  assert.deepEqual(pruneOpenings([window, { ...door, wallId: 'gone' }], [wall]), [window]);
});

test('[Openings] the older per-wall door and window fields become list entries', () => {
  const { walls, openings } = fromLegacyWalls([
    { ...wall, hasDoor: true, doorPosition: 0.25, doorWidth: 0.8, hasWindow: true, windowPosition: 0.7, windowWidth: 1.5, windowSillHeight: 1, windowHeight: 1.4 },
    { ...wall, id: 'v', hasDoor: true },
  ]);
  assert.deepEqual(walls[0], wall, 'the old fields are dropped from the wall');
  assert.deepEqual(
    openings.map((o) => [o.kind, o.wallId, o.position, o.width, o.sill, o.height]),
    [
      ['door', 'w', 0.25, 0.8, 0, 2.1],
      ['window', 'w', 0.7, 1.5, 1, 1.4],
      ['door', 'v', 0.5, 0.9, 0, 2.1],
    ],
  );
  assert.equal(new Set(openings.map((o) => o.id)).size, 3);
});
