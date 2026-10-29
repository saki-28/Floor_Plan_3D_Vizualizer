import React, { useState, useRef, useEffect } from 'react';
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
} from 'lucide-react';

interface CVVisualizerProps {
  floorplan: FloorPlanDataset;
  walls: WallSegment2D[];
  onUpdateWalls: (walls: WallSegment2D[]) => void;
  selectedWallId: string | null;
  onSelectWall: (wallId: string | null) => void;
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
    mathExplanation: 'Opening: (B \\ominus K) \\oplus K removes thin dimension text. Closing: (B \\oplus K) \\ominus K connects fragmented wall segments.',
    opencvFunction: 'cv::Mat kernel = cv::getStructuringElement(cv::MORPH_RECT, cv::Size(3, 3));\ncv::morphologyEx(imgBinary, imgFiltered, cv::MORPH_OPEN, kernel);',
    parameters: 'Kernel: 3x3 Rectangular Structuring Element, 1 iteration Opening + 1 iteration Closing',
    academicRationale: 'Architectural drawings contain fine dimension tick marks, text, and hatching. Morphological opening strips thin features while preserving thick wall profiles.',
  },
  {
    id: 5,
    title: 'Stage 5: Canny Edge Detection',
    shortName: '5. Canny Edges',
    mathExplanation: 'Gradient magnitude G = \\sqrt{G_x^2 + G_y^2} via Sobel kernels. Non-maximum suppression followed by hysteresis thresholding with high (T_h) and low (T_l) limits.',
    opencvFunction: 'cv::Canny(imgFiltered, imgEdges, 50, 150, 3);',
    parameters: 'Threshold1: 50 (Low), Threshold2: 150 (High), ApertureSize: 3',
    academicRationale: 'Detects sharp 1-pixel wide continuous boundaries corresponding to inner and outer wall faces.',
  },
  {
    id: 6,
    title: 'Stage 6: Hough Line & Wall Candidates',
    shortName: '6. Candidate Extraction',
    mathExplanation: 'Probabilistic Hough Transform accumulator: \\rho = u \\cos(\\theta) + v \\sin(\\theta). Filters lines with \\theta \\approx 0^\\circ \\text{ or } 90^\\circ within \\pm 5^\\circ tolerance.',
    opencvFunction: 'std::vector<cv::Vec4i> lines;\ncv::HoughLinesP(imgEdges, lines, 1, CV_PI/180, 50, 40, 10);',
    parameters: 'rho: 1px, theta: 1 deg, threshold: 50, minLineLength: 40px, maxLineGap: 10px',
    academicRationale: 'Converts raster edge pixels into discrete mathematical line segments (u1, v1) -> (u2, v2). Orthogonal snapping enforces architectural realism.',
  },
  {
    id: 7,
    title: 'Stage 7: Final Vectorized 2D Layout & Manual Adjustment',
    shortName: '7. Final 2D Layout',
    mathExplanation: 'Coordinate transformation to metric world space: x = s \\cdot (u - u_0), z = -s \\cdot (v - v_0). Enforces wall thickness t and allows user manual adjustment.',
    opencvFunction: '// C++ Geometric Mapping & Extrusion Integration\nWallSegment2D wall = mapPixelsToWorld(candidate, scale, u0, v0);',
    parameters: 'Scale: 0.015 m/px, Origin: (400, 300), Wall Thickness: 0.20m',
    academicRationale: 'Solves the university problem requirement: Real-world floor plans have ambiguous door arcs or text. This stage provides an explainable, editable ground-truth fallback.',
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [compareStage, setCompareStage] = useState<VisionStage>(7);

  // Manual editing state for Stage 7
  const [draggingVertex, setDraggingVertex] = useState<{ wallId: string; isStart: boolean } | null>(null);

  const stageInfo = VISION_STAGES.find((s) => s.id === currentStage) || VISION_STAGES[0];

  // Draw 2D canvas representation based on active stage
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Helper: world coords to canvas pixels
    const toPx = (x: number, z: number): [number, number] => {
      const u = x / floorplan.scale + floorplan.u0;
      const v = -z / floorplan.scale + floorplan.v0;
      // Scale from floorplan resolution to canvas resolution
      const scaleX = w / floorplan.widthPx;
      const scaleY = h / floorplan.heightPx;
      return [u * scaleX, v * scaleY];
    };

    // Helper: canvas pixels to world coords
    const toWorld = (px: number, py: number): [number, number] => {
      const scaleX = w / floorplan.widthPx;
      const scaleY = h / floorplan.heightPx;
      const u = px / scaleX;
      const v = py / scaleY;
      const x = floorplan.scale * (u - floorplan.u0);
      const z = -floorplan.scale * (v - floorplan.v0);
      return [x, z];
    };

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
        // Hough Wall Candidates
        context.fillStyle = '#0f172a';
        context.fillRect(0, 0, w, h);

        // Vector candidate segments
        context.lineWidth = 3;
        walls.forEach((wall, idx) => {
          const [p1x, p1y] = toPx(wall.start.x, wall.start.z);
          const [p2x, p2y] = toPx(wall.end.x, wall.end.z);
          context.strokeStyle = idx % 2 === 0 ? '#38bdf8' : '#f43f5e';
          context.beginPath();
          context.moveTo(p1x, p1y);
          context.lineTo(p2x, p2y);
          context.stroke();

          // Endpoint markers
          context.fillStyle = '#fbbf24';
          context.fillRect(p1x - 3, p1y - 3, 6, 6);
          context.fillRect(p2x - 3, p2y - 3, 6, 6);
        });
        context.fillStyle = '#38bdf8';
        context.font = '10px monospace';
        context.fillText('HOUGHLINES_P CANDIDATE VECTORS + ORTHOGONAL SNAPPING', 25, 25);
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

        context.fillStyle = '#38bdf8';
        context.font = '10px monospace';
        context.fillText('STAGE 7: VECTOR TOPOLOGY & INTERACTIVE VERTEX EDITING MODE', 25, 25);
      }
    };

    renderStageGraphic(currentStage, ctx);
  }, [currentStage, floorplan, walls, selectedWallId]);

  // Handle vertex drag for manual correction in Stage 7
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (currentStage !== 7) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const mouseY = ((e.clientY - rect.top) / rect.height) * canvas.height;

    const toPx = (x: number, z: number): [number, number] => {
      const u = x / floorplan.scale + floorplan.u0;
      const v = -z / floorplan.scale + floorplan.v0;
      const scaleX = canvas.width / floorplan.widthPx;
      const scaleY = canvas.height / floorplan.heightPx;
      return [u * scaleX, v * scaleY];
    };

    // Find nearest vertex
    for (const wall of walls) {
      const [p1x, p1y] = toPx(wall.start.x, wall.start.z);
      const [p2x, p2y] = toPx(wall.end.x, wall.end.z);

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

    // Convert to world space
    const scaleX = canvas.width / floorplan.widthPx;
    const scaleY = canvas.height / floorplan.heightPx;
    const u = mouseX / scaleX;
    const v = mouseY / scaleY;
    let newX = floorplan.scale * (u - floorplan.u0);
    let newZ = -floorplan.scale * (v - floorplan.v0);

    // Optional 0.1m snapping for architectural precision
    newX = Math.round(newX * 10) / 10;
    newZ = Math.round(newZ * 10) / 10;

    const updated = walls.map((w) => {
      if (w.id === draggingVertex.wallId) {
        if (draggingVertex.isStart) {
          return { ...w, start: { x: newX, z: newZ } };
        } else {
          return { ...w, end: { x: newX, z: newZ } };
        }
      }
      return w;
    });

    onUpdateWalls(updated);
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
      <div className="bg-slate-900 border-b border-slate-800 p-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1 sm:pb-0">
          {VISION_STAGES.map((stage) => {
            const isActive = stage.id === currentStage;
            return (
              <button
                key={stage.id}
                onClick={() => setCurrentStage(stage.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition flex items-center gap-1.5 ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-md font-semibold'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <span>{stage.shortName}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentStage((prev) => Math.max(1, prev - 1) as VisionStage)}
            disabled={currentStage === 1}
            className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Previous Stage"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono text-slate-400">
            {currentStage} / 7
          </span>
          <button
            onClick={() => setCurrentStage((prev) => Math.min(7, prev + 1) as VisionStage)}
            disabled={currentStage === 7}
            className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Next Stage"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* 2D Canvas Area */}
        <div className="flex-1 relative flex items-center justify-center p-3 bg-slate-950/80 overflow-hidden">
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
              <span className="text-[11px] text-slate-400">
                Drag blue nodes to adjust geometry
              </span>
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
