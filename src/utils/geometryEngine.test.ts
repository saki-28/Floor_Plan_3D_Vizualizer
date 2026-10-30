/**
 * FloorPlan3D Geometry Engine Test Suite
 * ─────────────────────────────────────────────────────────────────────────────
 * Covers the Tier-1 deliverables from the final implementation plan (B10):
 *   - Coordinate mapping (R3 fix: z = +s*(v-v0), no mirroring)
 *   - Asymmetric-plan no-mirror regression test (M0/M1 gate)
 *   - Wall extrusion counts and face structure
 *   - Rasterization (Bresenham, DDA)
 *   - MVP pipeline (matrix stack, ray-floor, snapping)
 *   - Mesh validators (winding, outward normals, edge manifold, dimension)
 *   - OBJ export
 *   - Ear-clipping triangulation on concave shapes
 */

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
  validateWinding,
  validateOutwardNormals,
  validateEdgeManifold,
  validateDimension,
  exportToOBJ,
} from './geometryEngine.ts';

// ─── R3 Fix: Coordinate mapping (B3, no mirroring) ─────────────────────────

test('[R3] imageToWorld maps with POSITIVE z sign — image-down maps to +Z, no mirror', () => {
  const config = { scale: 0.05, u0: 100, v0: 200 };

  // Image pixel below origin (v > v0) must map to +Z, NOT −Z
  const world = imageToWorld(140, 260, config);
  assert.equal(Math.round(world.x * 100) / 100,  2.0);  // 0.05*(140-100) = +2.0
  assert.equal(Math.round(world.z * 100) / 100, +3.0);  // +0.05*(260-200) = +3.0  ← R3 fix

  // Round-trip must be exact inverse
  const [u, v] = worldToImage(world.x, world.z, config);
  assert.equal(u, 140);
  assert.equal(v, 260);
});

// ─── M0/M1 gate: Asymmetric-plan no-mirror regression ───────────────────────

test('[M0] Asymmetric L-plan: top-right notch stays on +X side without left/right mirror', () => {
  // An L-shaped plan with a distinctive notch in the top-right (NE) corner.
  // Image pixels: origin at (100,100), scale 0.01 m/px.
  //   NE pixel (200,0)  → world (+X, −Z)  [right and above image-center]
  //   SW pixel (0,200)  → world (−X, +Z)  [left and below image-center]
  const cfg = { scale: 0.01, u0: 100, v0: 100 };

  // Pixels to the RIGHT of image center → world +X (correct, not mirrored)
  const neCorner = imageToWorld(200, 0, cfg);
  assert.ok(neCorner.x > 0, `NE corner x must be +X (not mirrored), got ${neCorner.x}`);

  // Pixels to the LEFT of image center → world −X
  const nwCorner = imageToWorld(0, 0, cfg);
  assert.ok(nwCorner.x < 0, `NW corner x must be −X, got ${nwCorner.x}`);

  // Image top (v=0) maps to smaller z than image bottom (v=200)
  const topEdge    = imageToWorld(100, 0,   cfg);
  const bottomEdge = imageToWorld(100, 200, cfg);
  assert.ok(topEdge.z < bottomEdge.z,
    `Image-top should be smaller z than image-bottom. Got top=${topEdge.z}, bottom=${bottomEdge.z}`);

  // Critical symmetry check: notch area pixel (150,50) should be at +X and −Z
  const notchPx = imageToWorld(150, 50, cfg);
  assert.ok(notchPx.x > 0, 'Notch pixel (right of center) must have +X');
  assert.ok(notchPx.z < 0, 'Notch pixel (above center) must have −Z (above the floor-plan center)');
});

// ─── Wall extrusion ─────────────────────────────────────────────────────────

