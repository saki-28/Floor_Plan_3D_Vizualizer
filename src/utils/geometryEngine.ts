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
  u0: number;    // origin x in image coordinates
  v0: number;    // origin y in image coordinates
}

/**
 * Maps 2D image pixel coordinates (u, v) to 3D world floor coordinates (x, z).
 * Formula:
 *   x = s * (u - u0)
 *   z = -s * (v - v0)
 * Note: Negative z accounts for standard OpenGL coordinate conventions where
 * looking into the screen is along -Z.
 */
export function imageToWorld(u: number, v: number, config: ImageToWorldConfig): Point2D {
  return {
    x: config.scale * (u - config.u0),
    z: -config.scale * (v - config.v0),
  };
}

/**
 * Maps 3D world floor coordinates (x, z) back to image pixel coordinates (u, v).
 */
export function worldToImage(x: number, z: number, config: ImageToWorldConfig): [number, number] {
  const u = x / config.scale + config.u0;
  const v = -z / config.scale + config.v0;
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
    // CCW winding: (0, 1, 2) and (0, 2, 3)
    indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
    indices.push(baseIdx, baseIdx + 2, baseIdx + 3);
  }

  // 1. Front face (along +normal): D -> A -> At -> Dt
  addQuad(
    [Dx, 0, Dz],
    [Ax, 0, Az],
    [Ax, h, Az],
    [Dx, h, Dz],
    [nx, 0, nz]
  );

  // 2. Back face (along -normal): B -> C -> Ct -> Bt
  addQuad(
    [Bx, 0, Bz],
    [Cx, 0, Cz],
    [Cx, h, Cz],
    [Bx, h, Bz],
    [-nx, 0, -nz]
  );

  // 3. Start cap (along -tangent): A -> B -> Bt -> At
  addQuad(
    [Ax, 0, Az],
    [Bx, 0, Bz],
    [Bx, h, Bz],
    [Ax, h, Az],
    [-ux, 0, -uz]
  );

  // 4. End cap (along +tangent): C -> D -> Dt -> Ct
  addQuad(
    [Cx, 0, Cz],
    [Dx, 0, Dz],
    [Dx, h, Dz],
    [Cx, h, Cz],
    [ux, 0, uz]
  );

  // 5. Top face (along +Y): At -> Bt -> Ct -> Dt
  addQuad(
    [Ax, h, Az],
    [Bx, h, Bz],
    [Cx, h, Cz],
    [Dx, h, Dz],
    [0, 1, 0]
  );

  // 6. Bottom face (along -Y): D -> C -> B -> A
  addQuad(
    [Dx, 0, Dz],
    [Cx, 0, Cz],
    [Bx, 0, Bz],
    [Ax, 0, Az],
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

