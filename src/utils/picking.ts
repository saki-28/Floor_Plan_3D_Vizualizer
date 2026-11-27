/**
 * Pointing at the 3D model: the ray under a screen position, what it hits first (a wall, a door or
 * window, or the floor), and the corners a measurement can snap to. Measuring snaps on the screen,
 * to the corners that can actually be seen (the top and bottom of every wall corner and the sides
 * of every door and window), so a click on a wall's top corner lands on that corner instead of on
 * the floor far behind it.
 */

import type { Opening2D, Point2D, WallSegment2D } from '../types/floorplan';
import { cornerFills, mat4Invert, mat4Multiply, type Mat4 } from './geometryEngine';
import { openingSpan } from './openings';

export type Vec3 = [number, number, number];

/** A ray from the near plane (t = 0) to the far plane (t = 1) under one screen position. */
export interface Ray {
  origin: Vec3;
  dir: Vec3;
}

export function screenRay(screenX: number, screenY: number, width: number, height: number, viewMat: Mat4, projMat: Mat4): Ray | null {
  if (width <= 0 || height <= 0) return null;
  const inv = mat4Invert(mat4Multiply(projMat, viewMat));
  if (!inv) return null;
  const ndcX = (2 * screenX) / width - 1;
  const ndcY = 1 - (2 * screenY) / height;
  const unproject = (ndcZ: number): Vec3 | null => {
    const x = inv[0] * ndcX + inv[4] * ndcY + inv[8] * ndcZ + inv[12];
    const y = inv[1] * ndcX + inv[5] * ndcY + inv[9] * ndcZ + inv[13];
    const z = inv[2] * ndcX + inv[6] * ndcY + inv[10] * ndcZ + inv[14];
    const w = inv[3] * ndcX + inv[7] * ndcY + inv[11] * ndcZ + inv[15];
    return Math.abs(w) < 1e-12 ? null : [x / w, y / w, z / w];
  };
  const near = unproject(-1);
  const far = unproject(1);
  if (!near || !far) return null;
  return { origin: near, dir: [far[0] - near[0], far[1] - near[1], far[2] - near[2]] };
}

const at = (ray: Ray, t: number): Vec3 => [ray.origin[0] + ray.dir[0] * t, ray.origin[1] + ray.dir[1] * t, ray.origin[2] + ray.dir[2] * t];

/** A wall's own axes: `s` runs along it from its start, `d` across it, with half its thickness either side. */
function frameOf(wall: WallSegment2D) {
  const dx = wall.end.x - wall.start.x;
  const dz = wall.end.z - wall.start.z;
  const length = Math.hypot(dx, dz);
  const ux = length > 1e-9 ? dx / length : 1;
  const uz = length > 1e-9 ? dz / length : 0;
  return { length, ux, uz, nx: -uz, nz: ux, half: (wall.thickness || 0.2) / 2 };
}

export type SceneHit =
  | { kind: 'wall'; id: string; t: number; point: Vec3 }
  | { kind: 'opening'; id: string; wallId: string; t: number; point: Vec3 }
  | { kind: 'floor'; t: number; point: Vec3 };

/**
 * What a ray meets first. A wall is its box; where the ray enters that box through the hole of a
 * door or window, the hit is that opening. `walls` carry the height and thickness they are drawn with.
 */
