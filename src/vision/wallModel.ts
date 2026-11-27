/**
 * The trained wall model (a U-Net that labels every pixel as background, wall, door or window),
 * as plain functions with no runtime in them: the model's input, predicting a whole plan in
 * overlapping tiles, and turning the door and window pixels into openings on the detected walls.
 * The same code runs in the browser (wallModelWorker.ts, on onnxruntime-web) and in Node
 * (scripts/check-wall-model.ts), and tiles a plan the way training/model.py predict_plan does.
 */

import type { OpeningKind, Segment2D } from '../types/floorplan';

export const CLASS_BACKGROUND = 0;
export const CLASS_WALL = 1;
export const CLASS_DOOR = 2;
export const CLASS_WINDOW = 3;
export const CLASS_COUNT = 4;

/** Tile side and overlap in the browser: 512 keeps every tensor small enough for any GPU; training scored with 1024. */
export const BROWSER_TILE = 512;
export const TILE_MARGIN = 96;

/** One label per pixel (CLASS_*), on the pixel grid of the image the model saw. */
export interface ClassMap {
  width: number;
  height: number;
  classes: Uint8Array;
}

/** The model's input: 0 for white paper, 1 for black ink, from OpenCV's grayscale (0.299 R + 0.587 G + 0.114 B). */
export function inkFromRgba(data: Uint8ClampedArray | Uint8Array, width: number, height: number): Float32Array {
  const ink = new Float32Array(width * height);
  for (let p = 0, i = 0; p < ink.length; p++, i += 4) {
    const gray = (data[i] * 4899 + data[i + 1] * 9617 + data[i + 2] * 1868 + 8192) >> 14;
    ink[p] = 1 - gray / 255;
  }
  return ink;
}

export interface TilePlan {
  /** The padded canvas: at least one tile, and a multiple of 32 (the model halves the image five times). */
  width: number;
  height: number;
  tile: number;
  tiles: { x: number; y: number; keep: { left: number; top: number; right: number; bottom: number } }[];
}

/** Where the tiles go: they overlap by twice the margin, and each keeps its middle (its whole side at the canvas edge). */
export function planTiles(width: number, height: number, tile = BROWSER_TILE, margin = TILE_MARGIN): TilePlan {
  const W = Math.ceil(Math.max(width, tile) / 32) * 32;
  const H = Math.ceil(Math.max(height, tile) / 32) * 32;
  const step = tile - 2 * margin;
  const starts = (n: number) => {
    const s: number[] = [];
    for (let v = 0; v <= n - tile; v += step) s.push(v);
    if (s[s.length - 1] !== n - tile) s.push(n - tile);
    return s;
  };
  const tiles: TilePlan['tiles'] = [];
  for (const y of starts(H)) {
    for (const x of starts(W)) {
      tiles.push({
        x,
        y,
        keep: { left: x === 0 ? 0 : margin, top: y === 0 ? 0 : margin, right: x + tile >= W ? tile : tile - margin, bottom: y + tile >= H ? tile : tile - margin },
      });
    }
  }
  return { width: W, height: H, tile, tiles };
}

/** Runs the network on one square tile of ink and returns its scores, class by class ([4, tile, tile], row-major). */
export type TileRunner = (ink: Float32Array, tile: number) => Promise<Float32Array>;

