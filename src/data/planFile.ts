/**
 * The FloorPlan3D plan file: the one JSON format that samples, saved files, plans detected from
 * images and (later) drawings all share, so the 3D side never cares where a plan came from.
 *
 *   { "format": "floorplan3d-plan", "version": 1, "savedAt": "…", "plan": { walls, openings, rooms, … } }
 *
 * Reading checks every wall, opening, room and furniture item and says in plain words what is
 * wrong. It also accepts a bare plan object (no wrapper) and plans in the older format, where each
 * wall carried at most one door and one window; those become the openings list. A file from a
 * newer version is refused rather than half-read.
 */

import type { FloorPlanDataset, FurnitureItem, Opening2D, Point2D, Room2D, WallSegment2D } from '../types/floorplan';
import { fromLegacyWalls, type LegacyWallOpenings } from '../utils/openings';

export const PLAN_FORMAT = 'floorplan3d-plan';
export const PLAN_VERSION = 1;

export interface PlanFile {
  format: typeof PLAN_FORMAT;
  version: number;
  savedAt: string;
  plan: FloorPlanDataset;
}

export class PlanFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanFileError';
  }
}

export function serializePlan(plan: FloorPlanDataset, savedAt = new Date()): string {
  const file: PlanFile = { format: PLAN_FORMAT, version: PLAN_VERSION, savedAt: savedAt.toISOString(), plan };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** Reads a plan file's text; throws PlanFileError with a readable reason. */
export function parsePlan(text: string): FloorPlanDataset {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new PlanFileError('The file is not valid JSON.');
  }
  return planFromJson(data);
}

