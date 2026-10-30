import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FloorPlanDataset, VisionStage, VisionStageInfo, WallSegment2D } from '../types/floorplan';
import {
  Layers,
  ChevronRight,
  ChevronLeft,
  Info,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Move,
  Plus,
  Trash2,
  Eye,
  Sparkles,
  Grid,
  Clock,
  BarChart2,
} from 'lucide-react';

interface CVVisualizerProps {
  floorplan: FloorPlanDataset;
  walls: WallSegment2D[];
  onUpdateWalls: (walls: WallSegment2D[]) => void;
  selectedWallId: string | null;
  onSelectWall: (wallId: string | null) => void;
}

// Simulated per-stage pipeline log (mirrors the C++ PipelineResult log)
interface StageLog {
  stageId: VisionStage;
  label: string;
  params: string;
  counts: string;
  timingMs: number;
}

function buildPipelineLogs(walls: WallSegment2D[], floorplan: FloorPlanDataset): StageLog[] {
  const n = walls.length;
  const rawHough = n * 4 + 18;  // simulate raw Hough fragment count
  const merged = n * 2 + 4;     // after collinear merge
  const paired = n;              // after parallel-edge pairing
  return [
    { stageId: 1, label: 'Load & Resize', params: `longest side ≤ 1600px, deskew: off`, counts: `${floorplan.widthPx}×${floorplan.heightPx}px → ready`, timingMs: 12 },
    { stageId: 2, label: 'Grayscale + CLAHE', params: 'clip=2.0, tiles=8×8', counts: 'channels: 3→1, 8-bit intensity', timingMs: 8 },
    { stageId: 3, label: 'Otsu Binarization', params: 'THRESH_BINARY_INV | THRESH_OTSU', counts: `auto-threshold t=142, foreground pixels: ~${Math.round(n * 1200)}`, timingMs: 5 },
    { stageId: 4, label: 'Morph Cleanup', params: 'open(3×3) → close(5×5) → CC filter', counts: `text blobs removed: 23, wall blobs kept: ${n + 2}`, timingMs: 18 },
    { stageId: 5, label: 'Canny Edges', params: 'T_low=0.5·Otsu=71, T_high=Otsu=142', counts: `edge pixels: ~${Math.round(n * 280)}`, timingMs: 22 },
    { stageId: 6, label: 'HoughLinesP', params: 'rho=1, theta=1°, thresh=80, minLen=~3%', counts: `raw fragments: ${rawHough} → after angle-snap kept: ${merged + 8}, discarded: ${rawHough - merged - 8}`, timingMs: 35 },
    { stageId: 7, label: 'Orthogonal Vectorization', params: 'snap±5°, offset±6px, gap≤12px, pair t∈[0.10,0.40]', counts: `${rawHough} raw → ${merged} merged → ${paired} centerlines (paired), ${merged - paired} unpaired`, timingMs: 14 },
  ];
}

const VISION_STAGES: VisionStageInfo[] = [
  {
    id: 1,
    title: 'Stage 1: Original Floor-Plan Image',
    shortName: '1. Original Image',
    mathExplanation: 'Input RGB image matrix I_{RGB}(u, v) \\in \\mathbb{R}^{H \\times W \\times 3}. Contains walls, door swings, dimension strings, and annotations.',
    opencvFunction: 'cv::imread(filepath, cv::IMREAD_COLOR);',
    parameters: 'Format: PNG/JPEG, Resolution: 800x600, Color space: BGR',
    academicRationale: 'Establishes the raw input coordinate frame where (u=0, v=0) is at top-left. Provides ground-truth benchmark image for visual alignment.',
  },
  {
    id: 2,
    title: 'Stage 2: Grayscale Normalization',
    shortName: '2. Grayscale',
    mathExplanation: 'Luminance conversion formula: Y(u, v) = 0.299 \\cdot R + 0.587 \\cdot G + 0.114 \\cdot B. Reduces 3 color channels to single 8-bit intensity matrix [0..255].',
    opencvFunction: 'cv::cvtColor(imgOriginal, imgGray, cv::COLOR_BGR2GRAY);',
    parameters: 'Output depth: CV_8UC1 (values 0-255)',
    academicRationale: 'Floor plan wall boundaries are defined by tonal contrast rather than chromatic information. Removing color simplifies downstream thresholding.',
  },
  {
    id: 3,
    title: 'Stage 3: Binary Thresholding (Otsu)',
    shortName: '3. Thresholding',
    mathExplanation: 'Otsu binarization minimizes intra-class variance: \\sigma_w^2(t) = \\omega_0(t)\\sigma_0^2(t) + \\omega_1(t)\\sigma_1^2(t). B(u, v) = 255 \\text{ if } Y(u, v) \\ge t \\text{ else } 0.',
    opencvFunction: 'cv::threshold(imgGray, imgBinary, 0, 255, cv::THRESH_BINARY_INV | cv::THRESH_OTSU);',
    parameters: 'Threshold type: THRESH_BINARY_INV (Walls become foreground 255, background 0)',
    academicRationale: 'Isolates dark structural ink from white paper background without requiring hardcoded manual luminance cutoffs.',
  },
  {
    id: 4,
    title: 'Stage 4: Morphological Filtering',
    shortName: '4. Noise Filtering',
    mathExplanation: 'Opening: (B \\ominus K) \\oplus K removes thin dimension text. Closing: (B \\oplus K) \\ominus K connects fragmented wall segments. Connected-component area filter drops text/tick remnants.',
    opencvFunction: 'cv::morphologyEx(imgBinary, imgOpened, cv::MORPH_OPEN, kernel3x3);\ncv::morphologyEx(imgOpened, imgClosed, cv::MORPH_CLOSE, kernel5x5);\ncv::connectedComponentsWithStats(imgClosed, labels, stats, centroids);',
    parameters: 'Opening kernel: 3x3 rect. Closing kernel: ~5x5. CC area filter: drop components below min area threshold.',
    academicRationale: 'Architectural drawings contain fine dimension tick marks, text, and hatching. Opening strips thin features; closing bridges door gaps; CC filter removes text blobs that survive morphology.',
  },
  {
    id: 5,
    title: 'Stage 5: Canny Edge Detection',
    shortName: '5. Canny Edges',
    mathExplanation: 'Gradient magnitude G = \\sqrt{G_x^2 + G_y^2} via Sobel kernels. Non-maximum suppression followed by hysteresis thresholding: T_{low} = 0.5 \\cdot T_{Otsu}, T_{high} = T_{Otsu}.',
    opencvFunction: 'cv::Canny(imgFiltered, imgEdges, 0.5*otsuThresh, otsuThresh, 3);',
    parameters: 'T_low = 0.5·Otsu, T_high = Otsu (auto-derived from Stage 3), ApertureSize: 3',
    academicRationale: 'Thresholds derived from the Otsu value adapt to each image\'s ink density. Detects sharp 1-pixel wide continuous boundaries corresponding to inner and outer wall faces.',
  },
  {
    id: 6,
    title: 'Stage 6: Hough Line & Wall Candidates',
    shortName: '6. Candidate Extraction',
    mathExplanation: 'Probabilistic Hough Transform accumulator: \\rho = u \\cos(\\theta) + v \\sin(\\theta). Filters lines with \\theta \\approx 0^\\circ \\text{ or } 90^\\circ within \\pm 5^\\circ tolerance.',
    opencvFunction: 'std::vector<cv::Vec4i> lines;\ncv::HoughLinesP(imgEdges, lines, 1, CV_PI/180, 80, minLen, 10);',
    parameters: 'rho: 1px, theta: 1 deg, threshold: 80, minLineLength: ~3% of long side, maxLineGap: 10px',
    academicRationale: 'Converts raster edge pixels into discrete mathematical line segments (u1, v1) -> (u2, v2). Orthogonal snapping enforces architectural realism. HoughLinesP returns hundreds of overlapping fragments — Stage 7 merges them.',
  },
  {
    id: 7,
    title: 'Stage 7: Orthogonal Vectorization & Manual Correction',
    shortName: '7. Final 2D Layout',
    mathExplanation: 'Coordinate transformation (B3, R3 fix — NO mirroring): x = +s \\cdot (u - u_0),\\ z = +s \\cdot (v - v_0). Stage 7 algorithm: (1) Angle snap ±5° → 0°/90°. (2) Cluster by orientation. (3) Cluster by perpendicular offset (5–8px). (4) Merge collinear intervals. (5) Parallel-edge pairing → centerline + thickness. (6) Endpoint snapping. Overlay: green=kept, red=discarded, yellow=snapped, blue=paired centerline.',
    opencvFunction: '// C++ Stage 7: angleSnap → clusterByOffset → mergeIntervals → pairEdges → snapEndpoints\nWallSegment2D wall = mapPixelsToWorld(centerline, scale, u0, v0);',
    parameters: 'Angle tolerance: ±5°. Offset tolerance: 5–8px. Merge gap: 10–15px. Pair range: t_min..t_max. Snap radius: ~10px.',
    academicRationale: 'Solves the "two lines per wall" problem from HoughLinesP. Parallel-edge pairing extracts the wall centerline and thickness in one pass. Manual correction with undo/redo provides the human-in-the-loop fallback required by the abstract.',
  },
];

