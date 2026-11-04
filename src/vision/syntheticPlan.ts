/**
 * Renders a FloorPlanDataset as a raster floor-plan drawing (8-bit grayscale):
 * solid walls, door gaps with swing arcs, window symbols, room labels and
 * dimension lines, optionally with scan-like noise and rotation. The walls come
 * from known data, so every image has exact ground truth for testing the
 * vision pipeline.
 *
 * Pure TypeScript (no DOM, no Node APIs): runs in tests, scripts and the browser.
 * Pixel mapping follows B3 with no mirroring: u grows with +x, v grows with +z.
 */

import type { FloorPlanDataset, Opening2D, Point2D, Segment2D, WallSegment2D } from '../types/floorplan';
import { openingSpan, openingsOnWall } from '../utils/openings';

export interface SyntheticPlanOptions {
  pixelsPerMeter: number;
  marginPx: number;
  labels: boolean;
  /** Output pixels per font pixel. 2 gives strokes a 3×3 opening removes; 3 survives it. */
  labelScale: number;
  dimensions: boolean;
  doorSwings: boolean;
  /** Paper tint, uneven lighting, grain and dark specks. */
  scanNoise: boolean;
  rotationDeg: number;
  seed: number;
}

export interface SyntheticPlan {
  width: number;
  height: number;
  gray: Uint8Array;
  pixelsPerMeter: number;
  /** Wall centerlines in output pixels; thickness in pixels. */
  groundTruth: Segment2D[];
  /**
   * The solid pieces of each wall between its door and window openings, as centerlines from
   * the wall's own endpoints: what wall detection should find.
   */
  groundTruthPieces: Segment2D[];
}

const DEFAULT_OPTIONS: SyntheticPlanOptions = {
  pixelsPerMeter: 60,
  marginPx: 80,
  labels: true,
  labelScale: 2,
  dimensions: true,
  doorSwings: true,
  scanNoise: false,
  rotationDeg: 0,
  seed: 1,
};

/** Drawing happens at SS× resolution and is box-filtered down, for anti-aliased edges. */
const SS = 2;
const INK = 0;
const PAPER = 255;
/** Thin annotation strokes (window symbols, door swings, dimensions), in output pixels. */
const THIN = 1;

// 5×7 bitmap font, one string of rows per glyph.
const FONT: Record<string, string> = {
  A: '01110 10001 10001 11111 10001 10001 10001',
  B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110',
  D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111',
  F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111',
  H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110',
  J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001',
  L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001',
  N: '10001 10001 11001 10101 10011 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110',
  P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101',
  R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110',
  T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110',
  V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 10101 01010',
  X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100',
  Z: '11111 00001 00010 00100 01000 10000 11111',
  '0': '01110 10001 10011 10101 11001 10001 01110',
  '1': '00100 01100 00100 00100 00100 00100 01110',
  '2': '01110 10001 00001 00010 00100 01000 11111',
  '3': '11111 00010 00100 00010 00001 10001 01110',
  '4': '00010 00110 01010 10010 11111 00010 00010',
  '5': '11111 10000 11110 00001 00001 10001 01110',
  '6': '00110 01000 10000 11110 10001 10001 01110',
  '7': '11111 00001 00010 00100 01000 01000 01000',
  '8': '01110 10001 10001 01110 10001 10001 01110',
  '9': '01110 10001 10001 01111 00001 00010 01100',
  '.': '00000 00000 00000 00000 00000 01100 01100',
  '&': '01100 10010 10100 01000 10101 10010 01101',
  '-': '00000 00000 00000 11111 00000 00000 00000',
};
const GLYPH_ADVANCE = 6; // 5 columns + 1 spacing
const LINE_ADVANCE = 9; // 7 rows + 2 spacing

type Vec = [number, number];