/** The class of every pixel of a plan, predicted tile by tile. */
export async function predictClasses(
  ink: Float32Array,
  width: number,
  height: number,
  runTile: TileRunner,
  { tile = BROWSER_TILE, margin = TILE_MARGIN, onProgress }: { tile?: number; margin?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<ClassMap> {
  const plan = planTiles(width, height, tile, margin);
  const classes = new Uint8Array(width * height);
  const input = new Float32Array(tile * tile);
  onProgress?.(0, plan.tiles.length);
  for (let n = 0; n < plan.tiles.length; n++) {
    const { x: x0, y: y0, keep } = plan.tiles[n];
    // Outside the image the canvas is paper (ink 0).
    input.fill(0);
    const rows = Math.min(tile, height - y0);
    const cols = Math.min(tile, width - x0);
    for (let y = 0; y < rows; y++) input.set(ink.subarray((y0 + y) * width + x0, (y0 + y) * width + x0 + cols), y * tile);
    const scores = await runTile(input, tile);
    const area = tile * tile;
    for (let y = keep.top; y < Math.min(keep.bottom, rows); y++) {
      for (let x = keep.left; x < Math.min(keep.right, cols); x++) {
        const p = y * tile + x;
        let best = 0;
        let bestScore = scores[p];
        for (let c = 1; c < CLASS_COUNT; c++) {
          const score = scores[c * area + p];
          if (score > bestScore) {
            bestScore = score;
            best = c;
          }
        }
        classes[(y0 + y) * width + x0 + x] = best;
      }
    }
    onProgress?.(n + 1, plan.tiles.length);
  }
  return { width, height, classes };
}

/**
 * The mask the wall steps work on: walls together with the doors and windows cut into them (255),
 * so a wall runs on through its openings and each opening can then be placed on it.
 */
export function wallBandMask(map: ClassMap): Uint8Array {
  const mask = new Uint8Array(map.classes.length);
  for (let p = 0; p < mask.length; p++) if (map.classes[p] !== CLASS_BACKGROUND) mask[p] = 255;
  return mask;
}

export function countClasses(map: ClassMap): { wall: number; door: number; window: number } {
  const counts = [0, 0, 0, 0];
  for (let p = 0; p < map.classes.length; p++) counts[map.classes[p]]++;
  return { wall: counts[CLASS_WALL], door: counts[CLASS_DOOR], window: counts[CLASS_WINDOW] };
}

/** A door or window found in the image, placed on one of the detected walls. */
export interface DetectedOpening {
  kind: OpeningKind;
  /** Index into the walls it was placed on. */
  wall: number;
  /** Centre along that wall, 0 at its start and 1 at its end. */
  position: number;
  /** Width along the wall, in pixels. */
  widthPx: number;
}

/** Groups of touching pixels of one class, as pixel indices (8-connected). */
function components(map: ClassMap, value: number): number[][] {
  const { width, height, classes } = map;
  const seen = new Uint8Array(classes.length);
  const groups: number[][] = [];
  for (let start = 0; start < classes.length; start++) {
    if (classes[start] !== value || seen[start]) continue;
    const group = [start];
    seen[start] = 1;
    for (let i = 0; i < group.length; i++) {
      const p = group[i];
      const x = p % width;
      const y = (p - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (classes[q] === value && !seen[q]) {
            seen[q] = 1;
            group.push(q);
          }
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

/**
 * Doors and windows from the class map: every patch of door or window pixels is put on the wall
 * it lies along (the wall its pixels cover the longest stretch of), with its extent along that
 * wall as its width. Patches too small to be an opening, or lying on no wall, are left out.
 */
export function openingsFromClasses(map: ClassMap, walls: Segment2D[]): DetectedOpening[] {
  const thicknesses = walls.map((w) => w.thickness).filter((t) => t > 0).sort((a, b) => a - b);
  const typical = thicknesses.length ? thicknesses[Math.floor(thicknesses.length / 2)] : 8;
  const minWidth = Math.max(4, 1.5 * typical); // a door is several wall thicknesses wide
  const found: DetectedOpening[] = [];
  for (const [value, kind] of [
    [CLASS_DOOR, 'door'],
    [CLASS_WINDOW, 'window'],
  ] as [number, OpeningKind][]) {
    for (const group of components(map, value)) {
      if (group.length < minWidth * Math.max(2, 0.3 * typical)) continue;
      let best: { wall: number; from: number; to: number; length: number; off: number } | null = null;
      walls.forEach((wall, index) => {
        const dx = wall.bx - wall.ax;
        const dy = wall.by - wall.ay;
        const length = Math.hypot(dx, dy);
        if (length < 1) return;
        const ux = dx / length;
        const uy = dy / length;
        const reach = Math.max(wall.thickness, typical) / 2 + 2;
        // The stretch of the wall its pixels lie on, and how far from the centre line they are on average.
        const along: number[] = [];
        let off = 0;
        for (const p of group) {
          const x = (p % map.width) - wall.ax;
          const y = Math.floor(p / map.width) - wall.ay;
          const across = Math.abs(x * -uy + y * ux);
          if (across > reach) continue;
          const s = x * ux + y * uy;
          if (s < -reach || s > length + reach) continue;
          along.push(s);
          off += across;
        }
        if (along.length < 0.5 * group.length) return; // most of the patch has to lie on this wall
        along.sort((a, b) => a - b);
        // Trimmed ends, so a few stray pixels do not stretch the opening.
        const from = Math.max(0, along[Math.floor(along.length * 0.02)]);
        const to = Math.min(length, along[Math.ceil(along.length * 0.98) - 1] + 1);
        const candidate = { wall: index, from, to, length, off: off / along.length };
        if (to - from < minWidth) return;
        if (!best || to - from > best.to - best.from + 1 || (Math.abs(to - from - (best.to - best.from)) <= 1 && candidate.off < best.off)) best = candidate;
      });
      const placed = best as { wall: number; from: number; to: number; length: number } | null;
      if (placed) found.push({ kind, wall: placed.wall, position: (placed.from + placed.to) / 2 / placed.length, widthPx: placed.to - placed.from });
    }
  }
  return found;
}

/**
 * The walls without the stretches their doors and windows take up: the solid pieces, which is what
 * a plan's known walls are scored against (the model's walls run on through their openings).
 */
export function solidWallPieces(walls: Segment2D[], openings: DetectedOpening[]): Segment2D[] {
  return walls.flatMap((wall, index) => {
    const length = Math.hypot(wall.bx - wall.ax, wall.by - wall.ay);
    const gaps = openings
      .filter((o) => o.wall === index)
      .map((o) => [o.position * length - o.widthPx / 2, o.position * length + o.widthPx / 2])
      .sort((a, b) => a[0] - b[0]);
    if (length < 1e-6 || gaps.length === 0) return [wall];
    const at = (s: number) => ({ x: wall.ax + ((wall.bx - wall.ax) * s) / length, y: wall.ay + ((wall.by - wall.ay) * s) / length });
    const pieces: Segment2D[] = [];
    let from = 0;
    for (const [start, end] of [...gaps, [length, length]]) {
      if (start - from > 1) {
        const a = at(from);
        const b = at(Math.min(start, length));
        pieces.push({ ...wall, id: `${wall.id}-${pieces.length + 1}`, ax: a.x, ay: a.y, bx: b.x, by: b.y });
      }
      from = Math.max(from, end);
    }
    return pieces;
  });
}
