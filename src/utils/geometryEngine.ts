/**
 * Geometric and Transformation Mathematics Engine
 * Computer Graphics & Computer Vision Core Algorithms
 * Implements: Coordinate transforms, Wall extrusion, Mesh generation,
 * Matrix math (Model, View, Projection), and Rasterization (Bresenham & DDA).
 */

export interface Point2D {
  x: number;
  z: number;
}

export interface WallSegment2D {
  id: string;
  start: Point2D;
  end: Point2D;
  thickness: number;
  height: number;
  hasDoor?: boolean;
  doorPosition?: number; // 0.0 to 1.0 along segment
  doorWidth?: number;
  hasWindow?: boolean;
  windowPosition?: number;
  windowWidth?: number;
  windowSillHeight?: number;
  windowHeight?: number;
}

export interface Vertex3D {
  position: [number, number, number];
  normal: [number, number, number];
  texCoord: [number, number];
}

export interface Mesh3D {
  vertices: Vertex3D[];
  indices: number[];
}

export interface ImageToWorldConfig {
  scale: number; // world units per pixel
  u0: number;    // origin x in image coordinates (bounding-box centre)
  v0: number;    // origin y in image coordinates (bounding-box centre)
}

// ---------------------------------------------------------------------------
// B2 Core data-contract types (matches the C++ structs in the plan)
// ---------------------------------------------------------------------------

/** A detected or manually-placed wall segment in pixel space until mapped. */
export interface Segment2D {
  id: string;
  a: Point2D; // start (pixels before mapping, meters after)
  b: Point2D; // end
  thickness: number; // pixels before mapping, meters after
}

/** A door or window opening parameterised along a wall. */
export interface Opening {
  wallId: string;
  t0: number;   // 0..1 along the wall centerline, start
  t1: number;   // 0..1 along the wall centerline, end
  sill: number; // meters — 0 for doors
  head: number; // meters
}

/** Scale calibration result. */
export interface Scale {
  metersPerPixel: number;
  calibrated: boolean; // false → default heuristic, labelled "uncalibrated"
}

/**
 * Maps 2D image pixel coordinates (u, v) to 3D world floor coordinates (x, z).
 *
 * Coordinate conventions (B3, fix R3):
 *   World: right-handed, +Y up, plan lies in XZ plane.
 *   x =  s * (u − u0)   — image-right  = +X
 *   z = +s * (v − v0)   — image-down   = +Z  (NO mirroring)
 *
 * Acceptance test: an asymmetric (L-shaped) plan rendered top-down with
 *   eye=(cx, H, cz), up=(0, 0, −1) must match the source image without
 *   left/right reflection.
 */
export function imageToWorld(u: number, v: number, config: ImageToWorldConfig): Point2D {
  return {
    x:  config.scale * (u - config.u0),
    z: +config.scale * (v - config.v0),   // ← positive sign (R3 fix)
  };
}

/**
 * Maps 3D world floor coordinates (x, z) back to image pixel coordinates (u, v).
 * Inverse of imageToWorld with corrected sign.
 */
export function worldToImage(x: number, z: number, config: ImageToWorldConfig): [number, number] {
  const u =  x / config.scale + config.u0;
  const v =  z / config.scale + config.v0;  // ← positive sign (R3 fix)
  return [Math.round(u), Math.round(v)];
}

/**
 * Computes 2D vector Euclidean length.
 */
export function distance2D(p1: Point2D, p2: Point2D): number {
  const dx = p2.x - p1.x;
  const dz = p2.z - p1.z;
  return Math.hypot(dx, dz);
}

/**
 * Extrudes a single 2D wall segment into a 3D watertight box mesh with outward normals
 * and counter-clockwise (CCW) triangle winding for OpenGL back-face culling.
 */
