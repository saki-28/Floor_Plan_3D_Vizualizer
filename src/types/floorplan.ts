/**
 * FloorPlan3D Type Definitions
 * Coordinate convention (B3 / R3 fix): world is right-handed, +Y up.
 *   x = +s·(u − u0)   image-right  → +X
 *   z = +s·(v − v0)   image-down   → +Z  (positive sign, NO mirror)
 */

export interface Point2D {
  x: number;
  z: number;
}

export interface WallSegment2D {
  id: string;
  name?: string;
  start: Point2D;
  end: Point2D;
  thickness: number;
  height: number;
  hasDoor?: boolean;
  doorPosition?: number; // 0.0 to 1.0 along segment
  doorWidth?: number;
  hasWindow?: boolean;
  windowPosition?: number;
  windowWidth?: number;
  windowSillHeight?: number;
  windowHeight?: number;
}

export interface Room2D {
  id: string;
  name: string;
  color: string;
  corners: Point2D[];
  areaSqM: number;
  type: 'living' | 'bedroom' | 'kitchen' | 'bathroom' | 'balcony' | 'corridor';
}

export interface FurnitureItem {
  id: string;
  name: string;
  type: 'bed' | 'sofa' | 'table' | 'chair' | 'counter';
  position: [number, number, number]; // x, y, z
  size: [number, number, number]; // width, height, depth
  rotationY: number; // in degrees
  color: string;
}

export interface FloorPlanDataset {
  id: string;
  name: string;
  description: string;
  difficulty: 'Clean Orthogonal' | 'Moderate (Doors/Text)' | 'Complex (Noisy Scan)' | 'Multi-Room Layout';
  widthPx: number;
  heightPx: number;
  scale: number; // meters per pixel
  u0: number;
  v0: number;
  walls: WallSegment2D[];
  rooms: Room2D[];
  furniture: FurnitureItem[];
}

export type VisionStage = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface VisionStageInfo {
  id: VisionStage;
  title: string;
  shortName: string;
  mathExplanation: string;
  opencvFunction: string;
  parameters: string;
  academicRationale: string;
}

// ---------------------------------------------------------------------------
// B2 Data Contract — Explainability types (R4)
// ---------------------------------------------------------------------------

/**
 * A detected or manually-placed wall segment.
 * Coordinates are in pixels until imageToWorld() is applied.
 */
export interface Segment2D {
  id: string;
  ax: number; ay: number; // start pixel
  bx: number; by: number; // end pixel
  thickness: number;      // pixels
  snapped?: boolean;      // true if endpoint was snapped (yellow in overlay)
  paired?: boolean;       // true if this is a paired centerline (blue in overlay)
  discarded?: boolean;    // true if dropped by merging (red in overlay)
}

/**
 * Per-stage log entry for the explainability pipeline.
 * Shown in the 7-tile mosaic as a parameter/count line.
 */
export interface VisionStageLog {
  stageId: VisionStage;
  params: Record<string, string | number>;  // e.g. { otsuThreshold: 127, kernelSize: 3 }
  counts: Record<string, number>;           // e.g. { rawLines: 412, mergedLines: 63 }
  timingMs: number;
}

/**
 * Full pipeline result carrying every intermediate image and log.
 * Matches the C++ PipelineResult struct in B2.
 * In the web prototype, images are stored as canvas ImageData or data URLs.
 */
export interface PipelineResult {
  // Intermediate stage image data (as base64 data URLs in the web prototype)
  stageImages: Partial<Record<VisionStage, string>>;
  // Detected segments at each processing stage
  rawSegments: Segment2D[];
  snappedSegments: Segment2D[];
  mergedSegments: Segment2D[];
  finalSegments: Segment2D[];
  // Per-stage logs
  stageLogs: VisionStageLog[];
  // Overall timing
  totalTimingMs: number;
}

/**
 * Scale calibration state (B2 data contract).
 * metersPerPixel is the calibrated value; calibrated=false means default heuristic.
 */
export interface ScaleCalibration {
  metersPerPixel: number;
  calibrated: boolean;  // false → shown as "UNCALIBRATED" in UI per plan requirement
  pointA?: Point2D;     // first calibration click (pixel space)
  pointB?: Point2D;     // second calibration click (pixel space)
  realDistanceMeters?: number;
}