export function pickScene(ray: Ray, walls: WallSegment2D[], openings: Opening2D[]): SceneHit | null {
  let best: SceneHit | null = null;
  const take = (hit: SceneHit) => {
    if (hit.t >= 0 && (!best || hit.t < best.t)) best = hit;
  };

  if (ray.dir[1] < -1e-9) {
    const t = -ray.origin[1] / ray.dir[1];
    take({ kind: 'floor', t, point: at(ray, t) });
  }

  for (const wall of walls) {
    const f = frameOf(wall);
    const height = wall.height || 2.8;
    if (f.length < 1e-6) continue;
    // The ray in the wall's own axes.
    const ox = ray.origin[0] - wall.start.x;
    const oz = ray.origin[2] - wall.start.z;
    const o = [ox * f.ux + oz * f.uz, ray.origin[1], ox * f.nx + oz * f.nz];
    const d = [ray.dir[0] * f.ux + ray.dir[2] * f.uz, ray.dir[1], ray.dir[0] * f.nx + ray.dir[2] * f.nz];
    const lo = [0, 0, -f.half];
    const hi = [f.length, height, f.half];
    let tIn = -Infinity;
    let tOut = Infinity;
    let axisIn = -1;
    let missed = false;
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(d[axis]) < 1e-12) {
        if (o[axis] < lo[axis] || o[axis] > hi[axis]) missed = true;
        continue;
      }
      const a = (lo[axis] - o[axis]) / d[axis];
      const b = (hi[axis] - o[axis]) / d[axis];
      const near = Math.min(a, b);
      if (near > tIn) {
        tIn = near;
        axisIn = axis;
      }
      tOut = Math.min(tOut, Math.max(a, b));
    }
    if (missed || tIn > tOut || tOut < 0) continue;
    const t = Math.max(tIn, 0);
    const s = o[0] + d[0] * t;
    const y = o[1] + d[1] * t;
    // Entering through a side face, inside a door or window's hole: that opening.
    const through =
      axisIn === 2
        ? openings.find((opening) => {
            if (opening.wallId !== wall.id) return false;
            const { from, to } = openingSpan(opening, f.length);
            const sill = Math.min(opening.sill, height);
            const head = Math.min(sill + opening.height, height);
            return s > from && s < to && y > sill && y < head;
          })
        : undefined;
    take(through ? { kind: 'opening', id: through.id, wallId: wall.id, t, point: at(ray, t) } : { kind: 'wall', id: wall.id, t, point: at(ray, t) });
  }
  return best;
}

/** The four corners of a wall's footprint on the floor. */
export function wallFootprint(wall: WallSegment2D): Point2D[] {
  const f = frameOf(wall);
  const corner = (s: number, d: number): Point2D => ({ x: wall.start.x + f.ux * s + f.nx * d, z: wall.start.z + f.uz * s + f.nz * d });
  return [corner(0, f.half), corner(0, -f.half), corner(f.length, -f.half), corner(f.length, f.half)];
}

/**
 * The plan positions a measurement snaps to: the corners of the walls as they are built (a corner
 * buried inside another wall is left out; where two walls meet, the inside and outside corners
 * their faces make are added) and both sides of every door and window, on both faces of its wall.
 */