export function extrudeWallSegment(wall: WallSegment2D): Mesh3D {
  const dx = wall.end.x - wall.start.x;
  const dz = wall.end.z - wall.start.z;
  const len = Math.hypot(dx, dz);

  if (len < 1e-6) {
    // Degenerate segment: zero-length protection
    return { vertices: [], indices: [] };
  }

  // Unit direction along the wall
  const ux = dx / len;
  const uz = dz / len;

  // Unit normal perpendicular to the wall in 2D (xz-plane)
  const nx = -uz;
  const nz = ux;

  const halfT = (wall.thickness || 0.2) / 2;
  const h = wall.height || 2.8;

  // 4 bottom vertices (y = 0)
  // A: start + normal * halfT
  // B: start - normal * halfT
  // C: end   - normal * halfT
  // D: end   + normal * halfT
  const Ax = wall.start.x + nx * halfT;
  const Az = wall.start.z + nz * halfT;

  const Bx = wall.start.x - nx * halfT;
  const Bz = wall.start.z - nz * halfT;

  const Cx = wall.end.x - nx * halfT;
  const Cz = wall.end.z - nz * halfT;

  const Dx = wall.end.x + nx * halfT;
  const Dz = wall.end.z + nz * halfT;

  const vertices: Vertex3D[] = [];
  const indices: number[] = [];

  function addQuad(
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    normal: [number, number, number]
  ) {
    const baseIdx = vertices.length;
    vertices.push(
      { position: p0, normal, texCoord: [0, 0] },
      { position: p1, normal, texCoord: [1, 0] },
      { position: p2, normal, texCoord: [1, 1] },
      { position: p3, normal, texCoord: [0, 1] }
    );
    // CCW winding as seen from OUTSIDE (outward normal).
    // Convention: cross(p1−p0, p2−p0) must be in the same direction as `normal`.
    // Triangles: (p0, p1, p2) and (p0, p2, p3).
    indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
    indices.push(baseIdx, baseIdx + 2, baseIdx + 3);
  }

  // Vertex layout (bottom, y=0):
  //   A = start + n*halfT  (front-start corner)
  //   B = start - n*halfT  (back-start corner)
  //   C = end   - n*halfT  (back-end corner)
  //   D = end   + n*halfT  (front-end corner)
  // Top vertices (y=h) are denoted At, Bt, Ct, Dt.
  //
  // For each face, vertices are ordered CCW as seen from outside.
  // Verification (front face, normal = +n = (0,0,1) for a +X wall):
  //   A(0,0,0.1) → D(4,0,0.1) → Dt(4,h,0.1) → At(0,h,0.1)
  //   e1 = D-A = (4,0,0), e2 = Dt-A = (4,h,0)
  //   cross = (0,0,4h) → dot with (0,0,1) = 4h > 0 ✓

  // 1. Front face (along +normal): A → D → Dt → At
  addQuad(
    [Ax, 0, Az],
    [Dx, 0, Dz],
    [Dx, h, Dz],
    [Ax, h, Az],
    [nx, 0, nz]
  );

  // 2. Back face (along -normal): C → B → Bt → Ct
  addQuad(
    [Cx, 0, Cz],
    [Bx, 0, Bz],
    [Bx, h, Bz],
    [Cx, h, Cz],
    [-nx, 0, -nz]
  );

  // 3. Start cap (along -tangent): B → A → At → Bt
  addQuad(
    [Bx, 0, Bz],
    [Ax, 0, Az],
    [Ax, h, Az],
    [Bx, h, Bz],
    [-ux, 0, -uz]
  );

  // 4. End cap (along +tangent): D → C → Ct → Dt
  addQuad(
    [Dx, 0, Dz],
    [Cx, 0, Cz],
    [Cx, h, Cz],
    [Dx, h, Dz],
    [ux, 0, uz]
  );

  // 5. Top face (along +Y): Bt → At → Dt → Ct  (CCW from above)
  addQuad(
    [Bx, h, Bz],
    [Ax, h, Az],
    [Dx, h, Dz],
    [Cx, h, Cz],
    [0, 1, 0]
  );

  // 6. Bottom face (along -Y): A → B → C → D  (CCW from below)
  addQuad(
    [Ax, 0, Az],
    [Bx, 0, Bz],
    [Cx, 0, Cz],
    [Dx, 0, Dz],
    [0, -1, 0]
  );

  return { vertices, indices };
}

