/**
 * Stage 7 (plan B7): turns raw Hough segments into walls.
 *
 *   1. Deskew: estimate the drawing's rotation from the near-axis segments (length-weighted median)
 *      and work in a frame where the walls are axis-aligned.
 *   2. Angle snap: segments within ±tolerance of 0° or 90° become exactly horizontal or vertical;
 *      the rest are set aside for review instead of being silently dropped.
 *   3. Collinear merge: fragments of one edge (same orientation, nearly the same offset) are joined
 *      where their intervals overlap or nearly touch.
 *   4. Face pairing: two parallel lines a wall-thickness apart that overlap, with ink between them,
 *      are the two faces of one wall; their overlap becomes a centerline with that thickness.
 *   5. Centerline merge: pieces of one wall are joined across short gaps (where a joining wall
 *      interrupts a face) and, with the mask, across any gap that is ink all along the centerline:
 *      probabilistic Hough often misses part of a face, but the wall is still there. Door and
 *      window openings have no ink on the centerline and stay open.
 *   6. Growth: with the mask, each end grows along its centerline while there is ink, so ends
 *      reach into corners even where both faces were missed.
 *   7. Junctions: an end close to a perpendicular wall extends or trims to that wall's centerline,
 *      closing corners and T-junctions.
 *   8. Wall-likeness: walls much thinner than the drawing's typical wall are lines (dimensions,
 *      furniture outlines); walls that are not part of a sizeable network of walls joined through
 *      corners, crossings and door-sized gaps are furniture, symbols or stray lines.
 *
 * Pure TypeScript on segments plus an optional ink sampler, so it is unit-testable without OpenCV.
 * Distances are pixels at the working resolution.
 */

import type { Segment2D } from '../types/floorplan';

export interface VectorizeOptions {
  width: number;
  height: number;
  angleToleranceDeg: number;
  /** Fragments whose offsets differ by less than this are one line. */
  offsetTolerance: number;
  /** Collinear fragments this close along the axis are joined. */
  mergeGap: number;
  /** Thinnest and thickest wall the face pairing accepts. */
  minThickness: number;
  maxThickness: number;
  /** How far beyond a perpendicular wall's face an end may be and still snap to it. */
  snapRadius: number;
  minWallLength: number;
  /** Walls thinner than this fraction of the length-weighted median thickness are dropped (0 = off). */
  thinWallRatio?: number;
  /** Networks shorter than this share of the largest network are dropped (0 = off). */
  networkShare?: number;
  /** Widest gap (a door or window) across which two collinear walls still count as one network. */
  maxOpening?: number;
  /** Reads the cleaned mask in image coordinates; when given, a pair needs ink between its faces. */
  isInk?: (x: number, y: number) => boolean;
}

export function defaultVectorizeOptions(
  width: number,
  height: number,
  minWallLength: number,
  maxThickness: number,
): VectorizeOptions {
  const longSide = Math.max(width, height);
  return {
    width,
    height,
    angleToleranceDeg: 5,
    offsetTolerance: Math.max(3, Math.round(longSide * 0.004)),
    mergeGap: Math.max(6, Math.round(longSide * 0.008)),
    minThickness: 3,
    maxThickness,
    snapRadius: Math.max(6, Math.round(longSide * 0.01)),
    minWallLength,
    maxOpening: Math.round(longSide * 0.08),
  };
}

type Axis = 'h' | 'v';

/** An axis-aligned line in the deskewed frame: y = offset for 'h', x = offset for 'v'. */
interface Line {
  axis: Axis;
  offset: number;
  lo: number;
  hi: number;
}

interface WallLine extends Line {
  thickness: number;
}

export interface VectorizeCounts {
  input: number;
  snapped: number;
  setAside: number;
  lines: number;
  facePairs: number;
  singleFaces: number;
  walls: number;
  junctions: number;
  droppedThin: number;
  droppedStray: number;
}

export interface VectorizeResult {
  /** Wall centerlines in image pixels; thickness in pixels. */
  walls: Segment2D[];
  /** Raw segments too far from horizontal or vertical, kept for review. */
  setAside: Segment2D[];
  skewDeg: number;
  counts: VectorizeCounts;
}

const length = (s: Segment2D) => Math.hypot(s.bx - s.ax, s.by - s.ay);

