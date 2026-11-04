/**
 * Wall-mask scoring (plan B10; the metric of Cambeiro Barreiro et al. 2023): draw the true and
 * the found walls as filled shapes on the same pixel grid and compare them pixel by pixel.
 *
 *   IoU       = overlap / (true ∪ found)
 *   precision = overlap / found      (how much of what was found is wall)
 *   recall    = overlap / true       (how much of the wall was found)
 */

import type { Segment2D } from '../types/floorplan';

export type Point = [number, number];

/** Fills a polygon into a mask by scanlines (even-odd rule, sampled at pixel centres). */
export function fillPolygon(mask: Uint8Array, width: number, height: number, points: Point[], value = 1): void {
  if (points.length < 3) return;
  const ys = points.map((p) => p[1]);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(height - 1, Math.ceil(Math.max(...ys)));
  const crossings: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    crossings.length = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      if (yi > cy !== yj > cy) crossings.push(xi + ((cy - yi) * (xj - xi)) / (yj - yi));
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const xa = Math.max(0, Math.ceil(crossings[k] - 0.5));
      const xb = Math.min(width - 1, Math.floor(crossings[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) mask[y * width + x] = value;
    }
  }
}

/** A wall centerline as its footprint: ± half the thickness, ends extended by half the thickness to fill corners. */
export function wallFootprint(wall: Segment2D): Point[] {
  const dx = wall.bx - wall.ax;
  const dy = wall.by - wall.ay;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return [];
  const half = Math.max(0.5, wall.thickness / 2);
  const ux = (dx / length) * half;
  const uy = (dy / length) * half;
  const nx = -uy;
  const ny = ux;
  const ax = wall.ax - ux;
  const ay = wall.ay - uy;
  const bx = wall.bx + ux;
  const by = wall.by + uy;
  return [
    [ax + nx, ay + ny],
    [bx + nx, by + ny],
    [bx - nx, by - ny],
    [ax - nx, ay - ny],
  ];
}

export function wallsMask(walls: Segment2D[], width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (const wall of walls) fillPolygon(mask, width, height, wallFootprint(wall));
  return mask;
}

export function polygonsMask(polygons: Point[][], width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (const points of polygons) fillPolygon(mask, width, height, points);
  return mask;
}

export interface MaskScore {
  iou: number;
  precision: number;
  recall: number;
  truthPixels: number;
  foundPixels: number;
  overlapPixels: number;
}

export function scoreMasks(truth: Uint8Array, found: Uint8Array): MaskScore {
  let truthPixels = 0;
  let foundPixels = 0;
  let overlapPixels = 0;
  for (let i = 0; i < truth.length; i++) {
    const t = truth[i] > 0;
    const f = found[i] > 0;
    if (t) truthPixels++;
    if (f) foundPixels++;
    if (t && f) overlapPixels++;
  }
  const union = truthPixels + foundPixels - overlapPixels;
  return {
    iou: union ? overlapPixels / union : 1,
    precision: foundPixels ? overlapPixels / foundPixels : 0,
    recall: truthPixels ? overlapPixels / truthPixels : 0,
    truthPixels,
    foundPixels,
    overlapPixels,
  };
}