/**
 * Combines multiple meshes into a single vertex and index buffer.
 */
export function combineMeshes(meshes: Mesh3D[]): Mesh3D {
  const combinedVertices: Vertex3D[] = [];
  const combinedIndices: number[] = [];

  for (const m of meshes) {
    const offset = combinedVertices.length;
    for (const v of m.vertices) {
      combinedVertices.push(v);
    }
    for (const idx of m.indices) {
      combinedIndices.push(idx + offset);
    }
  }

  return { vertices: combinedVertices, indices: combinedIndices };
}

/**
 * 2D cross product of vectors (B - A) x (C - A) in XZ plane.
 * Positive if counter-clockwise, negative if clockwise.
 */
function crossProduct2D(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

/**
 * Checks if point P is inside triangle ABC in XZ plane.
 */
function isPointInTriangle(p: Point2D, a: Point2D, b: Point2D, c: Point2D): boolean {
  const cp1 = crossProduct2D(a, b, p);
  const cp2 = crossProduct2D(b, c, p);
  const cp3 = crossProduct2D(c, a, p);

  const hasNeg = cp1 < -1e-6 || cp2 < -1e-6 || cp3 < -1e-6;
  const hasPos = cp1 > 1e-6 || cp2 > 1e-6 || cp3 > 1e-6;

  return !(hasNeg && hasPos);
}

/**
 * Robust Ear-Clipping Triangulation for simple 2D polygons.
 * Correctly handles non-convex (concave) and L-shaped rooms without
 * generating diagonal triangles that slice across exterior space or walls.
 */
export function triangulatePolygon2D(corners: Point2D[]): number[] {
  const n = corners.length;
  if (n < 3) return [];
  if (n === 3) return [0, 1, 2];

  // 1. Calculate signed polygon area to detect orientation
  let signedArea = 0;
  for (let i = 0; i < n; i++) {
    const p1 = corners[i];
    const p2 = corners[(i + 1) % n];
    signedArea += (p1.x * p2.z - p2.x * p1.z);
  }
  const isCCW = signedArea > 0;

  // Working list of remaining vertex indices
  const V: number[] = [];
  for (let i = 0; i < n; i++) V.push(i);

  const indices: number[] = [];
  let count = 2 * V.length * V.length; // Guard against infinite loop

  while (V.length > 2 && count > 0) {
    count--;
    let earFound = false;

    for (let i = 0; i < V.length; i++) {
      const prevIdx = V[(i - 1 + V.length) % V.length];
      const currIdx = V[i];
      const nextIdx = V[(i + 1) % V.length];

      const a = corners[prevIdx];
      const b = corners[currIdx];
      const c = corners[nextIdx];

      // Check if vertex b is convex
      const cross = crossProduct2D(a, b, c);
      const isConvex = isCCW ? cross > 1e-6 : cross < -1e-6;
      if (!isConvex) continue;

      // Check if any other vertex in the remaining polygon lies inside triangle (a, b, c)
      let containsOther = false;
      for (let j = 0; j < V.length; j++) {
        const testIdx = V[j];
        if (testIdx === prevIdx || testIdx === currIdx || testIdx === nextIdx) continue;
        if (isPointInTriangle(corners[testIdx], a, b, c)) {
          containsOther = true;
          break;
        }
      }

      if (!containsOther) {
        // Found an ear! Add triangle and remove current vertex
        indices.push(prevIdx, currIdx, nextIdx);
        V.splice(i, 1);
        earFound = true;
        break;
      }
    }

    if (!earFound) {
      break;
    }
  }

  // If ear clipping completed normally, return indices
  if (indices.length >= 3) {
    return indices;
  }

  // Fallback to convex fan if non-simple or collinear
  const fallback: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    fallback.push(0, i, i + 1);
  }
  return fallback;
}

