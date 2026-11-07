/**
 * Plan editing for the Edit plan screen, as pure functions on walls and openings (metres; x to
 * the right, z down, as in the top view). Walls that meet stay joined: moving a wall end moves
 * every wall end at the same point, and moving a whole wall also drags the ends of walls that
 * meet it, at a corner or part-way along it (a T junction).
 */

import type { Opening2D, OpeningKind, Point2D, WallSegment2D } from '../types/floorplan';
import { distance2D } from './geometryEngine';
import { makeOpening } from './openings';

/** Wall ends closer than this (metres) are one junction. */
export const JOIN_TOLERANCE = 0.02;

export type WallEnd = 'start' | 'end';

export const wallLength = (w: WallSegment2D) => distance2D(w.start, w.end);

export function closestOnSegment(a: Point2D, b: Point2D, p: Point2D): { point: Point2D; t: number; distance: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 < 1e-12 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
  const point = { x: a.x + dx * t, z: a.z + dz * t };
  return { point, t, distance: distance2D(point, p) };
}

/** The wall nearest p, if within maxDistance of its centerline. */
export function nearestWall(walls: WallSegment2D[], p: Point2D, maxDistance: number): { wall: WallSegment2D; t: number; distance: number } | null {
  let best: { wall: WallSegment2D; t: number; distance: number } | null = null;
  for (const wall of walls) {
    const hit = closestOnSegment(wall.start, wall.end, p);
    if (hit.distance <= maxDistance && (!best || hit.distance < best.distance)) best = { wall, t: hit.t, distance: hit.distance };
  }
  return best;
}

export interface SnapOptions {
  /** Grid spacing in metres; 0 for no grid. */
  grid: number;
  /** Points to snap to, such as wall ends. */
  ends: Point2D[];
  /** Wall centerlines to snap onto (for T junctions). */
  lines?: [Point2D, Point2D][];
  /** How close (metres) a point or line must be to catch the pointer. */
  radius: number;
  /** With ortho, the result keeps a straight line from this point. */
  anchor?: Point2D | null;
  ortho?: boolean;
}

export type SnapKind = 'end' | 'line' | 'grid' | 'free';

/** Where a pointer at p lands: on a nearby wall end, else on a nearby wall, else on the grid; Shift keeps it straight. */
export function snapPoint(p: Point2D, opts: SnapOptions): { point: Point2D; kind: SnapKind } {
  let nearest: Point2D | null = null;
  let nearestDistance = opts.radius;
  for (const e of opts.ends) {
    const d = distance2D(e, p);
    if (d <= nearestDistance) {
      nearest = e;
      nearestDistance = d;
    }
  }
  const anchor = opts.ortho ? opts.anchor ?? null : null;
  // With Shift, the point stays level with or straight above the anchor, whichever is closer.
  const horizontal = anchor ? Math.abs(p.x - anchor.x) >= Math.abs(p.z - anchor.z) : false;
  const onLine = (q: Point2D) => !anchor || Math.abs(horizontal ? q.z - anchor.z : q.x - anchor.x) < 1e-9;

  if (nearest && onLine(nearest)) return { point: { ...nearest }, kind: 'end' };
  if (!anchor) {
    for (const [a, b] of opts.lines ?? []) {
      const hit = closestOnSegment(a, b, p);
      if (hit.distance <= opts.radius) return { point: { x: clean(hit.point.x), z: clean(hit.point.z) }, kind: 'line' };
    }
  }
  const round = (v: number) => clean(opts.grid > 0 ? Math.round(v / opts.grid) * opts.grid : v);
  const point = !anchor ? { x: round(p.x), z: round(p.z) } : horizontal ? { x: round(p.x), z: anchor.z } : { x: anchor.x, z: round(p.z) };
  return { point, kind: opts.grid > 0 ? 'grid' : 'free' };
}

/** Rounds away floating-point dust (0.30000000000000004 → 0.3). */
const clean = (v: number) => Math.round(v * 1e6) / 1e6;

/** Every wall end at the same point as this wall's end. */
export function endsAt(walls: WallSegment2D[], p: Point2D): { wallId: string; end: WallEnd }[] {
  const found: { wallId: string; end: WallEnd }[] = [];
  for (const w of walls) {
    if (distance2D(w.start, p) <= JOIN_TOLERANCE) found.push({ wallId: w.id, end: 'start' });
    if (distance2D(w.end, p) <= JOIN_TOLERANCE) found.push({ wallId: w.id, end: 'end' });
  }
  return found;
}

function withEnds(walls: WallSegment2D[], moves: Map<string, Partial<Record<WallEnd, Point2D>>>): WallSegment2D[] {
  return walls.map((w) => {
    const m = moves.get(w.id);
    return m ? { ...w, start: m.start ?? w.start, end: m.end ?? w.end } : w;
  });
}