/** Small deterministic PRNG (mulberry32) so test images are reproducible. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function insidePolygon(x: number, y: number, pts: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

class Raster {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    fill: number,
  ) {
    this.data = new Uint8Array(width * height).fill(fill);
  }

  fillPolygon(pts: Vec[], value: number): void {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x0 = Math.max(0, Math.floor(Math.min(...xs)));
    const x1 = Math.min(this.width - 1, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const y1 = Math.min(this.height - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (insidePolygon(x + 0.5, y + 0.5, pts)) this.data[y * this.width + x] = value;
      }
    }
  }

  fillRect(x: number, y: number, w: number, h: number, value: number): void {
    this.fillPolygon([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], value);
  }

  /** Line of the given width with square caps. */
  strokeLine(a: Vec, b: Vec, width: number, value: number): void {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) return;
    const ux = (b[0] - a[0]) / len;
    const uy = (b[1] - a[1]) / len;
    const hw = width / 2;
    const nx = -uy * hw;
    const ny = ux * hw;
    const ax = a[0] - ux * hw;
    const ay = a[1] - uy * hw;
    const bx = b[0] + ux * hw;
    const by = b[1] + uy * hw;
    this.fillPolygon([[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]], value);
  }

  strokeArc(center: Vec, radius: number, from: number, to: number, width: number, value: number): void {
    const steps = Math.max(8, Math.ceil((Math.abs(to - from) * radius) / 3));
    let prev: Vec = [center[0] + radius * Math.cos(from), center[1] + radius * Math.sin(from)];
    for (let i = 1; i <= steps; i++) {
      const t = from + ((to - from) * i) / steps;
      const next: Vec = [center[0] + radius * Math.cos(t), center[1] + radius * Math.sin(t)];
      this.strokeLine(prev, next, width, value);
      prev = next;
    }
  }

  /** Draws text centred on (cx, cy); `pixel` is the size of one font pixel. */
  text(lines: string[], cx: number, cy: number, pixel: number, value: number): void {
    const top = cy - ((lines.length * LINE_ADVANCE - 2) * pixel) / 2;
    lines.forEach((line, row) => {
      const left = cx - ((line.length * GLYPH_ADVANCE - 1) * pixel) / 2;
      [...line].forEach((ch, col) => {
        const glyph = FONT[ch];
        if (!glyph) return;
        glyph.split(' ').forEach((bits, gy) => {
          for (let gx = 0; gx < 5; gx++) {
            if (bits[gx] === '1') {
              this.fillRect(left + (col * GLYPH_ADVANCE + gx) * pixel, top + (row * LINE_ADVANCE + gy) * pixel, pixel, pixel, value);
            }
          }
        });
      });
    });
  }
}

/** Box-filters an SS× raster down to output size. */
function downsample(src: Raster, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) sum += src.data[(y * SS + dy) * src.width + x * SS + dx];
      }
      out[y * width + x] = Math.round(sum / (SS * SS));
    }
  }
  return out;
}

/** Splits a label into at most two lines when it is wider than `maxChars`. */
function wrapLabel(text: string, maxChars: number): string[] {
  if (text.length <= maxChars || !text.includes(' ')) return [text];
  const words = text.split(' ');
  let best = [text];
  let bestWidth = Infinity;
  for (let i = 1; i < words.length; i++) {
    const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    const width = Math.max(lines[0].length, lines[1].length);
    if (width < bestWidth) {
      best = lines;
      bestWidth = width;
    }
  }
  return best;
}

interface Interval {
  from: number;
  to: number;
}

function wallOpenings(openings: Opening2D[], wall: WallSegment2D, length: number): { doors: Interval[]; windows: Interval[] } {
  const spans = (kind: Opening2D['kind']) =>
    openingsOnWall(openings, wall.id)
      .filter((o) => o.kind === kind)
      .map((o) => openingSpan(o, length));
  return { doors: spans('door'), windows: spans('window') };
}

/** Solid pieces of [from, to] once the openings are cut out. */
function subtractIntervals(from: number, to: number, cuts: Interval[]): Interval[] {
  const pieces: Interval[] = [];
  let start = from;
  for (const cut of [...cuts].sort((a, b) => a.from - b.from)) {
    if (cut.from > start) pieces.push({ from: start, to: Math.min(cut.from, to) });
    start = Math.max(start, cut.to);
  }
  if (start < to) pieces.push({ from: start, to });
  return pieces.filter((p) => p.to - p.from > 1e-6);
}

