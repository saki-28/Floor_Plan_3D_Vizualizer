/**
 * Real floor-plan image pipeline, stages 1–7 of the plan (B7), on OpenCV.js.
 * Runs in the browser and in Node. Every stage records its output image,
 * parameters, counts and timing so the UI can show what each step did.
 * Stage 7 (raw segments to walls) lives in vectorize.ts.
 */

import type { Mat } from '@techstark/opencv-js';
import type { Segment2D } from '../types/floorplan';
import type { CV } from './opencv';
import {
  cannyThresholds,
  classifySegment,
  fitWithin,
  MAX_LONG_SIDE,
  maxWallThicknessPx,
  resolveOptions,
  summarizeSegments,
  type Orientation,
  type PipelineOptions,
  type SegmentStats,
} from './pipelineParams';
import { defaultVectorizeOptions, vectorizeWalls, type VectorizeResult } from './vectorize';

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

export type StageId = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface StageResult {
  id: StageId;
  title: string;
  params: Record<string, string | number>;
  counts: Record<string, number>;
  timingMs: number;
  image: RgbaImage;
}

export interface PipelineRun {
  stages: StageResult[];
  /** Raw HoughLinesP output, in working-resolution pixels. */
  rawSegments: Segment2D[];
  stats: SegmentStats;
  /** Stage 7 output: wall centerlines in working-resolution pixels, thickness in pixels. */
  walls: Segment2D[];
  vector: VectorizeResult;
  options: PipelineOptions;
  otsuThreshold: number;
  inputSize: { width: number; height: number };
  workingSize: { width: number; height: number };
  /** Sum of stage times (excludes copying images out for display). */
  totalMs: number;
}

/**
 * Overlay colours, drawn into the stage images (always on a dark ground, in both themes):
 * horizontal segments in the app's teal, vertical in amber, slanted in the negative red
 * because a slanted segment is a problem for an orthogonal plan. Removed pixels in red too.
 */
export const HOUGH_COLORS: Record<Orientation, [number, number, number]> = {
  horizontal: [95, 180, 200],
  vertical: [214, 163, 71],
  oblique: [229, 86, 111],
};
export const REMOVED_COLOR: [number, number, number] = [229, 86, 111];
/** Stage 7 overlay: a wall's body, its centerline, and raw segments set aside as slanted. */
export const WALL_COLORS = {
  body: [36, 82, 94] as [number, number, number],
  centerline: [95, 180, 200] as [number, number, number],
  setAside: [229, 86, 111] as [number, number, number],
};

function timed<T>(fn: () => T): [T, number] {
  const t0 = performance.now();
  const result = fn();
  return [result, performance.now() - t0];
}

/** Copies a 1- or 4-channel Mat out of the WASM heap as RGBA. */
function toRgba(cv: CV, mat: Mat): RgbaImage {
  const rgba = new cv.Mat();
  try {
    if (mat.channels() === 1) cv.cvtColor(mat, rgba, cv.COLOR_GRAY2RGBA);
    else mat.copyTo(rgba);
    return { width: rgba.cols, height: rgba.rows, data: new Uint8ClampedArray(rgba.data) };
  } finally {
    rgba.delete();
  }
}

/** Stage 4 explanation image: kept pixels white, pixels the clean-up removed in red. */
function removalOverlay(binary: Mat, cleaned: Mat): RgbaImage {
  const before = binary.data;
  const after = cleaned.data;
  const out = new Uint8ClampedArray(before.length * 4);
  for (let p = 0; p < before.length; p++) {
    const o = p * 4;
    if (after[p]) {
      out[o] = out[o + 1] = out[o + 2] = 255;
    } else if (before[p]) {
      [out[o], out[o + 1], out[o + 2]] = REMOVED_COLOR;
    }
    out[o + 3] = 255;
  }
  return { width: binary.cols, height: binary.rows, data: out };
}