/** Where across a face pair the ink is tested, as fractions of its thickness from the middle. */
const BAND_SAMPLES = [-0.3, 0, 0.3];

/** Signed deviation from the nearest axis, in degrees (−45, 45]. */
function axisDeviation(s: Segment2D): number {
  let angle = (Math.atan2(s.by - s.ay, s.bx - s.ax) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  if (angle > 45) angle -= 90;
  if (angle < -45) angle += 90;
  return angle;
}

/** Length-weighted median deviation of the near-axis segments: the drawing's rotation. */
export function estimateSkew(segments: Segment2D[], toleranceDeg: number): number {
  const samples = segments
    .map((s) => ({ angle: axisDeviation(s), weight: length(s) }))
    .filter((s) => s.weight > 0 && Math.abs(s.angle) <= toleranceDeg)
    .sort((a, b) => a.angle - b.angle);
  const total = samples.reduce((sum, s) => sum + s.weight, 0);
  if (total === 0) return 0;
  let running = 0;
  for (const s of samples) {
    running += s.weight;
    if (running >= total / 2) return Math.abs(s.angle) < 0.2 ? 0 : s.angle;
  }
  return 0;
}

export function vectorizeWalls(segments: Segment2D[], options: VectorizeOptions): VectorizeResult {
  const {
    width,
    height,
    angleToleranceDeg,
    offsetTolerance,
    mergeGap,
    minThickness,
    maxThickness,
    snapRadius,
    minWallLength,
    thinWallRatio = 0,
    networkShare = 0,
    maxOpening = Math.round(Math.max(width, height) * 0.08),
    isInk,
  } = options;
  const skewDeg = estimateSkew(segments, angleToleranceDeg);
  const cx = width / 2;
  const cy = height / 2;
  const rotate = (x: number, y: number, deg: number): [number, number] => {
    const t = (deg * Math.PI) / 180;
    const c = Math.cos(t);
    const s = Math.sin(t);
    return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
  };
  /** A point on an axis-aligned line of the deskewed frame, back in image coordinates. */
  const toImage = (axis: Axis, offset: number, along: number) =>
    axis === 'h' ? rotate(along, offset, skewDeg) : rotate(offset, along, skewDeg);

  // 1–2. Deskew and snap.
  const snapped: Line[] = [];
  const setAside: Segment2D[] = [];
  for (const s of segments) {
    const [ax, ay] = rotate(s.ax, s.ay, -skewDeg);
    const [bx, by] = rotate(s.bx, s.by, -skewDeg);
    const deviation = axisDeviation({ ...s, ax, ay, bx, by });
    if (Math.abs(deviation) > angleToleranceDeg) {
      setAside.push(s);
      continue;
    }
    const horizontal = Math.abs(bx - ax) >= Math.abs(by - ay);
    snapped.push(
      horizontal
        ? { axis: 'h', offset: (ay + by) / 2, lo: Math.min(ax, bx), hi: Math.max(ax, bx) }
        : { axis: 'v', offset: (ax + bx) / 2, lo: Math.min(ay, by), hi: Math.max(ay, by) },
    );
  }

  // 3. Collinear merge.
  const lines = (['h', 'v'] as Axis[]).flatMap((axis) =>
    mergeCollinear(
      snapped.filter((l) => l.axis === axis),
      offsetTolerance,
      (current, next) => next.lo <= current.hi + mergeGap,
    ),
  );

  // 4. Face pairing.
  const inkFraction = (axis: Axis, offset: number, lo: number, hi: number) => {
    if (!isInk) return 1;
    const samples = Math.max(5, Math.floor((hi - lo) / 4));
    let ink = 0;
    for (let i = 0; i < samples; i++) {
      const [x, y] = toImage(axis, offset, lo + ((i + 0.5) * (hi - lo)) / samples);
      if (isInk(x, y)) ink++;
    }
    return ink / samples;
  };
  const centerlines: WallLine[] = [];
  let facePairs = 0;
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i];
      const b = lines[j];
      if (a.axis !== b.axis) continue;
      const thickness = Math.abs(a.offset - b.offset);
      if (thickness < minThickness || thickness > maxThickness) continue;
      const lo = Math.max(a.lo, b.lo);
      const hi = Math.min(a.hi, b.hi);
      const overlap = hi - lo;
      if (overlap < 0.5 * Math.min(a.hi - a.lo, b.hi - b.lo) || overlap < minWallLength / 2) continue;
      const offset = (a.offset + b.offset) / 2;
      // A wall is solid from face to face: test the middle and both sides of it, not only the
      // centerline, or two lines of a tiled floor or a stair pair up around the line between them.
      if (BAND_SAMPLES.some((f) => inkFraction(a.axis, offset + f * thickness, lo, hi) < 0.8)) continue;
      centerlines.push({ axis: a.axis, offset, lo, hi, thickness });
      facePairs++;
    }
  }

  // 4b. Single faces: where Hough found only one face of a wall (common on thin, rotated walls),
  //     the mask tells which side the wall is on and how thick it is: walk away from the face on
  //     both sides; a wall has a run of ink of plausible thickness on one side and paper on the
  //     other. Faces that were also paired yield the same centerline and merge away in step 5.
  let singleFaces = 0;
  if (isInk) {
    for (const line of lines) {
      const samples = Math.max(5, Math.floor((line.hi - line.lo) / 4));
      for (const side of [1, -1]) {
        const runs: number[] = [];
        for (let i = 0; i < samples; i++) {
          const along = line.lo + ((i + 0.5) * (line.hi - line.lo)) / samples;
          const inkAt = (d: number) => isInk(...toImage(line.axis, line.offset + side * d, along));
          if (inkAt(-2)) continue; // ink on both sides: not a face here
          let run = 0;
          while (run <= maxThickness + 1 && inkAt(run + 1)) run++;
          if (run >= minThickness && run <= maxThickness) runs.push(run);
        }
        if (runs.length < 0.6 * samples) continue;
        runs.sort((a, b) => a - b);
        const run = runs[Math.floor(runs.length / 2)];
        centerlines.push({ axis: line.axis, offset: line.offset + (side * (run + 1)) / 2, lo: line.lo, hi: line.hi, thickness: run + 0.5 });
        singleFaces++;
        break;
      }
    }
  }

  // 5. Centerline merge: one wall's pieces, across gaps up to 1.5× its thickness (a joining wall)
  //    or across longer gaps that are ink all along the centerline.
  const maxBridge = Math.round(Math.max(width, height) * 0.25);
  const joinWall = (current: WallLine, next: WallLine) => {
    const gap = next.lo - current.hi;
    if (gap <= Math.max(mergeGap, 1.5 * current.thickness)) return true;
    return !!isInk && gap <= maxBridge && inkFraction(current.axis, (current.offset + next.offset) / 2, current.hi, next.lo) >= 0.9;
  };
  const mergeWalls = (pieces: WallLine[]) =>
    (['h', 'v'] as Axis[]).flatMap((axis) =>
      mergeCollinear(
        pieces.filter((l) => l.axis === axis),
        Math.max(offsetTolerance, minThickness),
        joinWall,
      ),
    );
  let walls = mergeWalls(centerlines);

  // 6. Growth: extend each end along the centerline while it stays on ink, then merge again in
  //    case two pieces now meet.
  if (isInk) {
    const maxGrow = Math.round(Math.max(width, height) * 0.1);
    for (const wall of walls) {
      for (const [end, step] of [['lo', -1], ['hi', 1]] as const) {
        let grown = 0;
        while (grown < maxGrow) {
          const [x, y] = toImage(wall.axis, wall.offset, wall[end] + step);
          if (!isInk(x, y)) break;
          wall[end] += step;
          grown++;
        }
      }
    }
    walls = mergeWalls(walls);
  }

  // 7. Junctions: snap each end to the nearest perpendicular centerline within reach.
  let junctions = 0;
  for (const wall of walls) {
    for (const end of ['lo', 'hi'] as const) {
      let best: WallLine | null = null;
      let bestDistance = Infinity;
      for (const other of walls) {
        if (other.axis === wall.axis) continue;
        const reach = snapRadius + other.thickness / 2 + wall.thickness / 2;
        const distance = Math.abs(other.offset - wall[end]);
        if (distance > reach || distance >= bestDistance) continue;
        if (wall.offset < other.lo - reach || wall.offset > other.hi + reach) continue;
        best = other;
        bestDistance = distance;
      }
      if (best) {
        wall[end] = best.offset;
        junctions++;
      }
    }
  }

  let kept = walls.filter((w) => w.hi - w.lo >= minWallLength);

  // 8a. Thin lines: the typical wall is the length-weighted median thickness.
  let droppedThin = 0;
  if (thinWallRatio > 0 && kept.length) {
    const typical = weightedMedian(kept.map((w) => [w.thickness, w.hi - w.lo]));
    const before = kept.length;
    kept = kept.filter((w) => w.thickness >= thinWallRatio * typical);
    droppedThin = before - kept.length;
  }

  // 8b. Networks: union walls that meet, cross, or continue each other across a door-sized gap.
  let droppedStray = 0;
  if (networkShare > 0 && kept.length) {
    const parent = kept.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const linked = (a: WallLine, b: WallLine) => {
      if (a.axis !== b.axis) {
        const reach = snapRadius + (a.thickness + b.thickness) / 2;
        return a.offset >= b.lo - reach && a.offset <= b.hi + reach && b.offset >= a.lo - reach && b.offset <= a.hi + reach;
      }
      const apart = Math.abs(a.offset - b.offset);
      const gap = Math.max(a.lo, b.lo) - Math.min(a.hi, b.hi);
      return apart <= Math.max(offsetTolerance, (a.thickness + b.thickness) / 2) && gap <= maxOpening;
    };
    for (let i = 0; i < kept.length; i++) {
      for (let j = i + 1; j < kept.length; j++) {
        if (linked(kept[i], kept[j])) parent[find(i)] = find(j);
      }
    }
    const networkLength = new Map<number, number>();
    kept.forEach((w, i) => networkLength.set(find(i), (networkLength.get(find(i)) ?? 0) + (w.hi - w.lo)));
    const largest = Math.max(...networkLength.values());
    const before = kept.length;
    kept = kept.filter((_, i) => networkLength.get(find(i))! >= networkShare * largest);
    droppedStray = before - kept.length;
  }
  const result: Segment2D[] = kept.map((w, i) => {
    const [ax, ay] = toImage(w.axis, w.offset, w.lo);
    const [bx, by] = toImage(w.axis, w.offset, w.hi);
    return { id: `wall-${i + 1}`, ax, ay, bx, by, thickness: w.thickness };
  });

  return {
    walls: result,
    setAside,
    skewDeg,
    counts: {
      input: segments.length,
      snapped: snapped.length,
      setAside: setAside.length,
      lines: lines.length,
      facePairs,
      singleFaces,
      walls: result.length,
      junctions,
      droppedThin,
      droppedStray,
    },
  };
}