export const CVVisualizer: React.FC<CVVisualizerProps> = ({
  floorplan,
  walls,
  onUpdateWalls,
  selectedWallId,
  onSelectWall,
}) => {
  const [currentStage, setCurrentStage] = useState<VisionStage>(1);
  const [viewMode, setViewMode] = useState<'single' | 'mosaic' | 'log'>('single');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mosaicRef = useRef<HTMLCanvasElement | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [compareStage, setCompareStage] = useState<VisionStage>(7);

  // Manual editing state for Stage 7
  const [draggingVertex, setDraggingVertex] = useState<{ wallId: string; isStart: boolean } | null>(null);

  const stageInfo = VISION_STAGES.find((s) => s.id === currentStage) || VISION_STAGES[0];
  const pipelineLogs = buildPipelineLogs(walls, floorplan);

  // Draw 2D canvas representation based on active stage
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Helper: world coords → canvas pixels  (R3 fix: positive z sign)
    const toPx = (x: number, z: number): [number, number] => {
      const u =  x / floorplan.scale + floorplan.u0;
      const v = +z / floorplan.scale + floorplan.v0;  // ← positive sign (R3 fix)
      const scaleX = w / floorplan.widthPx;
      const scaleY = h / floorplan.heightPx;
      return [u * scaleX, v * scaleY];
    };

    // Helper: canvas pixels → world coords  (R3 fix: positive z sign)
    // (kept for completeness; used by mouse handlers)
    // const toWorld = (px: number, py: number): [number, number] => {
    //   const u = (px / w) * floorplan.widthPx;
    //   const v = (py / h) * floorplan.heightPx;
    //   return [floorplan.scale * (u - floorplan.u0), +floorplan.scale * (v - floorplan.v0)];
    // };

    const renderStageGraphic = (stageNum: VisionStage, context: CanvasRenderingContext2D) => {
      // 1. Background
      if (stageNum === 1) {
        // Original floorplan drawing (Clean CAD Blueprint / White Architectural Paper)
        context.fillStyle = '#f8fafc';
        context.fillRect(0, 0, w, h);

        // Grid lines
        context.strokeStyle = '#e2e8f0';
        context.lineWidth = 1;
        for (let x = 0; x < w; x += 40) {
          context.beginPath(); context.moveTo(x, 0); context.lineTo(x, h); context.stroke();
        }
        for (let y = 0; y < h; y += 40) {
          context.beginPath(); context.moveTo(0, y); context.lineTo(w, y); context.stroke();
        }

        // Room color washes
        for (const r of floorplan.rooms) {
          if (r.corners.length < 3) continue;
          context.beginPath();
          const [p0x, p0y] = toPx(r.corners[0].x, r.corners[0].z);
          context.moveTo(p0x, p0y);
          for (let i = 1; i < r.corners.length; i++) {
            const [px, py] = toPx(r.corners[i].x, r.corners[i].z);
            context.lineTo(px, py);
          }
          context.closePath();
          context.fillStyle = r.color + '22'; // 15% opacity
          context.fill();

          // Room label
          const [cx, cy] = toPx(
            r.corners.reduce((sum, c) => sum + c.x, 0) / r.corners.length,
            r.corners.reduce((sum, c) => sum + c.z, 0) / r.corners.length
          );
          context.font = 'bold 12px sans-serif';
          context.fillStyle = '#475569';
          context.textAlign = 'center';
          context.fillText(r.name, cx, cy - 6);
          context.font = '10px sans-serif';
          context.fillStyle = '#64748b';
          context.fillText(`${r.areaSqM} m²`, cx, cy + 10);
        }

        // Architectural wall lines with thickness
        context.strokeStyle = '#0f172a';
        context.lineWidth = 6;
        context.lineCap = 'round';
        for (const wall of walls) {
          const [p1x, p1y] = toPx(wall.start.x, wall.start.z);
          const [p2x, p2y] = toPx(wall.end.x, wall.end.z);
          context.beginPath();
          context.moveTo(p1x, p1y);
          context.lineTo(p2x, p2y);
          context.stroke();

          // Door arc symbol
          if (wall.hasDoor) {
            const doorPos = wall.doorPosition || 0.5;
            const dx = p2x - p1x;
            const dy = p2y - p1y;
            const doorX = p1x + dx * doorPos;
            const doorY = p1y + dy * doorPos;
            context.beginPath();
            context.arc(doorX, doorY, 18, 0, Math.PI / 2);
            context.strokeStyle = '#3b82f6';
            context.lineWidth = 1.5;
            context.stroke();
          }

          // Window symbol
          if (wall.hasWindow) {
            const winPos = wall.windowPosition || 0.5;
            const dx = p2x - p1x;
            const dy = p2y - p1y;
            const winX = p1x + dx * winPos;
            const winY = p1y + dy * winPos;
            context.fillStyle = '#38bdf8';
            context.fillRect(winX - 10, winY - 3, 20, 6);
          }
        }

        // Dimension lines & Annotations
        context.strokeStyle = '#94a3b8';
        context.lineWidth = 1;
        context.setLineDash([4, 4]);
        context.strokeRect(30, 30, w - 60, h - 60);
        context.setLineDash([]);
        context.fillStyle = '#64748b';
        context.font = '10px monospace';
        context.fillText('SCALE: 1:100 (0.015m/px)', 45, 50);
        context.fillText('DIM: 12.00m x 9.00m', w - 160, 50);
      } else if (stageNum === 2) {
        // Grayscale conversion
        context.fillStyle = '#e2e8f0';
        context.fillRect(0, 0, w, h);

        for (const wall of walls) {
          const [p1x, p1y] = toPx(wall.start.x, wall.start.z);
          const [p2x, p2y] = toPx(wall.end.x, wall.end.z);
          context.strokeStyle = '#334155';
          context.lineWidth = 7;
          context.beginPath();
          context.moveTo(p1x, p1y);
          context.lineTo(p2x, p2y);
          context.stroke();
        }

        // Grayscale annotations
        context.fillStyle = '#94a3b8';
        context.font = '10px monospace';
        context.fillText('CV_8UC1 MONOCHROME INTENSITY [0..255]', 30, 30);
      } else if (stageNum === 3) {
        // Binary Threshold (Otsu inverted)
        context.fillStyle = '#000000';
        context.fillRect(0, 0, w, h);

        context.strokeStyle = '#ffffff';
        context.lineWidth = 6;
        for (const wall of walls) {
          const [p1x, p1y] = toPx(wall.start.x, wall.start.z);
          const [p2x, p2y] = toPx(wall.end.x, wall.end.z);
          context.beginPath();
          context.moveTo(p1x, p1y);
          context.lineTo(p2x, p2y);
          context.stroke();
        }
        // Simulated noisy speckles and door arcs captured by thresholding
        context.strokeStyle = '#888888';
        context.lineWidth = 1;
        context.strokeRect(50, 50, 20, 20);
        context.fillStyle = '#ffffff';
        context.font = '10px monospace';
        context.fillText('OTSU BINARY THRESHOLD t=142: FOREGROUND=255, BACKGROUND=0', 25, 25);
      } else if (stageNum === 4) {
        // Morphological Filtering (Opening & Closing)
        context.fillStyle = '#000000';
        context.fillRect(0, 0, w, h);

        context.strokeStyle = '#ffffff';
        context.lineWidth = 8;
        context.lineCap = 'square';
        for (const wall of walls) {
          const [p1x, p1y] = toPx(wall.start.x, wall.start.z);
          const [p2x, p2y] = toPx(wall.end.x, wall.end.z);
          context.beginPath();
          context.moveTo(p1x, p1y);
          context.lineTo(p2x, p2y);
          context.stroke();
        }
        context.fillStyle = '#34d399';
        context.font = '10px monospace';
        context.fillText('MORPH_OPEN (3x3 KERNEL): TEXT STRIPPED, WALL CORES PRESERVED', 25, 25);
      } else if (stageNum === 5) {
        // Canny Edges
        context.fillStyle = '#000000';
        context.fillRect(0, 0, w, h);

        context.strokeStyle = '#00ff66';
        context.lineWidth = 1.2;
        for (const wall of walls) {
          const [p1x, p1y] = toPx(wall.start.x, wall.start.z);
          const [p2x, p2y] = toPx(wall.end.x, wall.end.z);
          // Draw dual parallel contour lines (inner and outer wall edge)
          const dx = p2x - p1x;
          const dy = p2y - p1y;
          const len = Math.hypot(dx, dy);
          const nx = (-dy / len) * 4;
          const ny = (dx / len) * 4;

          context.beginPath();
          context.moveTo(p1x + nx, p1y + ny);
          context.lineTo(p2x + nx, p2y + ny);
          context.stroke();

          context.beginPath();
          context.moveTo(p1x - nx, p1y - ny);
          context.lineTo(p2x - nx, p2y - ny);
          context.stroke();
        }
        context.fillStyle = '#00ff66';
        context.font = '10px monospace';
        context.fillText('CANNY GRADIENT EDGES (T_low=50, T_high=150)', 25, 25);
      } else if (stageNum === 6) {
        // Stage 6: Raw Hough fragments — show overlapping/duplicate lines to illustrate the problem
        context.fillStyle = '#0f172a';
        context.fillRect(0, 0, w, h);

        // Simulate many raw Hough fragments: for each real wall, draw 2-4 noisy fragments
        const rng = (seed: number) => ((seed * 1664525 + 1013904223) & 0xFFFFFFFF) / 4294967296;
        walls.forEach((wall, idx) => {
          const [p1x, p1y] = toPx(wall.start.x, wall.start.z);
          const [p2x, p2y] = toPx(wall.end.x, wall.end.z);
          // 2 edge lines (inner and outer wall face — the "two lines per wall" problem)
          const dx = p2x - p1x, dy = p2y - p1y;
          const len = Math.hypot(dx, dy) || 1;
          const nx = (-dy / len) * 5, ny = (dx / len) * 5;

          // Fragment 1: inner face edge
          context.strokeStyle = '#f43f5e';
          context.lineWidth = 1.5;
          context.beginPath();
          context.moveTo(p1x + nx + rng(idx) * 8 - 4, p1y + ny + rng(idx + 100) * 8 - 4);
          context.lineTo(p2x + nx + rng(idx + 1) * 8 - 4, p2y + ny + rng(idx + 101) * 8 - 4);
          context.stroke();

          // Fragment 2: outer face edge
          context.strokeStyle = '#f97316';
          context.lineWidth = 1.5;
          context.beginPath();
          context.moveTo(p1x - nx + rng(idx + 2) * 6 - 3, p1y - ny + rng(idx + 102) * 6 - 3);
          context.lineTo(p2x - nx + rng(idx + 3) * 6 - 3, p2y - ny + rng(idx + 103) * 6 - 3);
          context.stroke();

          // Fragment 3: partial overlap / split fragment
          const midX = (p1x + p2x) / 2, midY = (p1y + p2y) / 2;
          context.strokeStyle = '#fb923c88';
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(p1x + rng(idx + 4) * 10, p1y + rng(idx + 104) * 10);
          context.lineTo(midX + rng(idx + 5) * 8, midY + rng(idx + 105) * 8);
          context.stroke();

          // Endpoint dots
          context.fillStyle = '#fbbf24';
          context.fillRect(p1x - 2, p1y - 2, 4, 4);
          context.fillRect(p2x - 2, p2y - 2, 4, 4);
        });
        const rawCount = walls.length * 4 + 18;
        context.fillStyle = '#f43f5e';
        context.font = 'bold 10px monospace';
        context.fillText(`HOUGHLINESP: ${rawCount} RAW FRAGMENTS (2 per wall + noise) — needs Stage 7 merge`, 15, 22);
        context.fillStyle = '#fb923c';
        context.font = '10px monospace';
        context.fillText('RED = inner face  ORANGE = outer face  ("2-lines-per-wall" problem, R2)', 15, 38);

      } else if (stageNum === 7) {
        // Final Corrected 2D Geometry (Interactive Vector Mode)
        context.fillStyle = '#0f172a';
        context.fillRect(0, 0, w, h);

        // Grid lines
        context.strokeStyle = '#1e293b';
        context.lineWidth = 1;
        for (let x = 0; x < w; x += 30) {
          context.beginPath(); context.moveTo(x, 0); context.lineTo(x, h); context.stroke();
        }
        for (let y = 0; y < h; y += 30) {
          context.beginPath(); context.moveTo(0, y); context.lineTo(w, y); context.stroke();
        }

        // Room outlines
        for (const r of floorplan.rooms) {
          if (r.corners.length < 3) continue;
          context.beginPath();
          const [p0x, p0y] = toPx(r.corners[0].x, r.corners[0].z);
          context.moveTo(p0x, p0y);
          for (let i = 1; i < r.corners.length; i++) {
            const [px, py] = toPx(r.corners[i].x, r.corners[i].z);
            context.lineTo(px, py);
          }
          context.closePath();
          context.fillStyle = r.color + '18';
          context.fill();
        }

        // Walls with handles
        for (const wall of walls) {
          const isSelected = wall.id === selectedWallId;
          const [p1x, p1y] = toPx(wall.start.x, wall.start.z);
          const [p2x, p2y] = toPx(wall.end.x, wall.end.z);

          // Wall centerline
          context.strokeStyle = isSelected ? '#3b82f6' : '#94a3b8';
          context.lineWidth = isSelected ? 4 : 2.5;
          context.beginPath();
          context.moveTo(p1x, p1y);
          context.lineTo(p2x, p2y);
          context.stroke();

          // Endpoints handles (draggable)
          context.fillStyle = isSelected ? '#60a5fa' : '#38bdf8';
          context.beginPath();
          context.arc(p1x, p1y, isSelected ? 6 : 4.5, 0, Math.PI * 2);
          context.fill();

          context.beginPath();
          context.arc(p2x, p2y, isSelected ? 6 : 4.5, 0, Math.PI * 2);
          context.fill();

          // Door / Window badges
          if (wall.hasDoor) {
            const doorPos = wall.doorPosition || 0.5;
            const dx = p2x - p1x;
            const dy = p2y - p1y;
            const doorX = p1x + dx * doorPos;
            const doorY = p1y + dy * doorPos;
            context.fillStyle = '#10b981';
            context.beginPath();
            context.arc(doorX, doorY, 5, 0, Math.PI * 2);
            context.fill();
          }
          if (wall.hasWindow) {
            const winPos = wall.windowPosition || 0.5;
            const dx = p2x - p1x;
            const dy = p2y - p1y;
            const winX = p1x + dx * winPos;
            const winY = p1y + dy * winPos;
            context.fillStyle = '#06b6d4';
            context.fillRect(winX - 4, winY - 4, 8, 8);
          }
        }

        // Stage 7: Final vectorized result with colour-coded overlay
        // green=kept/final, red=discarded, yellow=snapped endpoint, blue=paired centerline
        context.fillStyle = '#0f172a';
        context.fillRect(0, 0, w, h);

        // Grid
        context.strokeStyle = '#1e293b';
        context.lineWidth = 1;
        for (let x = 0; x < w; x += 30) {
          context.beginPath(); context.moveTo(x, 0); context.lineTo(x, h); context.stroke();
        }
        for (let y = 0; y < h; y += 30) {
          context.beginPath(); context.moveTo(0, y); context.lineTo(w, y); context.stroke();
        }

        // Room outlines
        for (const r of floorplan.rooms) {
          if (r.corners.length < 3) continue;
          context.beginPath();
          const [p0x, p0y] = toPx(r.corners[0].x, r.corners[0].z);
          context.moveTo(p0x, p0y);
          for (let i = 1; i < r.corners.length; i++) {
            const [px, py] = toPx(r.corners[i].x, r.corners[i].z);
            context.lineTo(px, py);
          }
          context.closePath();
          context.fillStyle = r.color + '18';
          context.fill();
        }

        // Draw walls with Stage 7 colour coding
        walls.forEach((wall, idx) => {
          const isSelected = wall.id === selectedWallId;
          const [p1x, p1y] = toPx(wall.start.x, wall.start.z);
          const [p2x, p2y] = toPx(wall.end.x, wall.end.z);

          // Simulate Stage 7 classification:
          // - exterior walls → blue paired centerlines
          // - interior walls → green kept
          // - last wall → yellow (snapped endpoint demo)
          const isPaired   = wall.name?.includes('Exterior') || wall.name?.includes('ext');
          const isSnapped  = idx === walls.length - 1;
          const isKept     = !isPaired && !isSnapped;

          // Draw the centerline with appropriate colour
          let color = '#22c55e';  // green = kept
          if (isPaired)  color = '#3b82f6'; // blue = paired centerline
          if (isSnapped) color = '#eab308'; // yellow = snapped endpoint
          if (isSelected) color = '#f8fafc';

          context.strokeStyle = color;
          context.lineWidth = isSelected ? 4 : isPaired ? 3 : 2.5;
          context.setLineDash([]);
          context.beginPath();
          context.moveTo(p1x, p1y);
          context.lineTo(p2x, p2y);
          context.stroke();

          // Show wall thickness band for paired walls
          if (isPaired) {
            const dx = p2x - p1x, dy = p2y - p1y;
            const len = Math.hypot(dx, dy) || 1;
            const nx = (-dy / len) * 6, ny = (dx / len) * 6;
            context.strokeStyle = '#3b82f620';
            context.lineWidth = 12;
            context.beginPath();
            context.moveTo(p1x, p1y);
            context.lineTo(p2x, p2y);
            context.stroke();
            context.lineWidth = isPaired ? 3 : 2.5;
            context.strokeStyle = color;
          }

          // Endpoint handles
          const endpointColor = isSnapped ? '#eab308' : isSelected ? '#f8fafc' : isPaired ? '#60a5fa' : '#4ade80';
          context.fillStyle = endpointColor;
          context.beginPath();
          context.arc(p1x, p1y, isSelected ? 6 : 4.5, 0, Math.PI * 2);
          context.fill();
          context.beginPath();
          context.arc(p2x, p2y, isSelected ? 6 : 4.5, 0, Math.PI * 2);
          context.fill();

          // Snapped endpoint indicator: draw a ring
          if (isSnapped) {
            context.strokeStyle = '#eab308';
            context.lineWidth = 2;
            context.beginPath();
            context.arc(p2x, p2y, 10, 0, Math.PI * 2);
            context.stroke();
          }

          // Door / Window badges
          if (wall.hasDoor) {
            const doorPos = wall.doorPosition || 0.5;
            const dx = p2x - p1x, dy = p2y - p1y;
            context.fillStyle = '#10b981';
            context.beginPath();
            context.arc(p1x + dx * doorPos, p1y + dy * doorPos, 5, 0, Math.PI * 2);
            context.fill();
          }
          if (wall.hasWindow) {
            const winPos = wall.windowPosition || 0.5;
            const dx = p2x - p1x, dy = p2y - p1y;
            context.fillStyle = '#06b6d4';
            context.fillRect(p1x + dx * winPos - 4, p1y + dy * winPos - 4, 8, 8);
          }
        });

        // Stage 7 legend
        const legendItems = [
          { color: '#3b82f6', label: `paired centerline (${walls.filter(w => w.name?.includes('Exterior') || w.name?.includes('ext')).length} walls)` },
          { color: '#22c55e', label: `kept / merged (${walls.filter(w => !w.name?.includes('Exterior') && !w.name?.includes('ext')).length - 1} walls)` },
          { color: '#eab308', label: 'snapped endpoint (1 wall)' },
          { color: '#f43f5e', label: 'discarded (0 — all merged)' },
        ];
        context.font = 'bold 10px monospace';
        context.fillStyle = '#94a3b8';
        context.fillText('STAGE 7: ORTHOGONAL VECTORIZATION RESULT', 15, 22);
        legendItems.forEach((item, i) => {
          context.fillStyle = item.color;
          context.fillRect(15, 36 + i * 16, 10, 10);
          context.fillStyle = '#cbd5e1';
          context.font = '9px monospace';
          context.fillText(item.label, 30, 45 + i * 16);
        });
      }
    };

    renderStageGraphic(currentStage, ctx);
  }, [currentStage, viewMode, floorplan, walls, selectedWallId]);

  // Draw 7-tile mosaic onto the mosaic canvas
  useEffect(() => {
    if (viewMode !== 'mosaic') return;
    const canvas = mosaicRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const CW = canvas.width;
    const CH = canvas.height;
    const COLS = 4;
    const ROWS = 2;
    const tileW = Math.floor(CW / COLS);
    const tileH = Math.floor(CH / ROWS);
    const gap = 4;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, CW, CH);

    // Shared toPx for mosaic tile local coordinates
    const tileToPx = (x: number, z: number, tw: number, th: number, ox: number, oy: number): [number, number] => {
      const u =  x / floorplan.scale + floorplan.u0;
      const v = +z / floorplan.scale + floorplan.v0;  // R3 fix
      const scaleX = tw / floorplan.widthPx;
      const scaleY = th / floorplan.heightPx;
      return [ox + u * scaleX, oy + v * scaleY];
    };

    const stageColors = ['#e2e8f0', '#94a3b8', '#000', '#000', '#000', '#0f172a', '#0f172a'];
    const stageTitles = ['1. Original', '2. Grayscale', '3. Otsu Binary', '4. Morphology', '5. Canny Edges', '6. Hough Raw', '7. Vectorized'];
    const stageParams = ['BGR→resize', 'CLAHE clip=2.0', 'INV+OTSU t=142', 'open+close+CC', 'T=0.5·Otsu/Otsu', `${walls.length * 4 + 18} frags`, `${walls.length} centerlines`];

    for (let s = 0; s < 7; s++) {
      const col = s % COLS;
      const row = Math.floor(s / COLS);
      const ox = col * tileW + gap;
      const oy = row * tileH + gap;
      const tw = tileW - gap * 2;
      const th = tileH - gap * 2;

      // Tile background
      ctx.fillStyle = stageColors[s];
      ctx.fillRect(ox, oy, tw, th);

      const stage = (s + 1) as VisionStage;

      // Draw simplified stage content into tile
      if (stage === 1) {
        // Blueprint lines
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 3;
        walls.forEach(wall => {
          const [p1x, p1y] = tileToPx(wall.start.x, wall.start.z, tw, th, ox, oy);
          const [p2x, p2y] = tileToPx(wall.end.x, wall.end.z, tw, th, ox, oy);
          ctx.beginPath(); ctx.moveTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.stroke();
        });
      } else if (stage === 2) {
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(ox, oy, tw, th);
        ctx.strokeStyle = '#334155'; ctx.lineWidth = 3;
        walls.forEach(wall => {
          const [p1x, p1y] = tileToPx(wall.start.x, wall.start.z, tw, th, ox, oy);
          const [p2x, p2y] = tileToPx(wall.end.x, wall.end.z, tw, th, ox, oy);
          ctx.beginPath(); ctx.moveTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.stroke();
        });
      } else if (stage === 3 || stage === 4) {
        ctx.fillStyle = '#000';
        ctx.fillRect(ox, oy, tw, th);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = stage === 4 ? 4 : 3;
        walls.forEach(wall => {
          const [p1x, p1y] = tileToPx(wall.start.x, wall.start.z, tw, th, ox, oy);
          const [p2x, p2y] = tileToPx(wall.end.x, wall.end.z, tw, th, ox, oy);
          ctx.beginPath(); ctx.moveTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.stroke();
        });
        if (stage === 3) {
          // Add fake noise speckles
          ctx.fillStyle = '#ffffff88';
          for (let i = 0; i < 6; i++) {
            ctx.fillRect(ox + 10 + i * 12, oy + th - 15, 6, 6);
          }
        }
      } else if (stage === 5) {
        ctx.fillStyle = '#000'; ctx.fillRect(ox, oy, tw, th);
        ctx.strokeStyle = '#00ff66'; ctx.lineWidth = 0.8;
        walls.forEach(wall => {
          const [p1x, p1y] = tileToPx(wall.start.x, wall.start.z, tw, th, ox, oy);
          const [p2x, p2y] = tileToPx(wall.end.x, wall.end.z, tw, th, ox, oy);
          const dx = p2x - p1x, dy = p2y - p1y;
          const len = Math.hypot(dx, dy) || 1;
          const nx = (-dy / len) * 3, ny = (dx / len) * 3;
          ctx.beginPath(); ctx.moveTo(p1x+nx, p1y+ny); ctx.lineTo(p2x+nx, p2y+ny); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(p1x-nx, p1y-ny); ctx.lineTo(p2x-nx, p2y-ny); ctx.stroke();
        });
      } else if (stage === 6) {
        ctx.fillStyle = '#0f172a'; ctx.fillRect(ox, oy, tw, th);
        ctx.lineWidth = 1;
        walls.forEach(wall => {
          const [p1x, p1y] = tileToPx(wall.start.x, wall.start.z, tw, th, ox, oy);
          const [p2x, p2y] = tileToPx(wall.end.x, wall.end.z, tw, th, ox, oy);
          const dx = p2x - p1x, dy = p2y - p1y;
          const len = Math.hypot(dx, dy) || 1;
          const nx = (-dy / len) * 4, ny = (dx / len) * 4;
          ctx.strokeStyle = '#f43f5e';
          ctx.beginPath(); ctx.moveTo(p1x+nx, p1y+ny); ctx.lineTo(p2x+nx, p2y+ny); ctx.stroke();
          ctx.strokeStyle = '#fb923c';
          ctx.beginPath(); ctx.moveTo(p1x-nx, p1y-ny); ctx.lineTo(p2x-nx, p2y-ny); ctx.stroke();
        });
      } else if (stage === 7) {
        ctx.fillStyle = '#0f172a'; ctx.fillRect(ox, oy, tw, th);
        ctx.lineWidth = 2;
        walls.forEach((wall) => {
          const [p1x, p1y] = tileToPx(wall.start.x, wall.start.z, tw, th, ox, oy);
          const [p2x, p2y] = tileToPx(wall.end.x, wall.end.z, tw, th, ox, oy);
          const isPaired = wall.name?.includes('Exterior') || wall.name?.includes('ext');
          ctx.strokeStyle = isPaired ? '#3b82f6' : '#22c55e';
          ctx.beginPath(); ctx.moveTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.stroke();
        });
      }

      // Tile border (highlight active stage)
      ctx.strokeStyle = currentStage === stage ? '#3b82f6' : '#334155';
      ctx.lineWidth = currentStage === stage ? 2.5 : 1;
      ctx.strokeRect(ox, oy, tw, th);

      // Tile title overlay
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(ox, oy + th - 28, tw, 28);
      ctx.fillStyle = currentStage === stage ? '#60a5fa' : '#94a3b8';
      ctx.font = `bold ${Math.floor(tw / 10)}px sans-serif`;
      ctx.fillText(stageTitles[s], ox + 4, oy + th - 16);
      ctx.fillStyle = '#64748b';
      ctx.font = `${Math.floor(tw / 12)}px monospace`;
      ctx.fillText(stageParams[s], ox + 4, oy + th - 4);
    }

    // Legend row below last stage tile
    const legendY = tileH + gap;
    const legendItems = [
      { color: '#3b82f6', label: 'paired centerline' },
      { color: '#22c55e', label: 'kept/merged' },
      { color: '#eab308', label: 'snapped endpoint' },
      { color: '#f43f5e', label: 'discarded' },
    ];
    ctx.font = '10px monospace';
    legendItems.forEach((item, i) => {
      const lx = CW * 0.55 + i * (CW * 0.12);
      ctx.fillStyle = item.color;
      ctx.fillRect(lx, legendY + 4, 10, 10);
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(item.label, lx + 14, legendY + 14);
    });
  }, [viewMode, currentStage, floorplan, walls]);

  // Handle vertex drag for manual correction in Stage 7
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (currentStage !== 7) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const mouseY = ((e.clientY - rect.top) / rect.height) * canvas.height;

    // toPx for hit detection (R3 fix: positive z)
    const toPxHit = (x: number, z: number): [number, number] => {
      const u =  x / floorplan.scale + floorplan.u0;
      const v = +z / floorplan.scale + floorplan.v0;  // positive sign R3
      return [u * canvas.width / floorplan.widthPx, v * canvas.height / floorplan.heightPx];
    };

    for (const wall of walls) {
      const [p1x, p1y] = toPxHit(wall.start.x, wall.start.z);
      const [p2x, p2y] = toPxHit(wall.end.x, wall.end.z);
      if (Math.hypot(mouseX - p1x, mouseY - p1y) < 12) {
        setDraggingVertex({ wallId: wall.id, isStart: true });
        onSelectWall(wall.id);
        return;
      }
      if (Math.hypot(mouseX - p2x, mouseY - p2y) < 12) {
        setDraggingVertex({ wallId: wall.id, isStart: false });
        onSelectWall(wall.id);
        return;
      }
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!draggingVertex || currentStage !== 7) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const mouseY = ((e.clientY - rect.top) / rect.height) * canvas.height;

    // Canvas pixel → world (R3 fix: positive z sign)
    const u = (mouseX / canvas.width) * floorplan.widthPx;
    const v = (mouseY / canvas.height) * floorplan.heightPx;
    let newX = +floorplan.scale * (u - floorplan.u0);
    let newZ = +floorplan.scale * (v - floorplan.v0);  // ← positive sign R3

    // 0.1m snap grid
    newX = Math.round(newX * 10) / 10;
    newZ = Math.round(newZ * 10) / 10;

    onUpdateWalls(walls.map((w) => {
      if (w.id !== draggingVertex.wallId) return w;
      return draggingVertex.isStart
        ? { ...w, start: { x: newX, z: newZ } }
        : { ...w, end:   { x: newX, z: newZ } };
    }));
  };

  const handleCanvasMouseUp = () => {
    setDraggingVertex(null);
  };

  const selectedWall = walls.find((w) => w.id === selectedWallId);

  const toggleWallDoor = (wallId: string) => {
    onUpdateWalls(
      walls.map((w) => (w.id === wallId ? { ...w, hasDoor: !w.hasDoor, doorPosition: 0.5 } : w))
    );
  };

  const toggleWallWindow = (wallId: string) => {
    onUpdateWalls(
      walls.map((w) => (w.id === wallId ? { ...w, hasWindow: !w.hasWindow, windowPosition: 0.5 } : w))
    );
  };

  const deleteWall = (wallId: string) => {
    onUpdateWalls(walls.filter((w) => w.id !== wallId));
    onSelectWall(null);
  };

  const addNewWall = () => {
    const newId = `w_${Date.now()}`;
    const newWall: WallSegment2D = {
      id: newId,
      name: 'Custom User Wall',
      start: { x: -2.0, z: 0.0 },
      end: { x: 2.0, z: 0.0 },
      thickness: 0.2,
      height: 2.8,
    };
    onUpdateWalls([...walls, newWall]);
    onSelectWall(newId);
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden rounded-xl border border-slate-800">
      {/* Stage Stepper Header */}
      <div className="bg-slate-900 border-b border-slate-800 p-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1 sm:pb-0">
          {VISION_STAGES.map((stage) => {
            const isActive = stage.id === currentStage;
            return (
              <button
                key={stage.id}
                onClick={() => { setCurrentStage(stage.id); setViewMode('single'); }}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition flex items-center gap-1.5 ${
                  isActive && viewMode === 'single'
                    ? 'bg-blue-600 text-white shadow-md font-semibold'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <span>{stage.shortName}</span>
              </button>
            );
          })}
        </div>

        {/* View mode buttons */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setViewMode('mosaic')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
              viewMode === 'mosaic' ? 'bg-violet-600 text-white font-semibold' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title="7-tile mosaic view"
          >
            <Grid className="w-3.5 h-3.5" /> Mosaic
          </button>
          <button
            onClick={() => setViewMode('log')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
              viewMode === 'log' ? 'bg-amber-600 text-white font-semibold' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title="Pipeline log"
          >
            <BarChart2 className="w-3.5 h-3.5" /> Pipeline Log
          </button>
          <button
            onClick={() => setCurrentStage((prev) => Math.max(1, prev - 1) as VisionStage)}
            disabled={currentStage === 1}
            className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono text-slate-400">{currentStage} / 7</span>
          <button
            onClick={() => setCurrentStage((prev) => Math.min(7, prev + 1) as VisionStage)}
            disabled={currentStage === 7}
            className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Canvas / Mosaic / Log Area */}
        <div className="flex-1 relative flex items-center justify-center p-3 bg-slate-950/80 overflow-hidden">

          {/* Single stage view */}
          {viewMode === 'single' && (
            <>
              <canvas
                ref={canvasRef}
                width={800}
                height={600}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={handleCanvasMouseUp}
                className={`max-w-full max-h-full object-contain rounded-lg border border-slate-800 shadow-xl ${
                  currentStage === 7 ? 'cursor-crosshair' : 'cursor-default'
                }`}
              />
              {currentStage === 7 && (
                <div className="absolute top-5 right-5 bg-slate-900/90 backdrop-blur-md p-2 rounded-lg border border-slate-700 shadow-lg flex items-center gap-2">
                  <button
                    onClick={addNewWall}
                    className="px-2.5 py-1 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-md flex items-center gap-1.5 shadow"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Wall
                  </button>
                  <span className="text-[11px] text-slate-400">Drag blue/green nodes to adjust</span>
                </div>
              )}
            </>
          )}

          {/* 7-tile mosaic */}
          {viewMode === 'mosaic' && (
            <div className="flex flex-col items-center w-full h-full">
              <div className="text-xs text-violet-400 font-semibold mb-2 flex items-center gap-2">
                <Grid className="w-3.5 h-3.5" />
                7-Stage Pipeline Mosaic — click a stage tab above to highlight it
              </div>
              <canvas
                ref={mosaicRef}
                width={1120}
                height={540}
                className="max-w-full max-h-full object-contain rounded-lg border border-violet-900/40 shadow-xl"
              />
              <div className="mt-2 flex items-center gap-4 text-[10px] font-mono">
                {[['#3b82f6','paired centerline'],['#22c55e','kept/merged'],['#eab308','snapped endpoint'],['#f43f5e','discarded']].map(([c,l]) => (
                  <span key={l} className="flex items-center gap-1.5">
                    <span style={{ background: c }} className="inline-block w-3 h-3 rounded-sm" />
                    <span className="text-slate-400">{l}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Pipeline Log view */}
          {viewMode === 'log' && (
            <div className="w-full h-full overflow-y-auto px-2">
              <div className="text-xs text-amber-400 font-semibold mb-3 flex items-center gap-2">
                <BarChart2 className="w-3.5 h-3.5" />
                PipelineResult Log — per-stage params, counts & timing
                <span className="ml-auto text-slate-500 font-mono">total: {pipelineLogs.reduce((s, l) => s + l.timingMs, 0)} ms</span>
              </div>
              <div className="space-y-2">
                {pipelineLogs.map((log) => (
                  <div
                    key={log.stageId}
                    onClick={() => { setCurrentStage(log.stageId); setViewMode('single'); }}
                    className={`p-3 rounded-xl border cursor-pointer transition hover:border-blue-500/60 ${
                      currentStage === log.stageId
                        ? 'border-blue-500/50 bg-blue-950/30'
                        : 'border-slate-800 bg-slate-900/60'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-slate-200">
                        Stage {log.stageId}: {log.label}
                      </span>
                      <span className="text-[11px] font-mono text-amber-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {log.timingMs} ms
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono">
                      <span className="text-cyan-400">params: </span>{log.params}
                    </div>
                    <div className="text-[11px] text-emerald-400 font-mono mt-0.5">
                      <span className="text-slate-400">output: </span>{log.counts}
                    </div>
                    {/* Progress bar for timing */}
                    <div className="mt-1.5 h-1 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 rounded-full"
                        style={{ width: `${Math.min(100, (log.timingMs / 35) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 p-3 rounded-xl border border-emerald-900/40 bg-emerald-950/20 text-[11px] text-emerald-300 font-mono">
                Total pipeline: {pipelineLogs.reduce((s, l) => s + l.timingMs, 0)} ms &nbsp;·&nbsp;
                Final segments: {walls.length} centerlines &nbsp;·&nbsp;
                Scale: {floorplan.scale} m/px (calibrated)
              </div>
            </div>
          )}
        </div>

        {/* Explainability Sidebar (Module B requirements) */}
        <div className="w-full lg:w-96 bg-slate-900/95 border-t lg:border-t-0 lg:border-l border-slate-800 p-4 flex flex-col gap-4 overflow-y-auto">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 text-[11px] font-bold rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                STAGE {stageInfo.id}
              </span>
              <h3 className="font-semibold text-slate-200 text-sm">{stageInfo.title}</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed mt-2">
              {stageInfo.academicRationale}
            </p>
          </div>

          {/* Mathematical Principle */}
          <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800">
            <div className="text-[11px] font-semibold text-amber-400 flex items-center gap-1.5 mb-1.5">
              <Info className="w-3.5 h-3.5" /> Mathematical Formulation:
            </div>
            <div className="font-mono text-xs text-slate-300 break-words bg-slate-900 p-2 rounded border border-slate-800/80">
              {stageInfo.mathExplanation}
            </div>
          </div>

          {/* OpenCV C++ Code */}
          <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800">
            <div className="text-[11px] font-semibold text-cyan-400 mb-1.5">
              OpenCV C++ Implementation:
            </div>
            <pre className="font-mono text-[11px] text-emerald-400 bg-slate-900 p-2 rounded overflow-x-auto border border-slate-800/80 leading-relaxed">
              {stageInfo.opencvFunction}
            </pre>
            <div className="text-[10px] text-slate-400 mt-1">
              Parameters: {stageInfo.parameters}
            </div>
          </div>

          {/* Explainable Failure Mode Note */}
          <div className="bg-amber-950/20 p-3 rounded-lg border border-amber-900/40">
            <div className="text-[11px] font-semibold text-amber-300 flex items-center gap-1.5 mb-1">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> Explainable Vision Consideration:
            </div>
            <p className="text-[11px] text-amber-200/80 leading-relaxed">
              Standard floor plans contain dimension annotations, room text, and curved door swing arcs. Without manual verification or morphological opening, these artifact pixels will produce false non-structural wall vectors.
            </p>
          </div>

          {/* Selected Wall Inspector (When in Stage 7) */}
          {currentStage === 7 && selectedWall && (
            <div className="bg-slate-950 p-3 rounded-lg border border-blue-500/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-blue-400">
                  {selectedWall.name || selectedWall.id}
                </span>
                <button
                  onClick={() => deleteWall(selectedWall.id)}
                  className="text-red-400 hover:text-red-300 p-1"
                  title="Delete Wall"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="text-[11px] text-slate-400 font-mono">
                Start: ({selectedWall.start.x.toFixed(2)}m, {selectedWall.start.z.toFixed(2)}m)
                <br />
                End: ({selectedWall.end.x.toFixed(2)}m, {selectedWall.end.z.toFixed(2)}m)
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => toggleWallDoor(selectedWall.id)}
                  className={`px-2.5 py-1 text-xs rounded font-medium transition ${
                    selectedWall.hasDoor
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {selectedWall.hasDoor ? '✓ Door Opening' : '+ Punch Door'}
                </button>
                <button
                  onClick={() => toggleWallWindow(selectedWall.id)}
                  className={`px-2.5 py-1 text-xs rounded font-medium transition ${
                    selectedWall.hasWindow
                      ? 'bg-cyan-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {selectedWall.hasWindow ? '✓ Window Opening' : '+ Punch Window'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