export function runPipeline(
  cv: CV,
  input: RgbaImage,
  overrides: Partial<PipelineOptions> = {},
): PipelineRun {
  const mats: { delete(): void }[] = [];
  const keep = <T extends { delete(): void }>(m: T): T => {
    mats.push(m);
    return m;
  };
  const stages: StageResult[] = [];

  try {
    // Stage 1: load and resize so the longest side is at most maxLongSide.
    const maxLongSide = overrides.maxLongSide ?? MAX_LONG_SIDE;
    const [rgba, ms1] = timed(() => {
      const src = keep(cv.matFromImageData(input));
      const fit = fitWithin(src.cols, src.rows, maxLongSide);
      if (fit.scale >= 1) return src;
      const resized = keep(new cv.Mat());
      cv.resize(src, resized, new cv.Size(fit.width, fit.height), 0, 0, cv.INTER_AREA);
      return resized;
    });
    const width = rgba.cols;
    const height = rgba.rows;
    const opts = resolveOptions(width, height, overrides);
    stages.push({
      id: 1,
      title: 'Load & resize',
      params: { 'Max long side': `${opts.maxLongSide} px`, Interpolation: 'INTER_AREA', Deskew: 'off' },
      counts: { 'Input width': input.width, 'Input height': input.height, Width: width, Height: height },
      timingMs: ms1,
      image: toRgba(cv, rgba),
    });

    // Stage 2: grayscale, then CLAHE to even out uneven scan lighting.
    const [stage2, ms2] = timed(() => {
      const gray = keep(new cv.Mat());
      cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
      const clahe = keep(new cv.CLAHE(opts.claheClipLimit, new cv.Size(opts.claheTiles, opts.claheTiles)));
      const equalized = keep(new cv.Mat());
      clahe.apply(gray, equalized);
      return { gray, equalized };
    });
    stages.push({
      id: 2,
      title: 'Grayscale + CLAHE',
      params: { 'Clip limit': opts.claheClipLimit, Tiles: `${opts.claheTiles}×${opts.claheTiles}` },
      counts: {
        'Mean before': Math.round(cv.mean(stage2.gray)[0]),
        'Mean after': Math.round(cv.mean(stage2.equalized)[0]),
      },
      timingMs: ms2,
      image: toRgba(cv, stage2.equalized),
    });

    // Stage 3: inverted Otsu, so ink becomes white (255) and paper black.
    const [stage3, ms3] = timed(() => {
      const binary = keep(new cv.Mat());
      const otsu = cv.threshold(stage2.equalized, binary, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
      return { binary, otsu };
    });
    const foreground = cv.countNonZero(stage3.binary);
    stages.push({
      id: 3,
      title: 'Otsu threshold',
      params: { Mode: 'BINARY_INV | OTSU' },
      counts: {
        'Otsu threshold': Math.round(stage3.otsu),
        'Ink pixels': foreground,
        'Ink %': Math.round((foreground / (width * height)) * 1000) / 10,
      },
      timingMs: ms3,
      image: toRgba(cv, stage3.binary),
    });

    // Stage 4: opening removes thin strokes; the blob filter drops what is too
    // small (area, extent) to be a wall, and short blobs drawn with much
    // thinner strokes than the walls (text, symbols); closing bridges small
    // breaks. The filter runs before closing because closing glues letters
    // into word-sized blobs.
    const [stage4, ms4] = timed(() => {
      const openKernel = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(opts.openKernel, opts.openKernel)));
      let source = stage3.binary;
      let removedBeforeFill = 0;
      if (opts.fillKernel > 1 && opts.clearBeforeFill > 0) {
        // Letters, dimension ticks, dashes and small symbols are separate small pieces of ink;
        // the fill would glue a label's letters into a solid bar that reads as a wall, so they
        // go first.
        const preLabels = keep(new cv.Mat());
        const preStats = keep(new cv.Mat());
        const preCentroids = keep(new cv.Mat());
        const pieces = cv.connectedComponentsWithStats(stage3.binary, preLabels, preStats, preCentroids, 8, cv.CV_32S) - 1;
        const small = new Uint8Array(pieces + 1);
        const preStatData = preStats.data32S;
        for (let label = 1; label <= pieces; label++) {
          const extent = Math.max(preStatData[label * 5 + cv.CC_STAT_WIDTH], preStatData[label * 5 + cv.CC_STAT_HEIGHT]);
          if (extent < opts.clearBeforeFill) {
            small[label] = 1;
            removedBeforeFill++;
          }
        }
        const withoutSmall = keep(stage3.binary.clone());
        const withoutSmallData = withoutSmall.data;
        const preLabelData = preLabels.data32S;
        for (let p = 0; p < withoutSmallData.length; p++) if (small[preLabelData[p]]) withoutSmallData[p] = 0;
        source = withoutSmall;
      }
      if (opts.fillKernel > 1) {
        const fillKernel = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(opts.fillKernel, opts.fillKernel)));
        const filled = keep(new cv.Mat());
        cv.morphologyEx(source, filled, cv.MORPH_CLOSE, fillKernel);
        source = filled;
      }
      const opened = keep(new cv.Mat());
      cv.morphologyEx(source, opened, cv.MORPH_OPEN, openKernel);

      const labels = keep(new cv.Mat());
      const stats = keep(new cv.Mat());
      const centroids = keep(new cv.Mat());
      const blobCount = cv.connectedComponentsWithStats(opened, labels, stats, centroids, 8, cv.CV_32S) - 1;

      // Stroke half-width per blob: the largest distance-transform value inside it.
      const distance = keep(new cv.Mat());
      cv.distanceTransform(opened, distance, cv.DIST_L2, 3);
      // Typed-array views into the WASM heap are taken after the last allocation
      // they must survive: heap growth detaches older views.
      const statData = stats.data32S;
      const labelData = labels.data32S;
      const distanceData = distance.data32F;
      const strokeRadius = new Float32Array(blobCount + 1);
      // How far each blob reaches into the image, in edge-strip widths (≤ 1: it hugs the edges).
      const stripX = Math.max(1, opts.borderMargin * width);
      const stripY = Math.max(1, opts.borderMargin * height);
      const reach = new Float32Array(blobCount + 1);
      for (let p = 0; p < labelData.length; p++) {
        const label = labelData[p];
        if (!label) continue;
        if (distanceData[p] > strokeRadius[label]) strokeRadius[label] = distanceData[p];
        const x = p % width;
        const y = (p - x) / width;
        const depth = Math.min(x / stripX, (width - 1 - x) / stripX, y / stripY, (height - 1 - y) / stripY);
        if (depth > reach[label]) reach[label] = depth;
      }
      // The largest blob is the main wall network; its strokes set the reference thickness.
      let main = 0;
      for (let label = 1; label <= blobCount; label++) {
        if (!main || statData[label * 5 + cv.CC_STAT_AREA] > statData[main * 5 + cv.CC_STAT_AREA]) main = label;
      }
      const thinStroke = opts.textStrokeRatio * (main ? strokeRadius[main] : 0);

      const keepLabel = new Uint8Array(blobCount + 1);
      let kept = 0;
      let removedAsText = 0;
      let removedAtBorder = 0;
      for (let label = 1; label <= blobCount; label++) {
        const row = label * 5;
        const left = statData[row + cv.CC_STAT_LEFT];
        const top = statData[row + cv.CC_STAT_TOP];
        const w = statData[row + cv.CC_STAT_WIDTH];
        const h = statData[row + cv.CC_STAT_HEIGHT];
        const extent = Math.max(w, h);
        if (statData[row + cv.CC_STAT_AREA] < opts.minBlobArea || extent < opts.minBlobExtent) continue;
        if (extent < 2 * opts.minBlobExtent && strokeRadius[label] < thinStroke) {
          removedAsText++;
          continue;
        }
        // The main wall network is exempt, so a tightly cropped plan keeps its outer walls.
        const touchesEdge = left <= 1 || top <= 1 || left + w >= width - 1 || top + h >= height - 1;
        if (opts.borderMargin > 0 && label !== main && touchesEdge) {
          const band = (w < stripX && h > 0.5 * height) || (h < stripY && w > 0.5 * width);
          if (band || reach[label] <= 1) {
            removedAtBorder++;
            continue;
          }
        }
        keepLabel[label] = 1;
        kept++;
      }
      const filtered = keep(cv.Mat.zeros(height, width, cv.CV_8UC1));
      const filteredData = filtered.data;
      const labelsAfterAlloc = labels.data32S;
      for (let p = 0; p < filteredData.length; p++) {
        if (keepLabel[labelsAfterAlloc[p]]) filteredData[p] = 255;
      }

      const closeKernel = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(opts.closeKernel, opts.closeKernel)));
      const cleaned = keep(new cv.Mat());
      cv.morphologyEx(filtered, cleaned, cv.MORPH_CLOSE, closeKernel);
      return { cleaned, blobCount, kept, removedAsText, removedAtBorder, removedBeforeFill, wallStroke: main ? strokeRadius[main] * 2 : 0 };
    });
    stages.push({
      id: 4,
      title: 'Clean-up',
      params: {
        ...(opts.fillKernel > 1 ? { 'Fill first': `${opts.fillKernel}×${opts.fillKernel}` } : {}),
        Opening: `${opts.openKernel}×${opts.openKernel}`,
        'Min blob area': `${opts.minBlobArea} px`,
        'Min blob extent': `${opts.minBlobExtent} px`,
        'Text stroke': `< ${Math.round(opts.textStrokeRatio * 100)}% of main wall`,
        Closing: `${opts.closeKernel}×${opts.closeKernel}`,
      },
      counts: {
        ...(opts.fillKernel > 1 && opts.clearBeforeFill > 0 ? { 'Small pieces removed before fill': stage4.removedBeforeFill } : {}),
        'Blobs found': stage4.blobCount,
        'Blobs kept': stage4.kept,
        'Blobs removed': stage4.blobCount - stage4.kept,
        'Removed as text': stage4.removedAsText,
        'Removed at the image edge': stage4.removedAtBorder,
        'Main wall stroke px': Math.round(stage4.wallStroke),
        'Ink pixels after': cv.countNonZero(stage4.cleaned),
      },
      timingMs: ms4,
      image: removalOverlay(stage3.binary, stage4.cleaned),
    });

    // Stage 5: Canny on the cleaned mask, thresholds derived from Otsu.
    const canny = cannyThresholds(stage3.otsu);
    const [edges, ms5] = timed(() => {
      const out = keep(new cv.Mat());
      cv.Canny(stage4.cleaned, out, canny.low, canny.high, 3, false);
      return out;
    });
    stages.push({
      id: 5,
      title: 'Canny edges',
      params: { 'T low': Math.round(canny.low), 'T high': Math.round(canny.high), Aperture: 3 },
      counts: { 'Edge pixels': cv.countNonZero(edges) },
      timingMs: ms5,
      image: toRgba(cv, edges),
    });

    // Stage 6: probabilistic Hough on the edges gives raw line segments.
    const [rawSegments, ms6] = timed(() => {
      const lines = keep(new cv.Mat());
      cv.HoughLinesP(edges, lines, 1, Math.PI / 180, opts.houghVotes, opts.minLineLength, opts.maxLineGap);
      const d = lines.data32S;
      const segments: Segment2D[] = [];
      for (let i = 0; i < lines.rows; i++) {
        segments.push({ id: `h${i}`, ax: d[i * 4], ay: d[i * 4 + 1], bx: d[i * 4 + 2], by: d[i * 4 + 3], thickness: 0 });
      }
      return segments;
    });
    const stats = summarizeSegments(rawSegments, opts.angleToleranceDeg, maxWallThicknessPx(width, height));

    const dimmed = keep(new cv.Mat());
    stage4.cleaned.convertTo(dimmed, -1, 0.22, 0);
    const overlay = keep(new cv.Mat());
    cv.cvtColor(dimmed, overlay, cv.COLOR_GRAY2RGBA);
    // Thick enough to survive being shown scaled down; endpoint dots show where
    // one wall face is split into several fragments.
    const lineWidth = Math.max(2, Math.round(Math.max(width, height) / 400));
    for (const s of rawSegments) {
      const [r, g, b] = HOUGH_COLORS[classifySegment(s, opts.angleToleranceDeg)];
      const color = new cv.Scalar(r, g, b, 255);
      const a = new cv.Point(s.ax, s.ay);
      const e = new cv.Point(s.bx, s.by);
      cv.line(overlay, a, e, color, lineWidth, cv.LINE_AA);
      cv.circle(overlay, a, lineWidth + 1, color, -1, cv.LINE_AA);
      cv.circle(overlay, e, lineWidth + 1, color, -1, cv.LINE_AA);
    }
    stages.push({
      id: 6,
      title: 'Hough segments',
      params: {
        Votes: opts.houghVotes,
        'Min length': `${opts.minLineLength} px`,
        'Max gap': `${opts.maxLineGap} px`,
      },
      counts: {
        'Raw segments': stats.total,
        Horizontal: stats.horizontal,
        Vertical: stats.vertical,
        Slanted: stats.oblique,
      },
      timingMs: ms6,
      image: toRgba(cv, overlay),
    });

    // Stage 7: raw segments to walls. Pairing checks for ink between two faces in the cleaned
    // mask, copied out of the WASM heap so later allocations cannot detach it.
    const mask = new Uint8Array(stage4.cleaned.data);
    const isInk = (x: number, y: number) => {
      const xi = Math.round(x);
      const yi = Math.round(y);
      return xi >= 0 && yi >= 0 && xi < width && yi < height && mask[yi * width + xi] > 0;
    };
    const vectorOptions = {
      ...defaultVectorizeOptions(width, height, opts.minLineLength, maxWallThicknessPx(width, height)),
      thinWallRatio: opts.thinWallRatio,
      networkShare: opts.networkShare,
      isInk,
    };
    const [vector, ms7] = timed(() => vectorizeWalls(rawSegments, vectorOptions));

    const wallOverlay = keep(new cv.Mat());
    cv.cvtColor(dimmed, wallOverlay, cv.COLOR_GRAY2RGBA);
    const toScalar = ([r, g, b]: [number, number, number]) => new cv.Scalar(r, g, b, 255);
    for (const s of vector.setAside) {
      cv.line(wallOverlay, new cv.Point(s.ax, s.ay), new cv.Point(s.bx, s.by), toScalar(WALL_COLORS.setAside), lineWidth, cv.LINE_AA);
    }
    for (const w of vector.walls) {
      const a = new cv.Point(w.ax, w.ay);
      const b = new cv.Point(w.bx, w.by);
      cv.line(wallOverlay, a, b, toScalar(WALL_COLORS.body), Math.max(1, Math.round(w.thickness)), cv.LINE_8);
    }
    for (const w of vector.walls) {
      const a = new cv.Point(w.ax, w.ay);
      const b = new cv.Point(w.bx, w.by);
      cv.line(wallOverlay, a, b, toScalar(WALL_COLORS.centerline), lineWidth, cv.LINE_AA);
      cv.circle(wallOverlay, a, lineWidth + 1, toScalar(WALL_COLORS.centerline), -1, cv.LINE_AA);
      cv.circle(wallOverlay, b, lineWidth + 1, toScalar(WALL_COLORS.centerline), -1, cv.LINE_AA);
    }
    stages.push({
      id: 7,
      title: 'Walls',
      params: {
        Deskew: `${vector.skewDeg.toFixed(1)}°`,
        'Angle snap': `±${vectorOptions.angleToleranceDeg}°`,
        'Merge gap': `${vectorOptions.mergeGap} px`,
        'Wall thickness': `${vectorOptions.minThickness}–${vectorOptions.maxThickness} px`,
        'Snap radius': `${vectorOptions.snapRadius} px`,
      },
      counts: {
        'Raw segments': vector.counts.input,
        'Set aside': vector.counts.setAside,
        'Lines after merge': vector.counts.lines,
        'Face pairs': vector.counts.facePairs,
        'Dropped as thin lines': vector.counts.droppedThin,
        'Dropped as stray pieces': vector.counts.droppedStray,
        Walls: vector.counts.walls,
        'Junctions closed': vector.counts.junctions,
      },
      timingMs: ms7,
      image: toRgba(cv, wallOverlay),
    });

    return {
      stages,
      rawSegments,
      walls: vector.walls,
      vector,
      stats,
      options: opts,
      otsuThreshold: stage3.otsu,
      inputSize: { width: input.width, height: input.height },
      workingSize: { width, height },
      totalMs: stages.reduce((sum, s) => sum + s.timingMs, 0),
    };
  } finally {
    for (const m of mats) m.delete();
  }
}