/**
 * Generates horizontal floor polygon at y = 0 with ear-clipping triangulation.
 */
export function generateFloorMesh(corners: Point2D[]): Mesh3D {
  if (corners.length < 3) return { vertices: [], indices: [] };

  const vertices: Vertex3D[] = corners.map((c) => ({
    position: [c.x, 0.0, c.z],
    normal: [0, 1, 0],
    texCoord: [c.x * 0.5, c.z * 0.5],
  }));

  const indices = triangulatePolygon2D(corners);

  return { vertices, indices };
}

/**
 * Bresenham Line Drawing Algorithm for 2D floor-plan rasterization.
 * Demonstrates digital differential analysis and integer arithmetic.
 */
export function bresenhamLine(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const points: [number, number][] = [];
  let x = Math.round(x0);
  let y = Math.round(y0);
  const targetX = Math.round(x1);
  const targetY = Math.round(y1);

  const dx = Math.abs(targetX - x);
  const dy = Math.abs(targetY - y);
  const sx = x < targetX ? 1 : -1;
  const sy = y < targetY ? 1 : -1;
  let err = dx - dy;

  while (true) {
    points.push([x, y]);
    if (x === targetX && y === targetY) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }

  return points;
}

/**
 * DDA (Digital Differential Analyzer) Line Algorithm.
 * Uses floating point increments.
 */
export function ddaLine(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const points: [number, number][] = [];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));

  if (steps === 0) {
    points.push([Math.round(x0), Math.round(y0)]);
    return points;
  }

  const xInc = dx / steps;
  const yInc = dy / steps;

  let x = x0;
  let y = y0;

  for (let i = 0; i <= steps; i++) {
    points.push([Math.round(x), Math.round(y)]);
    x += xInc;
    y += yInc;
  }

  return points;
}

/**
 * 4x4 Matrix Mathematics (Column-Major order, matching OpenGL / GLSL).
 */
export type Mat4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number
];

export function mat4Identity(): Mat4 {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ];
}

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out: Mat4 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        // a is col-major: index = row + k * 4
        // b is col-major: index = k + col * 4
        sum += a[row + k * 4] * b[k + col * 4];
      }
      out[row + col * 4] = sum;
    }
  }
  return out;
}

export function mat4Perspective(fovyRad: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1.0 / Math.tan(fovyRad / 2.0);
  const nf = 1.0 / (near - far);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, (2 * far * near) * nf, 0
  ];
}

export function mat4Orthographic(left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4 {
  const lr = 1.0 / (left - right);
  const bt = 1.0 / (bottom - top);
  const nf = 1.0 / (near - far);
  return [
    -2 * lr, 0, 0, 0,
    0, -2 * bt, 0, 0,
    0, 0, 2 * nf, 0,
    (left + right) * lr, (top + bottom) * bt, (far + near) * nf, 1
  ];
}

export function mat4LookAt(
  eyeX: number, eyeY: number, eyeZ: number,
  centerX: number, centerY: number, centerZ: number,
  upX: number, upY: number, upZ: number
): Mat4 {
  let fx = centerX - eyeX;
  let fy = centerY - eyeY;
  let fz = centerZ - eyeZ;
  const lenF = Math.hypot(fx, fy, fz);
  fx /= lenF; fy /= lenF; fz /= lenF;

  // s = f x up
  let sx = fy * upZ - fz * upY;
  let sy = fz * upX - fx * upZ;
  let sz = fx * upY - fy * upX;
  const lenS = Math.hypot(sx, sy, sz);
  sx /= lenS; sy /= lenS; sz /= lenS;

  // u = s x f
  const ux = sy * fz - sz * fy;
  const uy = sz * fx - sx * fz;
  const uz = sx * fy - sy * fx;

  return [
    sx, ux, -fx, 0,
    sy, uy, -fy, 0,
    sz, uz, -fz, 0,
    -(sx * eyeX + sy * eyeY + sz * eyeZ),
    -(ux * eyeX + uy * eyeY + uz * eyeZ),
    fx * eyeX + fy * eyeY + fz * eyeZ,
    1
  ];
}

/**
 * Transforms a 3D vertex position [x, y, z, 1.0] by MVP matrix to clip-space [x_c, y_c, z_c, w_c].
 */
export function transformVertexMVP(mvp: Mat4, pos: [number, number, number]): [number, number, number, number] {
  const x = pos[0], y = pos[1], z = pos[2], w = 1.0;
  const cx = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12] * w;
  const cy = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13] * w;
  const cz = mvp[2] * x + mvp[6] * y + mvp[10] * z + mvp[14] * w;
  const cw = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15] * w;
  return [cx, cy, cz, cw];
}

