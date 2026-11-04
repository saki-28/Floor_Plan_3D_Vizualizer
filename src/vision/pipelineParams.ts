/**
 * Parameters and segment statistics for the image pipeline (B7).
 * No OpenCV dependency, so everything here is unit-testable directly.
 * Distances are pixels at the working resolution (after Stage 1 resizing).
 */

import type { Segment2D } from '../types/floorplan';

export const MAX_LONG_SIDE = 1600;

export interface PipelineOptions {
  /** Stage 1: longest image side after resizing. */
  maxLongSide: number;
  /** Stage 2: CLAHE contrast limit and tile grid (tiles × tiles). */
  claheClipLimit: number;
  claheTiles: number;
  /**
   * Stage 4: an optional closing before anything is erased (0 = off). Real plans often draw a
   * wall as two thin outlines with paper or hatching between them; closing with a kernel wider
   * than that gap turns the wall into one solid band, which then survives the opening.
   */
  fillKernel: number;
  /**
   * Stage 4, with the fill on: pieces of ink whose bounding box is shorter than this on both
   * sides are removed before filling, so the letters of a label are not glued into a solid bar
   * (0 = off).
   */
  clearBeforeFill: number;
  /** Stage 4: opening kernel; strokes thinner than this disappear. */
  openKernel: number;
  /** Stage 4: blobs with fewer pixels than this are dropped (text, ticks, specks). */
  minBlobArea: number;
  /**
   * Stage 4: blobs whose bounding box is shorter than this on both sides are
   * dropped too. Defaults to minLineLength: such a blob can never produce a
   * Hough line, and bold letters easily pass the area test alone.
   */
  minBlobExtent: number;
  /**
   * Stage 4: a blob shorter than 2 × minBlobExtent whose thickest stroke is
   * below this fraction of the main wall network's is treated as text or a
   * symbol. Thin and short together: thick short wall pieces still pass.
   * The reference is measured at wall corners, where it reads thicker than
   * the walls themselves, so the ratio stays well below 0.5 to keep thin
   * interior wall stubs.
   */
  textStrokeRatio: number;
  /**
   * Stage 4: a blob touching the image edge that is a long, narrow band along it (narrower than
   * this fraction of the image), or lies wholly inside the edge strips of that width, is a scan
   * margin, a page shadow, a sheet frame or a cut-off neighbour, not part of the plan (0 = off).
   * The main wall network is never removed this way.
   */
  borderMargin: number;
  /** Stage 4: closing kernel; bridges small breaks in walls. */
  closeKernel: number;
  /**
   * Stage 7: walls thinner than this fraction of the drawing's typical wall (length-weighted
   * median) are lines, not walls: dimension lines, furniture and fixture outlines (0 = off).
   */
  thinWallRatio: number;
  /**
   * Stage 7: walls joined through corners, crossings and door-sized gaps form networks; a
   * network shorter than this share of the largest one is furniture, a symbol or a stray line
   * (0 = off).
   */
  networkShare: number;
  /** Stage 6: HoughLinesP accumulator threshold, minimum length and maximum gap. */
  houghVotes: number;
  minLineLength: number;
  maxLineGap: number;
  /** Segments within this many degrees of 0° / 90° count as horizontal / vertical. */
  angleToleranceDeg: number;
}

/** The options the UI exposes as sliders. */
export type TunableKey = 'fillKernel' | 'minBlobArea' | 'closeKernel' | 'houghVotes' | 'minLineLength' | 'maxLineGap';

