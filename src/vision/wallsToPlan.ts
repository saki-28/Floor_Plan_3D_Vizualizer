/**
 * Turns detected walls (pixel centerlines) into a FloorPlanDataset the 3D viewer can show,
 * using the pixel → world mapping of B3 (x = s·(u − u0), z = s·(v − v0), no mirroring) with the
 * walls' bounding-box centre as (u0, v0). One floor slab covers the walls' bounding box.
 * A scan's measured skew can be passed to straighten the building before it is mapped.
 */

import type { FloorPlanDataset, Segment2D } from '../types/floorplan';
import { imageToWorld } from '../utils/geometryEngine';

/** Typical wall thickness, used to guess the scale of an image nobody has calibrated. */
export const ASSUMED_WALL_THICKNESS_M = 0.2;

/** Metres per pixel when the image's scale is unknown: the median wall is taken as 0.2 m thick. */
export function guessMetersPerPixel(walls: Segment2D[]): number {
  const thicknesses = walls.map((w) => w.thickness).filter((t) => t > 0).sort((a, b) => a - b);
  const median = thicknesses.length ? thicknesses[Math.floor(thicknesses.length / 2)] : 10;
  return ASSUMED_WALL_THICKNESS_M / median;
}

export function wallsToPlan(
  walls: Segment2D[],
  metersPerPixel: number,
  {
    name,
    width,
    height,
    height3d = 2.8,
    skewDeg = 0,
  }: { name: string; width: number; height: number; height3d?: number; skewDeg?: number },
): FloorPlanDataset {
  if (skewDeg !== 0) {
    // Rotate by −skew about the image centre so the walls are axis-aligned in 3D.
    const t = (-skewDeg * Math.PI) / 180;
    const rotate = (x: number, y: number): [number, number] => [
      width / 2 + (x - width / 2) * Math.cos(t) - (y - height / 2) * Math.sin(t),
      height / 2 + (x - width / 2) * Math.sin(t) + (y - height / 2) * Math.cos(t),
    ];
    walls = walls.map((w) => {
      const [ax, ay] = rotate(w.ax, w.ay);
      const [bx, by] = rotate(w.bx, w.by);
      return { ...w, ax, ay, bx, by };
    });
  }
  const us = walls.flatMap((w) => [w.ax, w.bx]);
  const vs = walls.flatMap((w) => [w.ay, w.by]);
  const u0 = walls.length ? (Math.min(...us) + Math.max(...us)) / 2 : width / 2;
  const v0 = walls.length ? (Math.min(...vs) + Math.max(...vs)) / 2 : height / 2;
  const config = { scale: metersPerPixel, u0, v0 };

  const worldWalls = walls.map((w, i) => ({
    id: `detected-${i + 1}`,
    name: `Detected wall ${i + 1}`,
    start: imageToWorld(w.ax, w.ay, config),
    end: imageToWorld(w.bx, w.by, config),
    thickness: w.thickness * metersPerPixel,
    height: height3d,
  }));

  const corners = walls.length
    ? [
        imageToWorld(Math.min(...us), Math.min(...vs), config),
        imageToWorld(Math.max(...us), Math.min(...vs), config),
        imageToWorld(Math.max(...us), Math.max(...vs), config),
        imageToWorld(Math.min(...us), Math.max(...vs), config),
      ]
    : [];
  const floorArea = corners.length ? Math.abs(corners[2].x - corners[0].x) * Math.abs(corners[2].z - corners[0].z) : 0;

  return {
    id: 'detected',
    name,
    description: 'Walls detected from an image by the OpenCV.js pipeline.',
    difficulty: 'Complex (Noisy Scan)',
    widthPx: width,
    heightPx: height,
    scale: metersPerPixel,
    u0,
    v0,
    walls: worldWalls,
    openings: [],
    rooms: corners.length
      ? [{ id: 'detected-floor', name: 'Floor', color: '#9aa4a9', corners, areaSqM: Math.round(floorArea * 10) / 10, type: 'living' }]
      : [],
    furniture: [],
  };
}