/**
 * 4x4 Matrix Inversion (Column-major format).
 */
export function mat4Invert(m: Mat4): Mat4 | null {
  const [
    m00, m10, m20, m30,
    m01, m11, m21, m31,
    m02, m12, m22, m32,
    m03, m13, m23, m33,
  ] = m;

  const a0 = m00 * m11 - m10 * m01;
  const a1 = m00 * m21 - m20 * m01;
  const a2 = m00 * m31 - m30 * m01;
  const a3 = m10 * m21 - m20 * m11;
  const a4 = m10 * m31 - m30 * m11;
  const a5 = m20 * m31 - m30 * m21;
  const b0 = m02 * m13 - m12 * m03;
  const b1 = m02 * m23 - m22 * m03;
  const b2 = m02 * m33 - m32 * m03;
  const b3 = m12 * m23 - m22 * m13;
  const b4 = m12 * m33 - m32 * m13;
  const b5 = m22 * m33 - m32 * m23;

  const det = a0 * b5 - a1 * b4 + a2 * b3 + a3 * b2 - a4 * b1 + a5 * b0;
  if (Math.abs(det) < 1e-12) return null;

  const invDet = 1.0 / det;

  return [
    (m11 * b5 - m21 * b4 + m31 * b3) * invDet,
    (-m10 * b5 + m20 * b4 - m30 * b3) * invDet,
    (m13 * a5 - m23 * a4 + m33 * a3) * invDet,
    (-m12 * a5 + m22 * a4 - m32 * a3) * invDet,

    (-m01 * b5 + m21 * b2 - m31 * b1) * invDet,
    (m00 * b5 - m20 * b2 + m30 * b1) * invDet,
    (-m03 * a5 + m23 * a2 - m33 * a1) * invDet,
    (m02 * a5 - m22 * a2 + m32 * a1) * invDet,

    (m01 * b4 - m11 * b2 + m31 * b0) * invDet,
    (-m00 * b4 + m10 * b2 - m30 * b0) * invDet,
    (m03 * a4 - m13 * a2 + m33 * a0) * invDet,
    (-m02 * a4 + m12 * a2 - m32 * a0) * invDet,

    (-m01 * b3 + m11 * b1 - m21 * b0) * invDet,
    (m00 * b3 - m10 * b1 + m20 * b0) * invDet,
    (-m03 * a3 + m13 * a1 - m23 * a0) * invDet,
    (m02 * a3 - m12 * a1 + m22 * a0) * invDet,
  ];
}

/**
 * Unprojects a screen position (clientX, clientY) on the canvas to the floor plane (y = 0) in world space.
 */
