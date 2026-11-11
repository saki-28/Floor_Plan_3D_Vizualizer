/**
 * Edit plan operations: snapping, joined wall ends that move together, T junctions that follow a
 * moved wall, wall length, door and window placement; and undo/redo of edits.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { FloorPlanDataset, Opening2D, WallSegment2D } from '../types/floorplan.ts';
import {
  addRoom,
  addWall,
  fitPosition,
  moveWall,
  moveWallEnd,
  nearestWall,
  parseTyped,
  placeOpening,
  pointAtLength,
  setWallLength,
  setWallThickness,
  snapPoint,
  updateOpening,
  wallLength,
} from './planEditing.ts';
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

test('[Edit] the Room tool makes four walls joined at their corners, from two corners in any order', () => {
  const made = addRoom([], { x: 5, z: 4 }, { x: 0, z: 0 }, 0.3)!;
  assert.equal(made.walls.length, 4);
  assert.ok(made.walls.every((w) => w.thickness === 0.3));
  for (let i = 0; i < 4; i++) assert.deepEqual(made.walls[i].end, made.walls[(i + 1) % 4].start, 'each wall starts where the last one ends');
  assert.deepEqual(made.walls.map(wallLength), [5, 4, 5, 4]);
  assert.equal(addRoom([], { x: 0, z: 0 }, { x: 0.3, z: 4 }), null, 'too narrow to be a room');
  assert.equal(setWallThickness(made.walls, made.ids[0], 0.1)[0].thickness, 0.1);
});

test('[Edit] typed lengths and sizes: 3.5, 5x4, 5*4, a decimal comma; nonsense is refused', () => {
  assert.deepEqual(parseTyped('3.5'), [3.5]);
  assert.deepEqual(parseTyped('5x4'), [5, 4]);
  assert.deepEqual(parseTyped('5*4,5'), [5, 4.5]);
  for (const bad of ['', 'x4', '5x', '0', '1x2x3', '.']) assert.equal(parseTyped(bad), null, bad);
});

test('[Edit] a typed length goes the way the pointer points, kept level when the pointer is nearly level', () => {
  assert.deepEqual(pointAtLength({ x: 0, z: 0 }, { x: 3, z: 0.2 }, 4), { x: 4, z: 0 }, 'within 8° of level: straight along x');
  assert.deepEqual(pointAtLength({ x: 1, z: 1 }, { x: 1, z: -5 }, 2.5), { x: 1, z: -1.5 }, 'straight up the screen');
  const slanted = pointAtLength({ x: 0, z: 0 }, { x: 3, z: 1 }, 1)!;
  assert.ok(Math.abs(Math.hypot(slanted.x, slanted.z) - 1) < 1e-6 && slanted.z > 0.2, 'a clearly slanted pointer keeps its slant');
  assert.equal(pointAtLength({ x: 0, z: 0 }, { x: 0, z: 0 }, 2), null);
});

test("[Edit] a drawn plan's rooms follow its walls through edits and undo; hand-made rooms stay", () => {
  const blank: FloorPlanDataset = {
    id: 'b', name: 'B', description: '', difficulty: 'Clean Orthogonal', widthPx: 800, heightPx: 600, scale: 0.015, u0: 400, v0: 300,
    walls: [], openings: [], rooms: [], furniture: [],
  };
  let s = initialPlanState(blank);
  const first = addRoom([], { x: 0, z: 0 }, { x: 4, z: 3 }, 0.2)!;
  s = planReducer(s, { type: 'edit', walls: first.walls, openings: [] });
  assert.equal(s.plan.rooms.length, 1);
  assert.equal(s.plan.rooms[0].areaSqM, 10.6, '3.8 × 2.8 m inside 0.2 m walls, near enough');
  s = planReducer(s, { type: 'renameRoom', id: s.plan.rooms[0].id, name: 'Kitchen' });
  const second = addRoom(s.plan.walls, { x: 4, z: 0 }, { x: 7, z: 3 }, 0.2)!;
  s = planReducer(s, { type: 'edit', walls: second.walls, openings: [] });
  assert.deepEqual(s.plan.rooms.map((r) => r.name).sort(), ['Kitchen', 'Room 1'], 'the shared wall makes two rooms; the first keeps its name');
  s = planReducer(s, { type: 'undo' });
  assert.deepEqual(s.plan.rooms.map((r) => r.name), ['Kitchen']);

  const sample = { ...blank, walls: first.walls, rooms: [{ id: 'living', name: 'Living', color: '#fff', corners: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }], areaSqM: 1, type: 'living' as const }] };
  let t = initialPlanState(sample);
  t = planReducer(t, { type: 'edit', walls: moveWall(first.walls, first.ids[0], { x: 0, z: -1 }), openings: [] });
  assert.deepEqual(t.plan.rooms.map((r) => r.id), ['living'], 'rooms named by hand are left as they are');
});