/** The value at which half the total weight is reached, for [value, weight] pairs. */
function weightedMedian(pairs: [number, number][]): number {
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((sum, [, w]) => sum + w, 0);
  let running = 0;
  for (const [value, w] of sorted) {
    running += w;
    if (running >= total / 2) return value;
  }
  return sorted.length ? sorted[sorted.length - 1][0] : 0;
}

/**
 * Groups lines of one axis by offset (chaining neighbours closer than `offsetTolerance`), then
 * walks each group along the axis joining the next piece into the current one when they overlap
 * or `join(current, next)` allows it. Offsets and thicknesses of joined pieces are
 * length-weighted means.
 */
function mergeCollinear<T extends Line>(lines: T[], offsetTolerance: number, join: (current: T, next: T) => boolean): T[] {
  const sorted = [...lines].sort((a, b) => a.offset - b.offset);
  const groups: T[][] = [];
  for (const line of sorted) {
    const group = groups[groups.length - 1];
    if (group && line.offset - group[group.length - 1].offset <= offsetTolerance) group.push(line);
    else groups.push([line]);
  }

  const merged: T[] = [];
  for (const group of groups) {
    group.sort((a, b) => a.lo - b.lo);
    let current: T | null = null;
    let weight = 0;
    for (const line of group) {
      const lineWeight = Math.max(1, line.hi - line.lo);
      if (current && (line.lo <= current.hi || join(current, line))) {
        const total = weight + lineWeight;
        current.offset = (current.offset * weight + line.offset * lineWeight) / total;
        if ('thickness' in current) {
          const c = current as unknown as WallLine;
          c.thickness = (c.thickness * weight + (line as unknown as WallLine).thickness * lineWeight) / total;
        }
        current.hi = Math.max(current.hi, line.hi);
        weight = total;
      } else {
        if (current) merged.push(current);
        current = { ...line };
        weight = lineWeight;
      }
    }
    if (current) merged.push(current);
  }
  return merged;
}
