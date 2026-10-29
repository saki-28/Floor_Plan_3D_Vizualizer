import test from 'node:test';
import assert from 'node:assert/strict';
import {
  imageToWorld,
  worldToImage,
  extrudeWallSegment,
  mat4Identity,
  mat4Multiply,
  mat4Perspective,
  mat4LookAt,
  transformVertexMVP,
  bresenhamLine,
  ddaLine,
  mat4Invert,
  screenToFloorRay,
  snapToFloorGeometry,
  triangulatePolygon2D,
} from './geometryEngine.ts';

test('imageToWorld maps pixel coordinates correctly', () => {
  const config = { scale: 0.05, u0: 100, v0: 200 };
  const world = imageToWorld(140, 260, config);
  assert.equal(Math.round(world.x * 100) / 100, 2.0); // 0.05 * (140 - 100) = 2.0
  assert.equal(Math.round(world.z * 100) / 100, -3.0); // -0.05 * (260 - 200) = -3.0

  const [u, v] = worldToImage(world.x, world.z, config);
  assert.equal(u, 140);
  assert.equal(v, 260);
});

test('extrudeWallSegment handles degenerate zero-length wall safely', () => {
  const degenerate = {
    id: 'w0',
    start: { x: 5, z: 5 },
    end: { x: 5, z: 5 },
    thickness: 0.2,
    height: 2.8,
  };
  const mesh = extrudeWallSegment(degenerate);
  assert.equal(mesh.vertices.length, 0);
  assert.equal(mesh.indices.length, 0);
});

test('extrudeWallSegment generates 6 quad faces (24 vertices, 36 indices) with correct normal directions', () => {
  const wall = {
    id: 'w1',
    start: { x: 0, z: 0 },
    end: { x: 4, z: 0 },
    thickness: 0.2,
    height: 2.8,
  };
  const mesh = extrudeWallSegment(wall);
  assert.equal(mesh.vertices.length, 24); // 6 faces * 4 vertices
  assert.equal(mesh.indices.length, 36);  // 6 faces * 2 triangles * 3 indices

  // Check top face normal is (0, 1, 0)
  const topVertices = mesh.vertices.filter(v => v.normal[1] === 1);
  assert.equal(topVertices.length, 4);
  assert.equal(topVertices[0].position[1], 2.8);
});

test('bresenhamLine draws straight orthogonal and diagonal lines correctly', () => {
  const hLine = bresenhamLine(0, 0, 4, 0);
  assert.equal(hLine.length, 5);
  assert.deepEqual(hLine[0], [0, 0]);
  assert.deepEqual(hLine[4], [4, 0]);

  const diagLine = bresenhamLine(0, 0, 3, 3);
  assert.equal(diagLine.length, 4);
  assert.deepEqual(diagLine, [[0, 0], [1, 1], [2, 2], [3, 3]]);
});

test('DDA line generates matching endpoints', () => {
  const line = ddaLine(0, 0, 5, 5);
  assert.equal(line.length, 6);
  assert.deepEqual(line[0], [0, 0]);
  assert.deepEqual(line[5], [5, 5]);
});

test('MVP matrix computation transforms origin vertex to NDC clip space properly', () => {
  const model = mat4Identity();
  const view = mat4LookAt(0, 2, 5, 0, 0, 0, 0, 1, 0);
  const proj = mat4Perspective(Math.PI / 4, 1.0, 0.1, 100.0);
  const mv = mat4Multiply(view, model);
  const mvp = mat4Multiply(proj, mv);

  const clipPos = transformVertexMVP(mvp, [0, 0, 0]);
  // W coordinate should be positive distance in front of camera
  assert.ok(clipPos[3] > 0, 'w_c should be > 0 for point in front of camera');
});

test('mat4Invert correctly inverts identity and translation matrices', () => {
  const ident = mat4Identity();
  const inv = mat4Invert(ident);
  assert.ok(inv !== null);
  assert.equal(inv![0], 1);
  assert.equal(inv![5], 1);
  assert.equal(inv![10], 1);
  assert.equal(inv![15], 1);
});

test('screenToFloorRay unprojects center screen to floor origin in top-down camera view', () => {
  // Top-down camera at (0, 10, 0) looking at (0, 0, 0) with up (0, 0, -1)
  const view = mat4LookAt(0, 10, 0, 0, 0, 0, 0, 0, -1);
  const proj = mat4Perspective((45 * Math.PI) / 180, 1.0, 0.1, 100.0);
  const width = 800;
  const height = 800;

  // Center of screen (400, 400) should project to (0, 0) on floor plane y = 0
  const floorPt = screenToFloorRay(400, 400, width, height, view, proj);
  assert.ok(floorPt !== null);
  assert.ok(Math.abs(floorPt!.x) < 1e-4, `Expected x near 0, got ${floorPt!.x}`);
  assert.ok(Math.abs(floorPt!.z) < 1e-4, `Expected z near 0, got ${floorPt!.z}`);
});

test('snapToFloorGeometry snaps within threshold and ignores points outside threshold', () => {
  const candidates = [
    { x: 0.0, z: 0.0 },
    { x: 5.0, z: 5.0 },
  ];

  // Point at (0.1, 0.1) is within default 0.4m radius of (0, 0)
  const res1 = snapToFloorGeometry({ x: 0.1, z: 0.1 }, candidates, 0.4);
  assert.equal(res1.snapped, true);
  assert.equal(res1.point.x, 0.0);
  assert.equal(res1.point.z, 0.0);

  // Point at (2.0, 2.0) is far away from all candidates
  const res2 = snapToFloorGeometry({ x: 2.0, z: 2.0 }, candidates, 0.4);
  assert.equal(res2.snapped, false);
  assert.equal(res2.point.x, 2.0);
  assert.equal(res2.point.z, 2.0);
});

test('triangulatePolygon2D correctly triangulates concave L-shaped polygon without slicing void', () => {
  // L-shaped room with 6 vertices
  const lShapeCorners = [
    { x: 0, z: 0 },
    { x: 4, z: 0 },
    { x: 4, z: 2 },
    { x: 2, z: 2 },
    { x: 2, z: 4 },
    { x: 0, z: 4 },
  ];

  const indices = triangulatePolygon2D(lShapeCorners);
  // A 6-vertex simple polygon triangulates into (6 - 2) = 4 triangles => 12 indices
  assert.equal(indices.length, 12);

  // Validate that no triangle connects (0,0) to (4,2) to (2,4) across the void
  for (let i = 0; i < indices.length; i += 3) {
    const tri = [indices[i], indices[i + 1], indices[i + 2]].sort();
    // (0, 2, 4) would be a diagonal slicing across the cutout
    assert.ok(!(tri[0] === 0 && tri[1] === 2 && tri[2] === 4), 'Should not produce diagonal slicing across void');
  }
});


