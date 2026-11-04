/**
 * Scores detected walls against ground truth by length (plan B10), so a wall found in two
 * pieces is not a miss. A point on one segment is matched when a segment of the other set runs
 * in the same direction (within `angleToleranceDeg`) and passes within `tolerancePx` of it.
 *
 *   recall    = share of the real wall length that was found
 *   precision = share of the found length that lies on a real wall
 */

import type { Segment2D } from '../types/floorplan';

export interface WallScore {
  truthLength: number;
  foundLength: number;
  recall: number;
  precision: number;
  f1: number;
  truthPieces: number;
  /** Real pieces with at least 80% of their length found. */
  piecesFound: number;
}

const segmentLength = (s: Segment2D) => Math.hypot(s.bx - s.ax, s.by - s.ay);

function directionDifferenceDeg(a: Segment2D, b: Segment2D): number {
  const angle = (s: Segment2D) => Math.atan2(s.by - s.ay, s.bx - s.ax);
  let d = Math.abs(angle(a) - angle(b)) % Math.PI;
  if (d > Math.PI / 2) d = Math.PI - d;
  return (d * 180) / Math.PI;
}

function distanceToSegment(x: number, y: number, s: Segment2D): number {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / lengthSq));
  return Math.hypot(x - (s.ax + t * dx), y - (s.ay + t * dy));
}

/** Fraction of each segment's length that lies along some segment of `against`. */
function coveredFractions(from: Segment2D[], against: Segment2D[], tolerancePx: number, angleToleranceDeg: number, step: number) {
  return from.map((s) => {
    const len = segmentLength(s);
    const samples = Math.max(1, Math.ceil(len / step));
    const candidates = against.filter((a) => directionDifferenceDeg(s, a) <= angleToleranceDeg);
    let covered = 0;
    for (let i = 0; i < samples; i++) {
      const t = (i + 0.5) / samples;
      const x = s.ax + (s.bx - s.ax) * t;
      const y = s.ay + (s.by - s.ay) * t;
      if (candidates.some((a) => distanceToSegment(x, y, a) <= tolerancePx)) covered++;
    }
    return { length: len, fraction: covered / samples };
  });
}

export function scoreWalls(
  found: Segment2D[],
  truth: Segment2D[],
  { tolerancePx = 6, angleToleranceDeg = 5, step = 2 }: { tolerancePx?: number; angleToleranceDeg?: number; step?: number } = {},
): WallScore {
  const truthCoverage = coveredFractions(truth, found, tolerancePx, angleToleranceDeg, step);
  const foundCoverage = coveredFractions(found, truth, tolerancePx, angleToleranceDeg, step);
  const truthLength = truthCoverage.reduce((sum, c) => sum + c.length, 0);
  const foundLength = foundCoverage.reduce((sum, c) => sum + c.length, 0);
  const recall = truthLength ? truthCoverage.reduce((sum, c) => sum + c.length * c.fraction, 0) / truthLength : 0;
  const precision = foundLength ? foundCoverage.reduce((sum, c) => sum + c.length * c.fraction, 0) / foundLength : 0;
  return {
    truthLength,
    foundLength,
    recall,
    precision,
    f1: recall + precision ? (2 * recall * precision) / (recall + precision) : 0,
    truthPieces: truth.length,
    piecesFound: truthCoverage.filter((c) => c.fraction >= 0.8).length,
  };
}