export function screenToFloorRay(
  screenX: number,
  screenY: number,
  screenWidth: number,
  screenHeight: number,
  viewMat: Mat4,
  projMat: Mat4
): Point2D | null {
  if (screenWidth <= 0 || screenHeight <= 0) return null;

  // View-Projection Matrix
  const vp = mat4Multiply(projMat, viewMat);
  const invVP = mat4Invert(vp);
  if (!invVP) return null;

  // Normalized Device Coordinates (-1 to 1)
  const ndcX = (2.0 * screenX) / screenWidth - 1.0;
  const ndcY = 1.0 - (2.0 * screenY) / screenHeight;

  // Near plane point (z = -1) and Far plane point (z = 1) in clip space
  const unprojectPoint = (zNdc: number): [number, number, number] | null => {
    const x = invVP[0] * ndcX + invVP[4] * ndcY + invVP[8] * zNdc + invVP[12];
    const y = invVP[1] * ndcX + invVP[5] * ndcY + invVP[9] * zNdc + invVP[13];
    const z = invVP[2] * ndcX + invVP[6] * ndcY + invVP[10] * zNdc + invVP[14];
    const w = invVP[3] * ndcX + invVP[7] * ndcY + invVP[11] * zNdc + invVP[15];
    if (Math.abs(w) < 1e-12) return null;
    return [x / w, y / w, z / w];
  };

  const pNear = unprojectPoint(-1.0);
  const pFar = unprojectPoint(1.0);
  if (!pNear || !pFar) return null;

  const rayOrigin = pNear;
  const rayDir = [pFar[0] - pNear[0], pFar[1] - pNear[1], pFar[2] - pNear[2]];

  // Ray-plane intersection with y = 0
  if (Math.abs(rayDir[1]) < 1e-6) return null;

  const t = -rayOrigin[1] / rayDir[1];
  if (t < 0) {
    // Intersection is behind ray origin
    return null;
  }

  return {
    x: rayOrigin[0] + t * rayDir[0],
    z: rayOrigin[2] + t * rayDir[2],
  };
}

/**
 * Projects a 3D world coordinate to 2D screen pixels.
 */
export function worldToScreen(
  pos: [number, number, number],
  viewMat: Mat4,
  projMat: Mat4,
  screenWidth: number,
  screenHeight: number
): [number, number] | null {
  const vp = mat4Multiply(projMat, viewMat);
  const clip = transformVertexMVP(vp, pos);
  const w = clip[3];
  if (w <= 0.01) return null; // Behind camera

  const ndcX = clip[0] / w;
  const ndcY = clip[1] / w;

  const screenX = ((ndcX + 1.0) / 2.0) * screenWidth;
  const screenY = ((1.0 - ndcY) / 2.0) * screenHeight;
  return [screenX, screenY];
}

/**
 * Snaps a 2D floor point to the nearest candidate corner or wall endpoint if within snapRadius meters.
 */
export function snapToFloorGeometry(
  point: Point2D,
  candidates: Point2D[],
  snapRadius: number = 0.4
): { point: Point2D; snapped: boolean } {
  let closest = point;
  let minDist = snapRadius;
  let didSnap = false;

  for (const c of candidates) {
    const d = distance2D(point, c);
    if (d < minDist) {
      minDist = d;
      closest = c;
      didSnap = true;
    }
  }

  return { point: closest, snapped: didSnap };
}

// ---------------------------------------------------------------------------
// B8.7 Mesh Validators  (Tier-1 deliverables)
// ---------------------------------------------------------------------------

export interface WindingResult {
  totalTriangles: number;
  passingTriangles: number;
  passRate: number; // 0..1
  failedIndices: number[]; // indices of failing triangles (i/3)
}

/**
 * Winding validator: for every triangle, checks that
 *   dot(cross(v1−v0, v2−v0), faceNormal) > 0
 * meaning the stored face normal agrees with the CCW winding order.
 */
