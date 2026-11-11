import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Point2D, WallSegment2D } from '../types/floorplan';
import { detectRooms, enclosedAreas, labelPoint, pointInPolygon, signedArea, usesDetectedRooms } from './rooms';

let serial = 0;
const wall = (ax: number, az: number, bx: number, bz: number, thickness = 0.2): WallSegment2D => ({
  id: `w${++serial}`,
  start: { x: ax, z: az },
  end: { x: bx, z: bz },
  thickness,
  height: 2.8,
});
/** A closed outline through the given corners. */
const loop = (...pts: [number, number][]) => pts.map(([x, z], i) => wall(x, z, pts[(i + 1) % pts.length][0], pts[(i + 1) % pts.length][1]));
const areas = (walls: WallSegment2D[]) => enclosedAreas(walls).map((p) => Math.round(signedArea(p) * 100) / 100).sort((a, b) => a - b);

test('four walls round a space make one room, and the outside is not a room', () => {
  assert.deepEqual(areas(loop([0, 0], [5, 0], [5, 4], [0, 4])), [20]);
});

test('a wall across a room splits it into two, ending on the outer walls (T junctions)', () => {
  const walls = [...loop([0, 0], [6, 0], [6, 4], [0, 4]), wall(2, 0, 2, 4)];
  assert.deepEqual(areas(walls), [8, 16]);
});

test('an L-shaped outline is one room with its label inside', () => {
  const walls = loop([0, 0], [6, 0], [6, 2], [2, 2], [2, 5], [0, 5]);
  const [room] = enclosedAreas(walls);
  assert.equal(Math.round(signedArea(room)), 6 * 2 + 2 * 3);
  assert.ok(pointInPolygon(labelPoint(room), room));
});

test('an outline left open, or a stray wall, makes no room and does not break the others', () => {
  assert.deepEqual(areas([wall(0, 0, 5, 0), wall(5, 0, 5, 4), wall(5, 4, 0, 4)]), []);
  const walls = [...loop([0, 0], [4, 0], [4, 3], [0, 3]), wall(1, 1, 2, 1), wall(4, 1.5, 7, 1.5)];
  assert.deepEqual(areas(walls), [12]);
});

test('a room drawn against another shares the wall, even where the walls only partly overlap', () => {
  const a = loop([0, 0], [4, 0], [4, 4], [0, 4]);
  const b = loop([4, 1], [7, 1], [7, 3], [4, 3]); // its left wall lies along part of a's right wall
  assert.deepEqual(areas([...a, ...b]), [6, 16]);
});

test('corners that miss by a centimetre still close the room', () => {
  const walls = [wall(0, 0, 5, 0), wall(5, 0.01, 5, 4), wall(5, 4, 0, 4), wall(0, 4, 0.01, 0)];
  assert.equal(enclosedAreas(walls).length, 1);
});

test('rooms keep their names when walls move, and new rooms get new names', () => {
  const walls = [...loop([0, 0], [6, 0], [6, 4], [0, 4]), wall(2, 0, 2, 4)];
  const first = detectRooms(walls);
  assert.deepEqual(first.map((r) => r.name).sort(), ['Room 1', 'Room 2']);
  assert.ok(usesDetectedRooms(first));
  const kitchen = first.map((r) => (signedArea(r.corners) < 10 ? { ...r, name: 'Kitchen' } : r));
  const moved = walls.map((w) => (w.start.x === 2 && w.end.x === 2 ? { ...w, start: { x: 2.5, z: 0 }, end: { x: 2.5, z: 4 } } : w));
  const after = detectRooms(moved, kitchen);
  assert.deepEqual(after.map((r) => r.name).sort(), ['Kitchen', 'Room 2']);
  // Floor area is inside the walls: a 6 × 4 m outline of 0.2 m walls holds about 5.8 × 3.8 m.
  assert.equal(detectRooms(loop([0, 0], [6, 0], [6, 4], [0, 4]))[0].areaSqM, 22);
});

test('rooms someone drew or named by hand are not replaced', () => {
  const corners: Point2D[] = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }];
  assert.equal(usesDetectedRooms([{ id: 'kitchen', name: 'Kitchen', color: '#fff', corners, areaSqM: 1, type: 'kitchen' }]), false);
  assert.equal(usesDetectedRooms([]), true);
});