test('[Geom] extrudeWallSegment handles degenerate zero-length wall safely', () => {
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

test('[Geom] extrudeWallSegment generates 6 quad faces (24 vertices, 36 indices) with correct normal directions', () => {
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

  // Top face normal must be (0, 1, 0)
  const topVertices = mesh.vertices.filter(v => v.normal[1] === 1);
  assert.equal(topVertices.length, 4);
  assert.equal(topVertices[0].position[1], 2.8);
});

// ─── Mesh Validators (B8.7) ─────────────────────────────────────────────────

test('[Valid] validateWinding: all 12 triangles of a single wall box pass CCW winding check', () => {
  const wall = {
    id: 'wv',
    start: { x: 0, z: 0 },
    end: { x: 5, z: 0 },
    thickness: 0.2,
    height: 2.8,
  };
  const mesh = extrudeWallSegment(wall);
  const result = validateWinding(mesh);

  assert.equal(result.totalTriangles,   12, 'A 6-face wall box must have 12 triangles');
  assert.equal(result.passingTriangles, 12, 'All 12 triangles must pass the winding check');
  assert.equal(result.failedIndices.length, 0);
  assert.equal(result.passRate, 1.0);
});

test('[Valid] validateOutwardNormals: all 6 faces of a wall box have outward-pointing normals', () => {
  const wall = {
    id: 'wn',
    start: { x: 0, z: 0 },
    end: { x: 5, z: 0 },
    thickness: 0.2,
    height: 2.8,
  };
  const mesh = extrudeWallSegment(wall);
  const result = validateOutwardNormals(mesh);

  assert.equal(result.totalFaces,   6, '6 faces per wall box');
  assert.equal(result.outwardFaces, 6, 'All 6 face normals must point outward');
  assert.equal(result.outwardRate, 1.0);
});

test('[Valid] validateEdgeManifold: single wall box is a closed 2-manifold with 0 open edges', () => {
  const wall = {
    id: 'wm',
    start: { x: 0, z: 0 },
    end: { x: 5, z: 0 },
    thickness: 0.2,
    height: 2.8,
  };
  const mesh = extrudeWallSegment(wall);
  const result = validateEdgeManifold(mesh);

  assert.equal(result.openEdges,        0, 'A watertight box must have 0 open edges');
  assert.equal(result.nonManifoldEdges, 0, 'A watertight box must have 0 non-manifold edges');
  assert.ok(result.isManifold, 'isManifold must be true for a single wall box');
});

test('[Valid] validateDimension: a 5.00 m wall measures within 1 mm tolerance after calibration', () => {
  const wall = {
    id: 'wd',
    start: { x: 0, z: 0 },
    end: { x: 5.0, z: 0 },
    thickness: 0.2,
    height: 2.8,
  };
  const mesh = extrudeWallSegment(wall);
  const result = validateDimension(mesh, 5.0, 0.001);

  assert.ok(result.withinTolerance,
    `Measured ${result.measuredMeters.toFixed(4)} m vs expected 5.0000 m, error=${result.errorMeters.toFixed(6)} m`);
  assert.ok(result.errorMeters < 0.001, `Error ${result.errorMeters} must be < 1 mm`);
});

// ─── OBJ Export (B8.7) ──────────────────────────────────────────────────────

test('[OBJ] exportToOBJ produces valid OBJ text with correct vertex and face counts', () => {
  const wall = {
    id: 'wobj',
    start: { x: 0, z: 0 },
    end: { x: 3, z: 0 },
    thickness: 0.2,
    height: 2.8,
  };
  const mesh = extrudeWallSegment(wall);
  const obj = exportToOBJ(mesh, 'TestWall');

  assert.ok(obj.includes('o TestWall'), 'OBJ must contain the object name line');

  const vLines  = obj.split('\n').filter(l => l.startsWith('v '));
  const vnLines = obj.split('\n').filter(l => l.startsWith('vn '));
  const fLines  = obj.split('\n').filter(l => l.startsWith('f '));

  assert.equal(vLines.length,  24, '24 vertex position lines for a 6-face box');
  assert.equal(vnLines.length, 24, '24 vertex normal lines');
  assert.equal(fLines.length,  12, '12 face lines (12 triangles)');
});

// ─── Rasterization ──────────────────────────────────────────────────────────

test('[Raster] bresenhamLine draws orthogonal and diagonal lines correctly', () => {
  const hLine = bresenhamLine(0, 0, 4, 0);
  assert.equal(hLine.length, 5);
  assert.deepEqual(hLine[0], [0, 0]);
  assert.deepEqual(hLine[4], [4, 0]);

  const diagLine = bresenhamLine(0, 0, 3, 3);
  assert.equal(diagLine.length, 4);
  assert.deepEqual(diagLine, [[0, 0], [1, 1], [2, 2], [3, 3]]);
});

test('[Raster] DDA line generates correct number of points and endpoints', () => {
  const line = ddaLine(0, 0, 5, 5);
  assert.equal(line.length, 6);
  assert.deepEqual(line[0], [0, 0]);
  assert.deepEqual(line[5], [5, 5]);
});

// ─── MVP Pipeline ───────────────────────────────────────────────────────────

test('[MVP] MVP matrix transforms origin to NDC with positive W for in-frustum point', () => {
  const model = mat4Identity();
  const view = mat4LookAt(0, 2, 5, 0, 0, 0, 0, 1, 0);
  const proj = mat4Perspective(Math.PI / 4, 1.0, 0.1, 100.0);
  const mv = mat4Multiply(view, model);
  const mvp = mat4Multiply(proj, mv);

  const clipPos = transformVertexMVP(mvp, [0, 0, 0]);
  assert.ok(clipPos[3] > 0, 'w_c should be > 0 for point in front of camera');
});

test('[MVP] mat4Invert correctly inverts identity matrix', () => {
  const ident = mat4Identity();
  const inv = mat4Invert(ident);
  assert.ok(inv !== null);
  assert.equal(inv![0],  1);
  assert.equal(inv![5],  1);
  assert.equal(inv![10], 1);
  assert.equal(inv![15], 1);
});

test('[MVP] screenToFloorRay unprojects center screen to near-origin on floor plane', () => {
  const view = mat4LookAt(0, 10, 0, 0, 0, 0, 0, 0, -1);
  const proj = mat4Perspective((45 * Math.PI) / 180, 1.0, 0.1, 100.0);

  const floorPt = screenToFloorRay(400, 400, 800, 800, view, proj);
  assert.ok(floorPt !== null);
  assert.ok(Math.abs(floorPt!.x) < 1e-4, `Expected x near 0, got ${floorPt!.x}`);
  assert.ok(Math.abs(floorPt!.z) < 1e-4, `Expected z near 0, got ${floorPt!.z}`);
});

test('[MVP] snapToFloorGeometry snaps within threshold and ignores points outside', () => {
  const candidates = [{ x: 0.0, z: 0.0 }, { x: 5.0, z: 5.0 }];

  const res1 = snapToFloorGeometry({ x: 0.1, z: 0.1 }, candidates, 0.4);
  assert.equal(res1.snapped, true);
  assert.equal(res1.point.x, 0.0);
  assert.equal(res1.point.z, 0.0);

  const res2 = snapToFloorGeometry({ x: 2.0, z: 2.0 }, candidates, 0.4);
  assert.equal(res2.snapped, false);
  assert.equal(res2.point.x, 2.0);
  assert.equal(res2.point.z, 2.0);
});

// ─── Triangulation ──────────────────────────────────────────────────────────

test('[Tri] triangulatePolygon2D correctly triangulates concave L-shaped polygon without slicing void', () => {
  const lShapeCorners = [
    { x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 2 },
    { x: 2, z: 2 }, { x: 2, z: 4 }, { x: 0, z: 4 },
  ];

  const indices = triangulatePolygon2D(lShapeCorners);
  assert.equal(indices.length, 12); // (6-2) = 4 triangles

  for (let i = 0; i < indices.length; i += 3) {
    const tri = [indices[i], indices[i + 1], indices[i + 2]].sort();
    assert.ok(!(tri[0] === 0 && tri[1] === 2 && tri[2] === 4),
      'Should not produce diagonal slicing across void');
  }
});


