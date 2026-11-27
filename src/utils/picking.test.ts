import test from 'node:test';
import assert from 'node:assert/strict';
import type { Opening2D, WallSegment2D } from '../types/floorplan';
import { mat4LookAt, mat4Perspective, worldToScreen } from './geometryEngine';
import { isVisibleAlong, measureCorners, pickScene, screenRay, snapToCorner, straighten, type Ray, type Vec3 } from './picking';

const wall = (id: string, x1: number, z1: number, x2: number, z2: number): WallSegment2D => ({
  id,
  start: { x: x1, z: z1 },
  end: { x: x2, z: z2 },
  thickness: 0.2,
  height: 2.8,
});
/** A 4 × 3 m room, walls meeting at their centre lines. */
const ROOM = [wall('n', 0, 0, 4, 0), wall('e', 4, 0, 4, 3), wall('s', 4, 3, 0, 3), wall('w', 0, 3, 0, 0)];
const DOOR: Opening2D = { id: 'door-1', kind: 'door', wallId: 'n', position: 0.5, width: 1, sill: 0, height: 2.1 };
const rayTo = (from: Vec3, to: Vec3): Ray => ({ origin: from, dir: [to[0] - from[0], to[1] - from[1], to[2] - from[2]] });
const has = (points: { x: number; z: number }[], x: number, z: number) => points.some((p) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.z - z) < 1e-6);

test('a ray through the middle of the screen runs from the eye to what the camera looks at', () => {
  const view = mat4LookAt(0, 10, 10, 0, 0, 0, 0, 1, 0);
  const proj = mat4Perspective(Math.PI / 4, 1.5, 0.1, 100);
  const ray = screenRay(300, 200, 600, 400, view, proj)!;
  const hit = pickScene(ray, [], [])!;
  assert.equal(hit.kind, 'floor');
  assert.ok(Math.abs(hit.point[0]) < 1e-6 && Math.abs(hit.point[2]) < 1e-6);
});

test('pointing at a wall hits the wall, at its door hits the door, past it hits the floor', () => {
  // From outside the north wall (z < 0), looking south at chest height.
  const solid = pickScene(rayTo([0.7, 1.2, -5], [0.7, 1.2, 5]), ROOM, [DOOR])!;
  assert.deepEqual([solid.kind, solid.kind === 'wall' && solid.id], ['wall', 'n']);
  assert.ok(Math.abs(solid.point[2] + 0.1) < 1e-9, 'the hit is on the outer face, half a thickness out');

  const door = pickScene(rayTo([2, 1.2, -5], [2, 1.2, 5]), ROOM, [DOOR])!;
  assert.deepEqual([door.kind, door.kind === 'opening' && door.id], ['opening', 'door-1']);

  const lintel = pickScene(rayTo([2, 2.5, -5], [2, 2.5, 5]), ROOM, [DOOR])!;
  assert.equal(lintel.kind, 'wall', 'above the door is wall again');

  const floor = pickScene(rayTo([2, 6, 1.5], [2, 0, 1.5]), ROOM, [DOOR])!;
  assert.equal(floor.kind, 'floor');
});

test('measuring snaps to the corners that are built, not to wall centre lines', () => {
  const corners = measureCorners(ROOM, []);
  assert.ok(has(corners, 0.1, 0.1) && has(corners, 3.9, 2.9), 'the room’s inside corners');
  assert.ok(has(corners, 4.1, -0.1) && has(corners, -0.1, 3.1), 'the outside corners, where the outer faces meet');
  assert.ok(!has(corners, 0, 0) && !has(corners, 4, 3), 'not the centre-line corners, which are inside the walls');
  assert.ok(!has(corners, 4.1, 0) && !has(corners, 4, -0.1), 'nor the wall ends beside a filled corner, which lie on a flat face');
  assert.equal(corners.length, 8, 'four inside and four outside corners for a plain room');
});

test('both sides of a door, on both faces of its wall, are corners too', () => {
  const corners = measureCorners(ROOM, [DOOR]);
  for (const x of [1.5, 2.5]) for (const z of [-0.1, 0.1]) assert.ok(has(corners, x, z), `door side at ${x}, ${z}`);
});

test('a T-junction adds the corners where the dividing wall meets the long one', () => {
  const corners = measureCorners([...ROOM, wall('mid', 2, 0, 2, 3)], []);
  assert.ok(has(corners, 1.9, 0.1) && has(corners, 2.1, 0.1) && has(corners, 1.9, 2.9));
  assert.ok(!has(corners, 1.9, 0) && !has(corners, 2.1, 0), 'its end corners are inside the north wall');
});

test('the pointer snaps to the nearest corner on the screen, at the top of a wall or at the floor', () => {
  const view = mat4LookAt(2, 12, 9, 2, 0, 1.5, 0, 1, 0);
  const proj = mat4Perspective(Math.PI / 4, 1.5, 0.1, 100);
  const project = (p: Vec3) => worldToScreen(p, view, proj, 900, 600);
  const corners = measureCorners(ROOM, []);
  const top = project([0.1, 2.8, 0.1])!;
  const snap = snapToCorner([top[0] + 4, top[1] - 3], corners, [0, 2.8], project)!;
  assert.deepEqual([snap.point.x, snap.point.z, snap.y], [0.1, 0.1, 2.8]);
  assert.equal(snapToCorner([top[0] + 40, top[1] - 60], corners, [0, 2.8], project, 14), null, 'nothing within reach');
});

test('a corner hidden behind a wall is not snapped to', () => {
  // Looking south from outside at eye height: the far wall’s floor corners are behind the north wall.
  const eye: Vec3 = [2, 1.4, -8];
  const far: Vec3 = [0.1, 0, 2.9];
  assert.equal(isVisibleAlong(rayTo(eye, far), far, ROOM, []), false);
  const nearCorner: Vec3 = [-0.1, 0, -0.1];
  assert.equal(isVisibleAlong(rayTo(eye, nearCorner), nearCorner, ROOM, []), true);
});

test('Shift keeps a measurement along the plan’s X or Z', () => {
  assert.deepEqual(straighten({ x: 1, z: 1 }, { x: 4, z: 1.4 }), { x: 4, z: 1 });
  assert.deepEqual(straighten({ x: 1, z: 1 }, { x: 1.2, z: -3 }), { x: 1, z: -3 });
});