/** A file name for the plan, such as "two-bedroom-urban-suite.json". */
export function planFileName(plan: FloorPlanDataset): string {
  const slug = plan.name
    .replace(/^Sample \d+:\s*/, '')
    .replace(/\s*\(.*\)\s*$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'plan'}.json`;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const fail = (message: string): never => {
  throw new PlanFileError(message);
};

const DIFFICULTIES: FloorPlanDataset['difficulty'][] = ['Clean Orthogonal', 'Moderate (Doors/Text)', 'Complex (Noisy Scan)', 'Multi-Room Layout'];
const ROOM_TYPES: Room2D['type'][] = ['living', 'bedroom', 'kitchen', 'bathroom', 'balcony', 'corridor'];
const FURNITURE_TYPES: FurnitureItem['type'][] = ['bed', 'sofa', 'table', 'chair', 'counter'];

function point(v: unknown, what: string): Point2D {
  if (!isObject(v) || !isNumber(v.x) || !isNumber(v.z)) fail(`${what} needs x and z as numbers.`);
  const p = v as Json;
  return { x: p.x as number, z: p.z as number };
}

function triple(v: unknown, what: string): [number, number, number] {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(isNumber)) fail(`${what} needs three numbers.`);
  return v as [number, number, number];
}

function uniqueIds(items: { id: string }[], what: string): void {
  const seen = new Set<string>();
  for (const { id } of items) {
    if (seen.has(id)) fail(`Two ${what} share the id "${id}".`);
    seen.add(id);
  }
}

function readWall(v: unknown, i: number): WallSegment2D {
  const label = `Wall ${i + 1}`;
  if (!isObject(v)) return fail(`${label} is not an object.`);
  if (typeof v.id !== 'string' || !v.id) fail(`${label} has no id.`);
  const name = `${label} ("${v.id}")`;
  const thickness = v.thickness ?? 0.2;
  const height = v.height ?? 2.8;
  if (!isNumber(thickness) || thickness <= 0) fail(`${name}: thickness must be a number above 0 (metres).`);
  if (!isNumber(height) || height <= 0) fail(`${name}: height must be a number above 0 (metres).`);
  return {
    id: v.id as string,
    ...(typeof v.name === 'string' ? { name: v.name } : {}),
    start: point(v.start, `${name}: its start point`),
    end: point(v.end, `${name}: its end point`),
    thickness: thickness as number,
    height: height as number,
  };
}

function readOpening(v: unknown, i: number, wallIds: Set<string>): Opening2D {
  const label = `Opening ${i + 1}`;
  if (!isObject(v)) return fail(`${label} is not an object.`);
  const name = typeof v.id === 'string' && v.id ? `${label} ("${v.id}")` : label;
  if (v.kind !== 'door' && v.kind !== 'window') fail(`${name}: kind must be "door" or "window".`);
  if (typeof v.wallId !== 'string' || !wallIds.has(v.wallId)) fail(`${name} is on wall "${String(v.wallId)}", which the plan does not have.`);
  if (!isNumber(v.position) || v.position < 0 || v.position > 1) fail(`${name}: position must be a number from 0 (wall start) to 1 (wall end).`);
  if (!isNumber(v.width) || v.width <= 0) fail(`${name}: width must be a number above 0 (metres).`);
  if (!isNumber(v.sill) || v.sill < 0) fail(`${name}: sill must be a number of 0 or more (metres).`);
  if (!isNumber(v.height) || v.height <= 0) fail(`${name}: height must be a number above 0 (metres).`);
  return {
    id: typeof v.id === 'string' && v.id ? v.id : `${v.kind as string}-${i + 1}`,
    kind: v.kind as Opening2D['kind'],
    wallId: v.wallId as string,
    position: v.position as number,
    width: v.width as number,
    sill: v.sill as number,
    height: v.height as number,
  };
}

function shoelaceArea(corners: Point2D[]): number {
  let twice = 0;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) twice += corners[j].x * corners[i].z - corners[i].x * corners[j].z;
  return Math.round((Math.abs(twice) / 2) * 10) / 10;
}

function readRoom(v: unknown, i: number): Room2D {
  const label = `Room ${i + 1}`;
  if (!isObject(v)) return fail(`${label} is not an object.`);
  if (!Array.isArray(v.corners) || v.corners.length < 3) fail(`${label} needs at least three corners.`);
  const corners = (v.corners as unknown[]).map((c, k) => point(c, `${label}: corner ${k + 1}`));
  return {
    id: typeof v.id === 'string' && v.id ? v.id : `room-${i + 1}`,
    name: typeof v.name === 'string' ? v.name : `Room ${i + 1}`,
    color: typeof v.color === 'string' ? v.color : '#9aa4a9',
    corners,
    areaSqM: isNumber(v.areaSqM) ? v.areaSqM : shoelaceArea(corners),
    type: ROOM_TYPES.includes(v.type as Room2D['type']) ? (v.type as Room2D['type']) : 'living',
  };
}

function readFurniture(v: unknown, i: number): FurnitureItem {
  const label = `Furniture item ${i + 1}`;
  if (!isObject(v)) return fail(`${label} is not an object.`);
  return {
    id: typeof v.id === 'string' && v.id ? v.id : `furniture-${i + 1}`,
    name: typeof v.name === 'string' ? v.name : `Furniture ${i + 1}`,
    type: FURNITURE_TYPES.includes(v.type as FurnitureItem['type']) ? (v.type as FurnitureItem['type']) : 'table',
    position: triple(v.position, `${label}: position`),
    size: triple(v.size, `${label}: size`),
    rotationY: isNumber(v.rotationY) ? v.rotationY : 0,
    color: typeof v.color === 'string' ? v.color : '#a8a29e',
  };
}

/** A plan from parsed JSON: a plan file, or a bare plan object. */
export function planFromJson(data: unknown): FloorPlanDataset {
  if (!isObject(data)) return fail('The file does not hold a plan.');
  let raw: unknown = data;
  if ('format' in data) {
    if (data.format !== PLAN_FORMAT) fail(`This is not a FloorPlan3D plan file (its format is "${String(data.format)}").`);
    if (!isNumber(data.version) || data.version < 1) fail('The plan file has no valid version number.');
    if ((data.version as number) > PLAN_VERSION) {
      fail(`This plan file is version ${data.version}, and this app reads up to version ${PLAN_VERSION}. Open it in a newer FloorPlan3D.`);
    }
    raw = data.plan;
  }
  if (!isObject(raw)) return fail('The file does not hold a plan.');
  if (!Array.isArray(raw.walls)) fail('The plan has no list of walls.');

  const walls = (raw.walls as unknown[]).map(readWall);
  uniqueIds(walls, 'walls');
  const wallIds = new Set(walls.map((w) => w.id));
  const listed = Array.isArray(raw.openings) ? raw.openings : fromLegacyWalls(raw.walls as (WallSegment2D & LegacyWallOpenings)[]).openings;
  const openings = listed.map((o, i) => readOpening(o, i, wallIds));
  uniqueIds(openings, 'doors or windows');
  const rooms = Array.isArray(raw.rooms) ? raw.rooms.map(readRoom) : [];
  const furniture = Array.isArray(raw.furniture) ? raw.furniture.map(readFurniture) : [];

  const num = (v: unknown, fallback: number) => (isNumber(v) ? v : fallback);
  const scale = num(raw.scale, 0.015);
  if (scale <= 0) fail('The plan scale (metres per pixel) must be above 0.');
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : 'plan',
    name: typeof raw.name === 'string' && raw.name ? raw.name : 'Untitled plan',
    description: typeof raw.description === 'string' ? raw.description : '',
    difficulty: DIFFICULTIES.includes(raw.difficulty as FloorPlanDataset['difficulty'])
      ? (raw.difficulty as FloorPlanDataset['difficulty'])
      : 'Clean Orthogonal',
    widthPx: num(raw.widthPx, 800),
    heightPx: num(raw.heightPx, 600),
    scale,
    u0: num(raw.u0, 400),
    v0: num(raw.v0, 300),
    walls,
    openings,
    rooms,
    furniture,
  };
}

/** Whether two plans hold the same content (key order and number formatting aside). */
export function samePlan(a: FloorPlanDataset, b: FloorPlanDataset): boolean {
  return JSON.stringify(planFromJson(a)) === JSON.stringify(planFromJson(b));
}
