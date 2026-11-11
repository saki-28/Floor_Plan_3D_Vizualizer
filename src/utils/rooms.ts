/**
 * Rooms from walls: every area the walls close off becomes a room, as the plan editors people
 * know do it (draw walls round a space and it gets a floor). The walls form a network on their
 * centerlines: they are split wherever another wall meets, crosses or runs along them, walls that
 * end in open space are trimmed away, and each enclosed face of what is left is a room. The 3D
 * viewer gives every room a floor, and the editor labels it with its name and area.
 */

import type { Point2D, Room2D, WallSegment2D } from '../types/floorplan';

/** Points closer than this (metres) are one junction; a wall end this close to another wall meets it. */
const TOL = 0.03;
/** Enclosures smaller than this (m²) are not rooms: a gap between two walls, a duct. */
const MIN_AREA = 0.5;

/** Ids of rooms made here start with this, so a plan can tell them from rooms someone drew or named. */
export const DETECTED_ROOM_PREFIX = 'auto-';

/** True when a plan's rooms come from its walls (or it has none yet), so they should follow every wall edit. */
export const usesDetectedRooms = (rooms: Room2D[]) => rooms.every((r) => r.id.startsWith(DETECTED_ROOM_PREFIX));

export function signedArea(poly: Point2D[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

export function pointInPolygon(p: Point2D, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** A point well inside the polygon for its label: the centroid, or for shapes like an L, the middle of the widest span across it. */
export function labelPoint(poly: Point2D[]): Point2D {
  const A = signedArea(poly);
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p.x * q.z - q.x * p.z;
    cx += (p.x + q.x) * f;
    cz += (p.z + q.z) * f;
  }
  const centroid = A ? { x: cx / (6 * A), z: cz / (6 * A) } : poly[0];
  if (pointInPolygon(centroid, poly)) return centroid;
  const zs = poly.map((p) => p.z);
  const z0 = Math.min(...zs);
  const z1 = Math.max(...zs);
  let best = centroid;
  let widest = -1;
  for (let k = 1; k < 20; k++) {
    const z = z0 + ((z1 - z0) * k) / 20;
    const xs: number[] = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.z > z !== b.z > z) xs.push(a.x + ((z - a.z) * (b.x - a.x)) / (b.z - a.z));
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1] - xs[i] > widest) {
        widest = xs[i + 1] - xs[i];
        best = { x: (xs[i] + xs[i + 1]) / 2, z };
      }
    }
  }
  return best;
}

const cross = (ax: number, az: number, bx: number, bz: number) => ax * bz - az * bx;

/** Where along each wall (0..1) other walls meet, cross or run along it, ends included. */
function splitPoints(walls: WallSegment2D[]): number[][] {
  const splits = walls.map(() => [0, 1]);
  for (let i = 0; i < walls.length; i++) {
    const a = walls[i];
    const rx = a.end.x - a.start.x;
    const rz = a.end.z - a.start.z;
    const la = Math.hypot(rx, rz);
    for (let j = i + 1; j < walls.length; j++) {
      const b = walls[j];
      const sx = b.end.x - b.start.x;
      const sz = b.end.z - b.start.z;
      const lb = Math.hypot(sx, sz);
      const qx = b.start.x - a.start.x;
      const qz = b.start.z - a.start.z;
      const denom = cross(rx, rz, sx, sz);
      if (Math.abs(denom) < 1e-9 * la * lb) {
        // Parallel: when they lie on one line, each one's ends inside the other split it.
        if (Math.abs(cross(rx, rz, qx, qz)) / la > TOL) continue;
        for (const p of [b.start, b.end]) {
          const t = ((p.x - a.start.x) * rx + (p.z - a.start.z) * rz) / (la * la);
          if (t > TOL / la && t < 1 - TOL / la) splits[i].push(t);
        }
        for (const p of [a.start, a.end]) {
          const u = ((p.x - b.start.x) * sx + (p.z - b.start.z) * sz) / (lb * lb);
          if (u > TOL / lb && u < 1 - TOL / lb) splits[j].push(u);
        }
        continue;
      }
      const t = cross(qx, qz, sx, sz) / denom;
      const u = cross(qx, qz, rx, rz) / denom;
      const ta = TOL / la;
      const tb = TOL / lb;
      if (t >= -ta && t <= 1 + ta && u >= -tb && u <= 1 + tb) {
        splits[i].push(Math.min(1, Math.max(0, t)));
        splits[j].push(Math.min(1, Math.max(0, u)));
      }
    }
  }
  return splits;
}

