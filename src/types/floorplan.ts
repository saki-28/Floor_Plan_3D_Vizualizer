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