export function measureCorners(walls: WallSegment2D[], openings: Opening2D[]): Point2D[] {
  const EPS = 1e-3;
  const frames = walls.map((wall) => ({ wall, f: frameOf(wall) })).filter(({ f }) => f.length > 1e-6);
  const local = (entry: (typeof frames)[number], p: Point2D) => {
    const dx = p.x - entry.wall.start.x;
    const dz = p.z - entry.wall.start.z;
    return { s: dx * entry.f.ux + dz * entry.f.uz, d: dx * entry.f.nx + dz * entry.f.nz };
  };
  const buried = (p: Point2D, except: (typeof frames)[number][]) =>
    frames.some((entry) => {
      if (except.includes(entry)) return false;
      const { s, d } = local(entry, p);
      return s > EPS && s < entry.f.length - EPS && Math.abs(d) < entry.f.half - EPS;
    });
  /** On the wall's box or within a hair of it: a corner two faces make has to lie on both walls. */
  const touches = (entry: (typeof frames)[number], p: Point2D) => {
    const { s, d } = local(entry, p);
    return s > -EPS && s < entry.f.length + EPS && Math.abs(d) < entry.f.half + EPS;
  };

  const points: Point2D[] = [];
  const add = (p: Point2D) => {
    if (!points.some((q) => Math.abs(q.x - p.x) < EPS && Math.abs(q.z - p.z) < EPS)) points.push(p);
  };

  // A filled outside corner (see cornerFills) ends in the point where the outer faces meet; the two
  // end corners beside it then lie in the middle of a flat face and are corners no longer.
  const fills = cornerFills(walls).filter((fill) => fill.length === 4);
  const flat = fills.flatMap((fill) => [fill[1], fill[3]]);
  const isFlat = (p: Point2D) => flat.some((q) => Math.abs(q.x - p.x) < EPS && Math.abs(q.z - p.z) < EPS);
  for (const fill of fills) add(fill[2]);

  for (const entry of frames) {
    for (const corner of wallFootprint(entry.wall)) if (!buried(corner, [entry]) && !isFlat(corner)) add(corner);
  }

  // Where the faces of two walls cross (the inside corner of a room, the corner of a T-junction).
  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 1; j < frames.length; j++) {
      const a = frames[i];
      const b = frames[j];
      const cross = a.f.ux * b.f.uz - a.f.uz * b.f.ux;
      if (Math.abs(cross) < 1e-6) continue; // parallel faces never cross
      for (const da of [-a.f.half, a.f.half]) {
        for (const db of [-b.f.half, b.f.half]) {
          // A point on a's face line: a.start + n_a·da + u_a·s; solve for the s where it meets b's face line.
          const ax = a.wall.start.x + a.f.nx * da;
          const az = a.wall.start.z + a.f.nz * da;
          const bx = b.wall.start.x + b.f.nx * db;
          const bz = b.wall.start.z + b.f.nz * db;
          const s = ((bx - ax) * b.f.uz - (bz - az) * b.f.ux) / cross;
          const p = { x: ax + a.f.ux * s, z: az + a.f.uz * s };
          if (touches(a, p) && touches(b, p) && !buried(p, [a, b])) add(p);
        }
      }
    }
  }

  for (const opening of openings) {
    const entry = frames.find((e) => e.wall.id === opening.wallId);
    if (!entry) continue;
    const { from, to } = openingSpan(opening, entry.f.length);
    for (const s of [from, to]) {
      for (const d of [-entry.f.half, entry.f.half]) {
        add({ x: entry.wall.start.x + entry.f.ux * s + entry.f.nx * d, z: entry.wall.start.z + entry.f.uz * s + entry.f.nz * d });
      }
    }
  }
  return points;
}

export interface CornerSnap {
  point: Point2D;
  /** The height of the corner that was pointed at (the floor, or the top of the walls). */
  y: number;
  distancePx: number;
}

/**
 * The corner nearest the pointer on the screen, within `radiusPx`. Each corner is tried at every
 * height in `heights`; `visible` (when given) drops the ones hidden behind something.
 */
export function snapToCorner(
  cursor: [number, number],
  corners: Point2D[],
  heights: number[],
  project: (p: Vec3) => [number, number] | null,
  radiusPx = 14,
  visible?: (p: Vec3) => boolean,
): CornerSnap | null {
  const near: (CornerSnap & { world: Vec3 })[] = [];
  for (const corner of corners) {
    for (const y of heights) {
      const world: Vec3 = [corner.x, y, corner.z];
      const screen = project(world);
      if (!screen) continue;
      const distancePx = Math.hypot(screen[0] - cursor[0], screen[1] - cursor[1]);
      if (distancePx <= radiusPx) near.push({ point: corner, y, distancePx, world });
    }
  }
  near.sort((a, b) => a.distancePx - b.distancePx);
  const hit = (visible ? near.find((c) => visible(c.world)) : near[0]) ?? null;
  return hit && { point: hit.point, y: hit.y, distancePx: hit.distancePx };
}

/** Whether a point of the model can be seen along `ray` (the ray through its own place on the screen). */
export function isVisibleAlong(ray: Ray, point: Vec3, walls: WallSegment2D[], openings: Opening2D[], slack = 0.06): boolean {
  const hit = pickScene(ray, walls, openings);
  if (!hit) return true;
  const length = Math.hypot(ray.dir[0], ray.dir[1], ray.dir[2]);
  const toPoint = Math.hypot(point[0] - ray.origin[0], point[1] - ray.origin[1], point[2] - ray.origin[2]);
  return hit.t * length >= toPoint - slack;
}

/** Keeps `point` level with `from` along the plan's X or Z, whichever it is nearer to (Shift while measuring). */
export function straighten(from: Point2D, point: Point2D): Point2D {
  return Math.abs(point.x - from.x) >= Math.abs(point.z - from.z) ? { x: point.x, z: from.z } : { x: from.x, z: point.z };
}