/** The closed faces of the wall network, as polygons on the walls' centerlines (counter-clockwise in x–z). */
export function enclosedAreas(walls: WallSegment2D[]): Point2D[][] {
  const live = walls.filter((w) => Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z) > TOL);
  const nodes: Point2D[] = [];
  const nodeAt = (p: Point2D) => {
    const found = nodes.findIndex((n) => Math.hypot(n.x - p.x, n.z - p.z) <= TOL);
    if (found >= 0) return found;
    nodes.push({ x: p.x, z: p.z });
    return nodes.length - 1;
  };
  const edges = new Set<string>();
  splitPoints(live).forEach((ts, i) => {
    const w = live[i];
    const ids = [...ts]
      .sort((m, n) => m - n)
      .map((t) => nodeAt({ x: w.start.x + (w.end.x - w.start.x) * t, z: w.start.z + (w.end.z - w.start.z) * t }));
    for (let k = 0; k + 1 < ids.length; k++) {
      if (ids[k] !== ids[k + 1]) edges.add(ids[k] < ids[k + 1] ? `${ids[k]}-${ids[k + 1]}` : `${ids[k + 1]}-${ids[k]}`);
    }
  });

  const adjacent = new Map<number, Set<number>>();
  for (const e of edges) {
    const [a, b] = e.split('-').map(Number);
    if (!adjacent.has(a)) adjacent.set(a, new Set());
    if (!adjacent.has(b)) adjacent.set(b, new Set());
    adjacent.get(a)!.add(b);
    adjacent.get(b)!.add(a);
  }
  // Walls that end in open space bound no room: trim them away, end by end.
  const loose = [...adjacent.keys()].filter((n) => adjacent.get(n)!.size < 2);
  while (loose.length) {
    const n = loose.pop()!;
    for (const m of adjacent.get(n) ?? []) {
      adjacent.get(m)!.delete(n);
      if (adjacent.get(m)!.size === 1) loose.push(m);
    }
    adjacent.delete(n);
  }

  // Neighbours of each junction by angle; walking each wall so the next turn is the sharpest
  // right turn traces every face counter-clockwise, and the outside of the plan clockwise.
  const angle = (a: number, b: number) => Math.atan2(nodes[b].z - nodes[a].z, nodes[b].x - nodes[a].x);
  const around = new Map<number, number[]>();
  for (const [n, set] of adjacent) around.set(n, [...set].sort((a, b) => angle(n, a) - angle(n, b)));
  const seen = new Set<string>();
  const faces: Point2D[][] = [];
  for (const [start, list] of around) {
    for (const first of list) {
      if (seen.has(`${start}>${first}`)) continue;
      const ring: number[] = [];
      let u = start;
      let v = first;
      while (!seen.has(`${u}>${v}`) && ring.length <= edges.size * 2) {
        seen.add(`${u}>${v}`);
        ring.push(u);
        const options = around.get(v)!;
        const back = options.indexOf(u);
        const next = options[(back - 1 + options.length) % options.length];
        u = v;
        v = next;
      }
      const poly = ring.map((n) => nodes[n]);
      if (signedArea(poly) >= MIN_AREA) faces.push(withoutStraightCorners(poly));
    }
  }
  return faces;
}

/** Drops corners where the outline runs straight on (left by splitting walls at junctions). */
function withoutStraightCorners(poly: Point2D[]): Point2D[] {
  const out = poly.filter((p, i) => {
    const a = poly[(i - 1 + poly.length) % poly.length];
    const b = poly[(i + 1) % poly.length];
    return Math.abs(cross(p.x - a.x, p.z - a.z, b.x - p.x, b.z - p.z)) > 1e-6;
  });
  return out.length >= 3 ? out : poly;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * The rooms the walls enclose. Areas are floor areas inside the walls (centerline area less half
 * a wall's thickness along the outline). A room keeps the name and id it had before an edit when
 * the new room covers the old one's label point, so names survive walls being moved.
 */
export function detectRooms(walls: WallSegment2D[], previous: Room2D[] = []): Room2D[] {
  const thickness = walls.length ? [...walls.map((w) => w.thickness)].sort((a, b) => a - b)[Math.floor(walls.length / 2)] : 0.2;
  const used = new Set<string>();
  const usedNames = new Set(previous.map((r) => r.name));
  let counter = 1;
  const freshName = () => {
    while (usedNames.has(`Room ${counter}`)) counter++;
    usedNames.add(`Room ${counter}`);
    return `Room ${counter}`;
  };
  return enclosedAreas(walls).map((corners) => {
    const match = previous.find((r) => !used.has(r.id) && r.corners.length >= 3 && pointInPolygon(labelPoint(r.corners), corners));
    let id = match?.id;
    if (!id) {
      let n = 1;
      while (used.has(`${DETECTED_ROOM_PREFIX}${n}`) || previous.some((r) => r.id === `${DETECTED_ROOM_PREFIX}${n}`)) n++;
      id = `${DETECTED_ROOM_PREFIX}${n}`;
    }
    used.add(id);
    const perimeter = corners.reduce((sum, p, i) => sum + Math.hypot(corners[(i + 1) % corners.length].x - p.x, corners[(i + 1) % corners.length].z - p.z), 0);
    return {
      id,
      name: match?.name ?? freshName(),
      color: match?.color ?? '#9aa4a9',
      type: match?.type ?? 'living',
      corners,
      areaSqM: Math.max(0, round1(signedArea(corners) - (perimeter * thickness) / 2)),
    };
  });
}