export function validateWinding(mesh: Mesh3D): WindingResult {
  const { vertices, indices } = mesh;
  let passing = 0;
  const failed: number[] = [];

  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
    const v0 = vertices[i0].position;
    const v1 = vertices[i1].position;
    const v2 = vertices[i2].position;
    const n  = vertices[i0].normal;

    // Edge vectors
    const e1x = v1[0] - v0[0], e1y = v1[1] - v0[1], e1z = v1[2] - v0[2];
    const e2x = v2[0] - v0[0], e2y = v2[1] - v0[1], e2z = v2[2] - v0[2];

    // Cross product e1 × e2
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;

    // Dot with face normal
    const dot = cx * n[0] + cy * n[1] + cz * n[2];

    if (dot > 0) {
      passing++;
    } else {
      failed.push(t / 3);
    }
  }

  const total = Math.floor(indices.length / 3);
  return { totalTriangles: total, passingTriangles: passing, passRate: total > 0 ? passing / total : 1, failedIndices: failed };
}

export interface NormalResult {
  totalFaces: number;
  outwardFaces: number;
  outwardRate: number; // 0..1
}

/**
 * Outward-normal validator: for each quad face (4 vertices, same normal),
 * checks that the normal points away from the box centroid.
 * Reports the percentage of face groups whose normals point outward.
 */
export function validateOutwardNormals(mesh: Mesh3D): NormalResult {
  const { vertices } = mesh;
  if (vertices.length === 0) return { totalFaces: 0, outwardFaces: 0, outwardRate: 1 };

  // Compute mesh centroid
  let cx = 0, cy = 0, cz = 0;
  for (const v of vertices) {
    cx += v.position[0];
    cy += v.position[1];
    cz += v.position[2];
  }
  cx /= vertices.length; cy /= vertices.length; cz /= vertices.length;

  // Group vertices into faces of 4 (each addQuad generates 4 verts)
  const faceCount = Math.floor(vertices.length / 4);
  let outward = 0;

  for (let f = 0; f < faceCount; f++) {
    const base = f * 4;
    const n = vertices[base].normal;
    // Face centroid
    const fcx = (vertices[base].position[0] + vertices[base+1].position[0] + vertices[base+2].position[0] + vertices[base+3].position[0]) / 4;
    const fcy = (vertices[base].position[1] + vertices[base+1].position[1] + vertices[base+2].position[1] + vertices[base+3].position[1]) / 4;
    const fcz = (vertices[base].position[2] + vertices[base+1].position[2] + vertices[base+2].position[2] + vertices[base+3].position[2]) / 4;

    // Vector from mesh centroid to face centroid
    const dx = fcx - cx, dy = fcy - cy, dz = fcz - cz;
    const dot = n[0] * dx + n[1] * dy + n[2] * dz;
    if (dot >= 0) outward++;
  }

  return { totalFaces: faceCount, outwardFaces: outward, outwardRate: faceCount > 0 ? outward / faceCount : 1 };
}

export interface ManifoldResult {
  isManifold: boolean;
  edgeCount: number;
  nonManifoldEdges: number; // edges with count !== 2
  openEdges: number;        // edges with count === 1
}

/** Canonical edge key: always smaller index first. */
function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Edge-manifold validator: welds vertices by position, counts triangle uses
 * per edge. A closed 2-manifold has every edge used exactly twice.
 * Open edges (count=1) indicate holes; count>2 means non-manifold.
 */
export function validateEdgeManifold(mesh: Mesh3D): ManifoldResult {
  const { vertices, indices } = mesh;
  const EPS = 1e-6;

  // Weld vertices by position → representative index map
  const weldMap: number[] = new Array(vertices.length);
  const representatives: number[] = [];

  for (let i = 0; i < vertices.length; i++) {
    let found = -1;
    const p = vertices[i].position;
    for (const r of representatives) {
      const q = vertices[r].position;
      if (Math.abs(p[0]-q[0]) < EPS && Math.abs(p[1]-q[1]) < EPS && Math.abs(p[2]-q[2]) < EPS) {
        found = r;
        break;
      }
    }
    if (found === -1) { representatives.push(i); weldMap[i] = i; }
    else { weldMap[i] = found; }
  }

  // Count edge usages
  const edgeCounts = new Map<string, number>();
  for (let t = 0; t < indices.length; t += 3) {
    const a = weldMap[indices[t]], b = weldMap[indices[t+1]], c = weldMap[indices[t+2]];
    for (const k of [edgeKey(a,b), edgeKey(b,c), edgeKey(a,c)]) {
      edgeCounts.set(k, (edgeCounts.get(k) ?? 0) + 1);
    }
  }

  let open = 0, nonManifold = 0;
  for (const cnt of edgeCounts.values()) {
    if (cnt === 1) open++;
    else if (cnt !== 2) nonManifold++;
  }

  return {
    isManifold: open === 0 && nonManifold === 0,
    edgeCount: edgeCounts.size,
    nonManifoldEdges: nonManifold,
    openEdges: open,
  };
}

