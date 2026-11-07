/**
 * Edit plan operations: snapping, joined wall ends that move together, T junctions that follow a
 * moved wall, wall length, door and window placement; and undo/redo of edits.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { FloorPlanDataset, Opening2D, WallSegment2D } from '../types/floorplan.ts';
import { addWall, fitPosition, moveWall, moveWallEnd, nearestWall, placeOpening, setWallLength, snapPoint, updateOpening, wallLength } from './planEditing.ts';
import { initialPlanState, planReducer } from '../data/planHistory.ts';

const wall = (id: string, x1: number, z1: number, x2: number, z2: number): WallSegment2D => ({
  id,
  start: { x: x1, z: z1 },
  end: { x: x2, z: z2 },
  thickness: 0.2,
  height: 2.8,
});
// A 4 × 3 m room, and an inner wall meeting the north wall part-way along it (a T junction).
const room = [wall('n', 0, 0, 4, 0), wall('e', 4, 0, 4, 3), wall('s', 4, 3, 0, 3), wall('w', 0, 3, 0, 0), wall('t', 2, 0, 2, 3)];
const byId = (walls: WallSegment2D[], id: string) => walls.find((w) => w.id === id)!;

test('[Edit] the pointer snaps to wall ends, then to walls, then to the grid; Shift keeps it straight', () => {
  const ends = room.flatMap((w) => [w.start, w.end]);
  const lines = room.map((w) => [w.start, w.end] as [typeof w.start, typeof w.end]);
  assert.deepEqual(snapPoint({ x: 3.93, z: 0.05 }, { grid: 0.1, ends, radius: 0.15 }), { point: { x: 4, z: 0 }, kind: 'end' });
  assert.deepEqual(snapPoint({ x: 1.23, z: 0.07 }, { grid: 0.1, ends, lines, radius: 0.15 }).kind, 'line');
  assert.deepEqual(snapPoint({ x: 1.23, z: 1.47 }, { grid: 0.1, ends, lines, radius: 0.15 }), { point: { x: 1.2, z: 1.5 }, kind: 'grid' });
  // Shift: from (1, 1), a pointer mostly to the right stays at z = 1.
  assert.deepEqual(snapPoint({ x: 3.27, z: 1.4 }, { grid: 0.1, ends, radius: 0.15, anchor: { x: 1, z: 1 }, ortho: true }).point, { x: 3.3, z: 1 });
  assert.deepEqual(snapPoint({ x: 1.2, z: 2.66 }, { grid: 0.1, ends, radius: 0.15, anchor: { x: 1, z: 1 }, ortho: true }).point, { x: 1, z: 2.7 });
});

test('[Edit] moving a corner moves both walls that meet there', () => {
  const walls = moveWallEnd(room, 'n', 'end', { x: 5, z: -1 });
  assert.deepEqual(byId(walls, 'n').end, { x: 5, z: -1 });
  assert.deepEqual(byId(walls, 'e').start, { x: 5, z: -1 }, 'the east wall stays joined');
  assert.deepEqual(byId(walls, 's'), byId(room, 's'));
});

test('[Edit] moving a whole wall drags the walls joined to it, at its corners and part-way along it', () => {
  const walls = moveWall(room, 'n', { x: 0, z: -1 });
  assert.deepEqual([byId(walls, 'n').start, byId(walls, 'n').end], [{ x: 0, z: -1 }, { x: 4, z: -1 }]);
  assert.deepEqual(byId(walls, 'e').start, { x: 4, z: -1 });
  assert.deepEqual(byId(walls, 'w').end, { x: 0, z: -1 });
  assert.deepEqual(byId(walls, 't').start, { x: 2, z: -1 }, 'the T junction follows');
  assert.deepEqual(byId(walls, 't').end, { x: 2, z: 3 }, 'its far end stays');
});

test('[Edit] a wall length can be typed in, and a new wall takes the plan\'s usual size', () => {
  const walls = setWallLength(room, 'n', 5);
  assert.equal(wallLength(byId(walls, 'n')), 5);
  assert.deepEqual(byId(walls, 'e').start, { x: 5, z: 0 });
  const added = addWall([{ ...room[0], thickness: 0.3, height: 3 }, { ...room[1], thickness: 0.3, height: 3 }], { x: 0, z: 0 }, { x: 0, z: 2 });
  assert.equal(added.id, 'wall-3');
  assert.deepEqual([byId(added.walls, 'wall-3').thickness, byId(added.walls, 'wall-3').height], [0.3, 3]);
  assert.equal(nearestWall(room, { x: 1, z: 0.08 }, 0.1)?.wall.id, 'n');
  assert.equal(nearestWall(room, { x: 1, z: 1 }, 0.1), null);
});

test('[Edit] doors and windows are placed where clicked and always fit on their wall', () => {
  const { openings, id } = placeOpening([], byId(room, 'n'), 'door', 0.98);
  const door = openings.find((o) => o.id === id)!;
  assert.deepEqual([door.kind, door.wallId, door.width], ['door', 'n', 0.9]);
  assert.equal(door.position, fitPosition(0.98, 0.9, 4), 'slid back so the whole door is on the wall');
  assert.ok(door.position * 4 + 0.45 <= 4 + 1e-9);

  const asWindow = updateOpening(openings, id, { kind: 'window' })[0];
  assert.deepEqual([asWindow.kind, asWindow.sill, asWindow.height], ['window', 0.9, 1.2], 'a window gets a sill');
  const wide = updateOpening(openings, id, { width: 2 }, byId(room, 'n'))[0];
  assert.ok(wide.position * 4 + 1 <= 4 + 1e-9, 'widening keeps it on the wall');
});

test('[Edit] undo and redo step through edits; one drag is one step; a new plan clears the history', () => {
  const plan: FloorPlanDataset = {
    id: 'p', name: 'P', description: '', difficulty: 'Clean Orthogonal', widthPx: 800, heightPx: 600, scale: 0.015, u0: 400, v0: 300,
    walls: room, openings: [], rooms: [], furniture: [],
  };
  const door: Opening2D = { id: 'door-1', kind: 'door', wallId: 't', position: 0.5, width: 0.9, sill: 0, height: 2.1 };
  let s = initialPlanState(plan);
  s = planReducer(s, { type: 'edit', walls: room, openings: [door] });
  // A drag: three moves with one merge key, then the pointer is released.
  for (const z of [-0.2, -0.5, -1]) s = planReducer(s, { type: 'edit', walls: moveWall(room, 'n', { x: 0, z }), openings: [door], mergeKey: 'drag-1' });
  s = planReducer(s, { type: 'settle' });
  // Deleting the inner wall removes its door too.
  s = planReducer(s, { type: 'edit', walls: s.plan.walls.filter((w) => w.id !== 't'), openings: s.plan.openings });
  assert.equal(s.plan.openings.length, 0);
  assert.equal(s.past.length, 3, 'add door, the drag, the delete');

  s = planReducer(s, { type: 'undo' });
  assert.equal(s.plan.openings.length, 1, 'the wall and its door are back');
  s = planReducer(s, { type: 'undo' });
  assert.deepEqual(byId(s.plan.walls, 'n').start, { x: 0, z: 0 }, 'the whole drag undone at once');
  s = planReducer(s, { type: 'redo' });
  assert.deepEqual(byId(s.plan.walls, 'n').start, { x: 0, z: -1 });
  assert.equal(s.future.length, 1);
  s = planReducer(s, { type: 'edit', walls: room, openings: [] });
  assert.equal(s.future.length, 0, 'a new edit drops the redo steps');
  s = planReducer(s, { type: 'replace', plan });
  assert.deepEqual([s.past.length, s.future.length], [0, 0]);
});