/** Moves a wall end, and every other wall end joined to it, to `to`. */
export function moveWallEnd(walls: WallSegment2D[], wallId: string, end: WallEnd, to: Point2D): WallSegment2D[] {
  const wall = walls.find((w) => w.id === wallId);
  if (!wall) return walls;
  const moves = new Map<string, Partial<Record<WallEnd, Point2D>>>();
  for (const j of endsAt(walls, wall[end])) moves.set(j.wallId, { ...moves.get(j.wallId), [j.end]: { ...to } });
  moves.set(wallId, { ...moves.get(wallId), [end]: { ...to } });
  return withEnds(walls, moves);
}

/** Moves a whole wall by `delta`, dragging the ends of walls joined to it at its ends or along it. */
export function moveWall(walls: WallSegment2D[], wallId: string, delta: Point2D): WallSegment2D[] {
  const wall = walls.find((w) => w.id === wallId);
  if (!wall) return walls;
  const shift = (p: Point2D): Point2D => ({ x: clean(p.x + delta.x), z: clean(p.z + delta.z) });
  const moves = new Map<string, Partial<Record<WallEnd, Point2D>>>();
  moves.set(wallId, { start: shift(wall.start), end: shift(wall.end) });
  for (const w of walls) {
    if (w.id === wallId) continue;
    for (const end of ['start', 'end'] as const) {
      if (closestOnSegment(wall.start, wall.end, w[end]).distance <= JOIN_TOLERANCE) {
        moves.set(w.id, { ...moves.get(w.id), [end]: shift(w[end]) });
      }
    }
  }
  return withEnds(walls, moves);
}

/** Makes a wall `length` long by moving its end along its direction (joined ends follow). */
export function setWallLength(walls: WallSegment2D[], wallId: string, length: number): WallSegment2D[] {
  const wall = walls.find((w) => w.id === wallId);
  const current = wall ? wallLength(wall) : 0;
  if (!wall || current < 1e-9 || !(length > 0)) return walls;
  const k = length / current;
  return moveWallEnd(walls, wallId, 'end', {
    x: clean(wall.start.x + (wall.end.x - wall.start.x) * k),
    z: clean(wall.start.z + (wall.end.z - wall.start.z) * k),
  });
}

function median(values: number[], fallback: number): number {
  if (!values.length) return fallback;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** A new wall from a to b, as thick and high as the plan's typical wall; returns its id too. */
export function addWall(walls: WallSegment2D[], a: Point2D, b: Point2D): { walls: WallSegment2D[]; id: string } {
  const used = new Set(walls.map((w) => w.id));
  let n = walls.length + 1;
  while (used.has(`wall-${n}`)) n++;
  const id = `wall-${n}`;
  const wall: WallSegment2D = {
    id,
    start: { ...a },
    end: { ...b },
    thickness: median(walls.map((w) => w.thickness), 0.2),
    height: median(walls.map((w) => w.height), 2.8),
  };
  return { walls: [...walls, wall], id };
}

/** The opening's position (0..1 along the wall) moved to `t`, kept so the whole opening fits on the wall. */
export function fitPosition(t: number, width: number, length: number): number {
  if (length < 1e-9) return 0.5;
  const half = Math.min(width, length) / 2 / length;
  return clean(Math.min(1 - half, Math.max(half, t)));
}

/** A new door or window on a wall, centred at `t` along it; returns its id too. */
export function placeOpening(
  openings: Opening2D[],
  wall: WallSegment2D,
  kind: OpeningKind,
  t: number,
): { openings: Opening2D[]; id: string } {
  const opening = makeOpening(openings, kind, wall.id);
  opening.width = Math.min(opening.width, Math.max(0.3, wallLength(wall) - 0.1));
  opening.position = fitPosition(t, opening.width, wallLength(wall));
  return { openings: [...openings, opening], id: opening.id };
}

/** Changes fields of one opening; a door becoming a window (or back) takes that kind's usual sill and height. */
export function updateOpening(openings: Opening2D[], id: string, fields: Partial<Omit<Opening2D, 'id' | 'wallId'>>, wall?: WallSegment2D): Opening2D[] {
  return openings.map((o) => {
    if (o.id !== id) return o;
    let next = { ...o, ...fields };
    if (fields.kind && fields.kind !== o.kind && fields.sill === undefined && fields.height === undefined) {
      next = fields.kind === 'door' ? { ...next, sill: 0, height: 2.1 } : { ...next, sill: 0.9, height: 1.2 };
    }
    if (wall) next.position = fitPosition(next.position, next.width, wallLength(wall));
    return next;
  });
}