export function renderSyntheticPlan(plan: FloorPlanDataset, options: Partial<SyntheticPlanOptions> = {}): SyntheticPlan {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const ppm = opts.pixelsPerMeter;
  const maxThickness = Math.max(0, ...plan.walls.map((w) => w.thickness));
  const xs = plan.walls.flatMap((w) => [w.start.x, w.end.x]);
  const zs = plan.walls.flatMap((w) => [w.start.z, w.end.z]);
  const minX = Math.min(...xs) - maxThickness;
  const maxX = Math.max(...xs) + maxThickness;
  const minZ = Math.min(...zs) - maxThickness;
  const maxZ = Math.max(...zs) + maxThickness;

  const width = Math.ceil((maxX - minX) * ppm + 2 * opts.marginPx);
  const height = Math.ceil((maxZ - minZ) * ppm + 2 * opts.marginPx);
  const canvas = new Raster(width * SS, height * SS, PAPER);

  // World metres → output pixels, and → supersampled canvas pixels.
  const toPx = (p: Point2D): Vec => [opts.marginPx + (p.x - minX) * ppm, opts.marginPx + (p.z - minZ) * ppm];
  const toSs = (p: Point2D): Vec => {
    const [u, v] = toPx(p);
    return [u * SS, v * SS];
  };
  const thin = THIN * SS;

  const groundTruth: Segment2D[] = [];
  const groundTruthPieces: Segment2D[] = [];

  for (const wall of plan.walls) {
    const dx = wall.end.x - wall.start.x;
    const dz = wall.end.z - wall.start.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    const u = { x: dx / length, z: dz / length };
    const n = { x: -u.z, z: u.x };
    const half = wall.thickness / 2;
    const at = (s: number, offset: number): Vec =>
      toSs({ x: wall.start.x + u.x * s + n.x * offset, z: wall.start.z + u.z * s + n.z * offset });

    const [a, b] = [toPx(wall.start), toPx(wall.end)];
    groundTruth.push({ id: wall.id, ax: a[0], ay: a[1], bx: b[0], by: b[1], thickness: wall.thickness * ppm });

    // Walls extend by half their thickness at both ends so corners close.
    const { doors, windows } = wallOpenings(plan.openings, wall, length);
    const cuts = [...doors, ...windows];
    subtractIntervals(0, length, cuts)
      .filter((piece) => piece.to - piece.from >= 0.05)
      .forEach((piece, i) => {
        const [pa, pb] = [piece.from, piece.to].map((t) => toPx({ x: wall.start.x + u.x * t, z: wall.start.z + u.z * t }));
        groundTruthPieces.push({ id: `${wall.id}-${i + 1}`, ax: pa[0], ay: pa[1], bx: pb[0], by: pb[1], thickness: wall.thickness * ppm });
      });
    for (const piece of subtractIntervals(-half, length + half, cuts)) {
      canvas.fillPolygon([at(piece.from, half), at(piece.to, half), at(piece.to, -half), at(piece.from, -half)], INK);
    }

    for (const window of windows) {
      for (const offset of [-half, 0, half]) canvas.strokeLine(at(window.from, offset), at(window.to, offset), thin, INK);
      for (const s of [window.from, window.to]) canvas.strokeLine(at(s, -half), at(s, half), thin, INK);
    }

    for (const door of opts.doorSwings ? doors : []) {
      // Leaf drawn fully open (90°) from the hinge, with its swing arc.
      const doorWidth = door.to - door.from;
      const hinge = at(door.from, 0);
      const leafTip = toSs({
        x: wall.start.x + u.x * door.from + n.x * doorWidth,
        z: wall.start.z + u.z * door.from + n.z * doorWidth,
      });
      canvas.strokeLine(hinge, leafTip, thin * 1.5, INK);
      const angleOf = (p: Vec) => Math.atan2(p[1] - hinge[1], p[0] - hinge[0]);
      const start = angleOf(at(door.to, 0));
      let end = angleOf(leafTip);
      if (end - start > Math.PI) end -= 2 * Math.PI;
      if (start - end > Math.PI) end += 2 * Math.PI;
      canvas.strokeArc(hinge, doorWidth * ppm * SS, start, end, thin, INK);
    }
  }

  if (opts.labels) {
    const pixel = opts.labelScale * SS;
    for (const room of plan.rooms) {
      const cx = room.corners.reduce((s, c) => s + c.x, 0) / room.corners.length;
      const cz = room.corners.reduce((s, c) => s + c.z, 0) / room.corners.length;
      const roomWidthPx = (Math.max(...room.corners.map((c) => c.x)) - Math.min(...room.corners.map((c) => c.x))) * ppm;
      const maxChars = Math.max(4, Math.floor((roomWidthPx * 0.8) / (GLYPH_ADVANCE * opts.labelScale)));
      const lines = [...wrapLabel(room.name.toUpperCase(), maxChars), `${room.areaSqM.toFixed(1)} M2`];
      const [x, y] = toSs({ x: cx, z: cz });
      canvas.text(lines, x, y, pixel, INK);
    }
  }

  if (opts.dimensions) {
    // Overall width above the plan and overall depth to its left, as thin
    // dimension lines with 45° ticks and small text.
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...zs);
    const bottom = Math.max(...zs);
    const gap = maxThickness + 30 / ppm;
    const tick = 6 * SS;
    const textPixel = Math.max(1, opts.labelScale - 1) * SS;

    const y = toSs({ x: 0, z: top - gap })[1];
    const [xl, xr] = [toSs({ x: left, z: 0 })[0], toSs({ x: right, z: 0 })[0]];
    canvas.strokeLine([xl, y], [xr, y], thin, INK);
    for (const x of [xl, xr]) canvas.strokeLine([x - tick, y + tick], [x + tick, y - tick], thin, INK);
    canvas.text([(right - left).toFixed(2)], (xl + xr) / 2, y - 8 * SS, textPixel, INK);

    const x = toSs({ x: left - gap, z: 0 })[0];
    const [yt, yb] = [toSs({ x: 0, z: top })[1], toSs({ x: 0, z: bottom })[1]];
    canvas.strokeLine([x, yt], [x, yb], thin, INK);
    for (const yy of [yt, yb]) canvas.strokeLine([x - tick, yy + tick], [x + tick, yy - tick], thin, INK);
    canvas.text([(bottom - top).toFixed(2)], x - 18 * SS, (yt + yb) / 2, textPixel, INK);
  }

  let gray = downsample(canvas, width, height);
  const random = makeRandom(opts.seed);
  let background = PAPER;

  if (opts.scanNoise) {
    background = 236;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const ink = 1 - gray[i] / 255;
        // Uneven lighting darkens the paper towards one corner; ink is not pure black.
        const paper = 246 - 22 * (x / width) - 12 * (y / height);
        const grain = (random() + random() + random() - 1.5) * 10;
        gray[i] = Math.max(0, Math.min(255, Math.round(paper - ink * (paper - 45) + grain)));
      }
    }
    // Dark specks and a few larger blots (dust, toner).
    const specks = Math.round(width * height * 0.0006);
    for (let k = 0; k < specks; k++) {
      const size = random() < 0.85 ? 1 + Math.floor(random() * 2) : 3 + Math.floor(random() * 3);
      const sx = Math.floor(random() * (width - size));
      const sy = Math.floor(random() * (height - size));
      for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) gray[(sy + dy) * width + sx + dx] = 40 + Math.floor(random() * 40);
      }
    }
  }

  if (opts.rotationDeg !== 0) {
    const theta = (opts.rotationDeg * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const cx = width / 2;
    const cy = height / 2;
    const rotated = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Inverse-map each output pixel into the source and sample bilinearly.
        const sx = cx + (x - cx) * cos + (y - cy) * sin;
        const sy = cy - (x - cx) * sin + (y - cy) * cos;
        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        const fx = sx - x0;
        const fy = sy - y0;
        const px = (xx: number, yy: number) =>
          xx >= 0 && yy >= 0 && xx < width && yy < height ? gray[yy * width + xx] : background;
        const top = px(x0, y0) * (1 - fx) + px(x0 + 1, y0) * fx;
        const bottom = px(x0, y0 + 1) * (1 - fx) + px(x0 + 1, y0 + 1) * fx;
        rotated[y * width + x] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
    gray = rotated;
    const rotate = (x: number, y: number): Vec => [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos];
    for (const s of [...groundTruth, ...groundTruthPieces]) {
      [s.ax, s.ay] = rotate(s.ax, s.ay);
      [s.bx, s.by] = rotate(s.bx, s.by);
    }
  }

  return { width, height, gray, pixelsPerMeter: ppm, groundTruth, groundTruthPieces };
}

/** Expands a grayscale buffer into RGBA (for runPipeline or a canvas). */
export function grayToRgba(gray: Uint8Array, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = gray[i];
    out[i * 4 + 3] = 255;
  }
  return out;
}