export function fitWithin(width: number, height: number, maxLongSide: number) {
  const scale = Math.min(1, maxLongSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

export function oddKernel(size: number): number {
  const k = Math.max(1, Math.round(size));
  return k % 2 === 1 ? k : k + 1;
}

/**
 * Concrete options for an image of the given working size. Size-dependent
 * defaults are fractions of the long side so they behave the same at any
 * resolution; at 1600 px they match the plan (close 5×5, minLen 48, gap 10).
 * Hough votes default to 2.5% of the long side rather than the plan's fixed
 * 80: 80 votes means ≥80 collinear edge pixels, which drops short walls.
 */
export function resolveOptions(
  width: number,
  height: number,
  overrides: Partial<PipelineOptions> = {},
): PipelineOptions {
  const longSide = Math.max(width, height);
  const minLineLength = overrides.minLineLength ?? Math.max(10, Math.round(longSide * 0.03));
  const resolved: PipelineOptions = {
    maxLongSide: MAX_LONG_SIDE,
    claheClipLimit: 2.0,
    claheTiles: 8,
    fillKernel: 0,
    clearBeforeFill: Math.max(6, Math.round(longSide * 0.012)),
    openKernel: 3,
    minBlobArea: Math.max(30, Math.round(width * height * 0.0003)),
    minBlobExtent: minLineLength,
    textStrokeRatio: 0.35,
    closeKernel: oddKernel(Math.max(3, longSide * 0.003)),
    borderMargin: 0.08,
    thinWallRatio: 0.4,
    networkShare: 0.1,
    houghVotes: Math.max(15, Math.round(longSide * 0.025)),
    minLineLength,
    maxLineGap: Math.max(4, Math.round(longSide * 0.006)),
    angleToleranceDeg: 5,
    ...overrides,
  };
  resolved.openKernel = oddKernel(resolved.openKernel);
  if (resolved.fillKernel > 0) resolved.fillKernel = oddKernel(resolved.fillKernel);
  resolved.closeKernel = oddKernel(resolved.closeKernel);
  return resolved;
}

/**
 * Canny hysteresis thresholds from the Otsu value: T_low = 0.5·T, T_high = T.
 * A perfectly two-tone image gives Otsu = 0, so the result is clamped to a usable floor.
 */
export function cannyThresholds(otsu: number): { low: number; high: number } {
  const high = Math.max(otsu, 50);
  return { low: high * 0.5, high };
}

/** Widest wall (in px) the two-face check treats as one wall. */
export function maxWallThicknessPx(width: number, height: number): number {
  return Math.round(Math.max(width, height) * 0.04);
}

export type Orientation = 'horizontal' | 'vertical' | 'oblique';

export function segmentLength(s: Segment2D): number {
  return Math.hypot(s.bx - s.ax, s.by - s.ay);
}

/** Angle from the horizontal axis, folded into 0–90°. */
export function segmentAngleDeg(s: Segment2D): number {
  return (Math.atan2(Math.abs(s.by - s.ay), Math.abs(s.bx - s.ax)) * 180) / Math.PI;
}

export function classifySegment(s: Segment2D, toleranceDeg: number): Orientation {
  if (segmentLength(s) < 1e-6) return 'oblique';
  const angle = segmentAngleDeg(s);
  if (angle <= toleranceDeg) return 'horizontal';
  if (angle >= 90 - toleranceDeg) return 'vertical';
  return 'oblique';
}

export interface SegmentStats {
  total: number;
  horizontal: number;
  vertical: number;
  oblique: number;
  meanLength: number;
  /** Segments overlapping a parallel segment closer than `sameEdgePx`: fragments of the same edge. */
  sameEdgeDuplicates: number;
  /** Segments with a parallel, overlapping partner a wall-thickness away: the two faces of one wall. */
  twoFaceSegments: number;
}

interface AxisSpan {
  offset: number; // y for horizontal, x for vertical
  lo: number;
  hi: number;
}

function toSpan(s: Segment2D, orientation: 'horizontal' | 'vertical'): AxisSpan {
  return orientation === 'horizontal'
    ? { offset: (s.ay + s.by) / 2, lo: Math.min(s.ax, s.bx), hi: Math.max(s.ax, s.bx) }
    : { offset: (s.ax + s.bx) / 2, lo: Math.min(s.ay, s.by), hi: Math.max(s.ay, s.by) };
}

/**
 * Counts how messy raw Hough output is. Two spans "pair up" when they are
 * parallel and overlap by at least half the shorter one; the perpendicular
 * distance then says whether they are the same edge or the two wall faces.
 */
export function summarizeSegments(
  segments: Segment2D[],
  toleranceDeg: number,
  maxWallThickness: number,
  sameEdgePx = 3,
): SegmentStats {
  const groups: Record<'horizontal' | 'vertical', AxisSpan[]> = { horizontal: [], vertical: [] };
  let oblique = 0;
  let lengthSum = 0;
  for (const s of segments) {
    lengthSum += segmentLength(s);
    const o = classifySegment(s, toleranceDeg);
    if (o === 'oblique') oblique++;
    else groups[o].push(toSpan(s, o));
  }

  let sameEdgeDuplicates = 0;
  let twoFaceSegments = 0;
  for (const spans of Object.values(groups)) {
    for (let i = 0; i < spans.length; i++) {
      let duplicate = false;
      let twoFace = false;
      for (let j = 0; j < spans.length && !(duplicate && twoFace); j++) {
        if (i === j) continue;
        const a = spans[i];
        const b = spans[j];
        const shorter = Math.min(a.hi - a.lo, b.hi - b.lo);
        const overlap = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
        if (shorter <= 0 || overlap < 0.5 * shorter) continue;
        const d = Math.abs(a.offset - b.offset);
        if (d < sameEdgePx) duplicate = true;
        else if (d <= maxWallThickness) twoFace = true;
      }
      if (duplicate) sameEdgeDuplicates++;
      if (twoFace) twoFaceSegments++;
    }
  }

  return {
    total: segments.length,
    horizontal: groups.horizontal.length,
    vertical: groups.vertical.length,
    oblique,
    meanLength: segments.length ? lengthSum / segments.length : 0,
    sameEdgeDuplicates,
    twoFaceSegments,
  };
}