export interface DimensionResult {
  expectedMeters: number;
  measuredMeters: number;
  errorMeters: number;
  withinTolerance: boolean;
}

/**
 * Dimension validator: measures the length of a wall mesh along its longest
 * axis and compares against the expected meter value.
 * Tolerance defaults to 1 mm.
 */
export function validateDimension(
  mesh: Mesh3D,
  expectedMeters: number,
  toleranceMeters = 0.001
): DimensionResult {
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const v of mesh.vertices) {
    minX = Math.min(minX, v.position[0]); maxX = Math.max(maxX, v.position[0]);
    minZ = Math.min(minZ, v.position[2]); maxZ = Math.max(maxZ, v.position[2]);
  }
  const spanX = maxX - minX;
  const spanZ = maxZ - minZ;
  const measured = Math.max(spanX, spanZ);
  const error = Math.abs(measured - expectedMeters);
  return { expectedMeters, measuredMeters: measured, errorMeters: error, withinTolerance: error <= toleranceMeters };
}

// ---------------------------------------------------------------------------
// OBJ Export (B8.7)
// ---------------------------------------------------------------------------

/**
 * Exports a Mesh3D to a Wavefront OBJ string.
 * Includes vertex positions, normals, texture coordinates, and indexed faces.
 * The result can be saved as a .obj file and opened in MeshLab or Blender.
 */
export function exportToOBJ(mesh: Mesh3D, objectName = 'FloorPlan3D'): string {
  const lines: string[] = [];
  lines.push(`# FloorPlan3D OBJ Export`);
  lines.push(`# Vertices: ${mesh.vertices.length}  Triangles: ${Math.floor(mesh.indices.length / 3)}`);
  lines.push(`o ${objectName}`);
  lines.push('');

  // Vertex positions
  for (const v of mesh.vertices) {
    lines.push(`v ${v.position[0].toFixed(6)} ${v.position[1].toFixed(6)} ${v.position[2].toFixed(6)}`);
  }
  lines.push('');

  // Vertex normals
  for (const v of mesh.vertices) {
    lines.push(`vn ${v.normal[0].toFixed(6)} ${v.normal[1].toFixed(6)} ${v.normal[2].toFixed(6)}`);
  }
  lines.push('');

  // Texture coordinates
  for (const v of mesh.vertices) {
    lines.push(`vt ${v.texCoord[0].toFixed(6)} ${v.texCoord[1].toFixed(6)}`);
  }
  lines.push('');

  // Faces (1-indexed in OBJ, format: v/vt/vn)
  lines.push('usemtl default');
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const i0 = mesh.indices[i] + 1;
    const i1 = mesh.indices[i + 1] + 1;
    const i2 = mesh.indices[i + 2] + 1;
    lines.push(`f ${i0}/${i0}/${i0} ${i1}/${i1}/${i1} ${i2}/${i2}/${i2}`);
  }

  return lines.join('\n');
}

/**
 * Triggers a browser download of an OBJ file.
 */
export function downloadOBJ(mesh: Mesh3D, filename = 'floorplan3d.obj'): void {
  const content = exportToOBJ(mesh);
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
