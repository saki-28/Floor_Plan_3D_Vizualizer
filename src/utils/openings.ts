/**
 * Doors and windows as a plan's own list (Opening2D): defaults, ids, where each sits on its wall,
 * and the cuts the 3D extrusion makes. Also reads the older per-wall fields (hasDoor, doorPosition,
 * …) so plans saved before the list existed still open.
 */

import type { Opening2D, OpeningKind, WallSegment2D } from '../types/floorplan';
import { distance2D, type Opening } from './geometryEngine';

/** Typical sizes in metres: an interior door, and a window with a 0.9 m sill. */
export const OPENING_DEFAULTS: Record<OpeningKind, { width: number; sill: number; height: number }> = {
  door: { width: 0.9, sill: 0, height: 2.1 },
  window: { width: 1.2, sill: 0.9, height: 1.2 },
};

export function openingsOnWall(openings: Opening2D[], wallId: string): Opening2D[] {
  return openings.filter((o) => o.wallId === wallId);
}

/** An id not yet used in `openings`, such as "door-3". */
export function nextOpeningId(openings: Opening2D[], kind: OpeningKind): string {
  const used = new Set(openings.map((o) => o.id));
  let n = openings.filter((o) => o.kind === kind).length + 1;
  while (used.has(`${kind}-${n}`)) n++;
  return `${kind}-${n}`;
}

export function makeOpening(
  openings: Opening2D[],
  kind: OpeningKind,
  wallId: string,
  fields: Partial<Omit<Opening2D, 'id' | 'kind' | 'wallId'>> = {},
): Opening2D {
  return { id: nextOpeningId(openings, kind), kind, wallId, position: 0.5, ...OPENING_DEFAULTS[kind], ...fields };
}

/** Where the opening sits along its wall, in metres from the wall's start, kept within the wall. */
export function openingSpan(opening: Opening2D, wallLength: number): { from: number; to: number } {
  const centre = opening.position * wallLength;
  const half = Math.min(opening.width, wallLength) / 2;
  const from = Math.min(Math.max(centre - half, 0), wallLength - 2 * half);
  return { from, to: from + 2 * half };
}

/** The holes the 3D extrusion cuts for a wall's openings, with heights limited to the wall's. */
export function wallCuts(openings: Opening2D[], wall: WallSegment2D, wallHeight = wall.height): Opening[] {
  const length = distance2D(wall.start, wall.end);
  if (length < 1e-6) return [];
  return openingsOnWall(openings, wall.id).map((o) => {
    const { from, to } = openingSpan(o, length);
    const sill = Math.min(o.sill, wallHeight);
    return { wallId: wall.id, t0: from / length, t1: to / length, sill, head: Math.min(sill + o.height, wallHeight) };
  });
}

/** Openings whose wall still exists (a deleted wall takes its doors and windows with it). */
export function pruneOpenings(openings: Opening2D[], walls: WallSegment2D[]): Opening2D[] {
  const ids = new Set(walls.map((w) => w.id));
  return openings.filter((o) => ids.has(o.wallId));
}

/** The older format: at most one door and one window stored on each wall. */
export interface LegacyWallOpenings {
  hasDoor?: boolean;
  doorPosition?: number;
  doorWidth?: number;
  hasWindow?: boolean;
  windowPosition?: number;
  windowWidth?: number;
  windowSillHeight?: number;
  windowHeight?: number;
}

/** Openings from walls written in the older per-wall format, and the walls without those fields. */
export function fromLegacyWalls(walls: (WallSegment2D & LegacyWallOpenings)[]): { walls: WallSegment2D[]; openings: Opening2D[] } {
  const openings: Opening2D[] = [];
  const clean = walls.map((w) => {
    const { hasDoor, doorPosition, doorWidth, hasWindow, windowPosition, windowWidth, windowSillHeight, windowHeight, ...wall } = w;
    if (hasDoor) openings.push(makeOpening(openings, 'door', w.id, { position: doorPosition ?? 0.5, width: doorWidth ?? OPENING_DEFAULTS.door.width }));
    if (hasWindow) {
      openings.push(
        makeOpening(openings, 'window', w.id, {
          position: windowPosition ?? 0.5,
          width: windowWidth ?? OPENING_DEFAULTS.window.width,
          sill: windowSillHeight ?? OPENING_DEFAULTS.window.sill,
          height: windowHeight ?? OPENING_DEFAULTS.window.height,
        }),
      );
    }
    return wall;
  });
  return { walls: clean, openings };
}
