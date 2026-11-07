/**
 * Pieces shared by the two pages that show a pipeline run (Image to plan, and How it works →
 * Pipeline): a stage's image on a canvas, the colour key under it, and number formatting.
 */

import React, { useEffect, useRef } from 'react';
import { HOUGH_COLORS, REMOVED_COLOR, WALL_COLORS, type RgbaImage, type StageId } from '../vision/pipeline';

export const rgb = (c: [number, number, number]) => `rgb(${c.join(',')})`;
export const formatMs = (ms: number) => `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;
export const formatEntries = (entries: Record<string, string | number>) =>
  Object.entries(entries)
    .map(([key, value]) => `${key} ${value}`)
    .join(' · ');

export const StageCanvas: React.FC<{ image: RgbaImage; className?: string; label: string }> = ({ image, className, label }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d')?.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  }, [image]);
  return <canvas ref={ref} className={className} role="img" aria-label={label} />;
};

const Swatch: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <span className="flex items-center gap-1.5">
    <span className="inline-block h-2.5 w-2.5 rounded-sm ring-1 ring-line" style={{ background: color }} />
    {label}
  </span>
);

/** The colour key for the stages whose images are overlays (4, 6 and 7). */
export const StageLegend: React.FC<{ id: StageId }> = ({ id }) => {
  const keys: Partial<Record<StageId, [string, string][]>> = {
    4: [
      ['#ffffff', 'Kept'],
      [rgb(REMOVED_COLOR), 'Removed'],
    ],
    6: [
      [rgb(HOUGH_COLORS.horizontal), 'Horizontal'],
      [rgb(HOUGH_COLORS.vertical), 'Vertical'],
      [rgb(HOUGH_COLORS.oblique), 'Slanted'],
    ],
    7: [
      [rgb(WALL_COLORS.centerline), 'Wall centerline'],
      [rgb(WALL_COLORS.body), 'Wall thickness'],
      [rgb(WALL_COLORS.setAside), 'Set aside (slanted)'],
    ],
  };
  const entries = keys[id];
  if (!entries) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {entries.map(([color, label]) => (
        <Swatch key={label} color={color} label={label} />
      ))}
    </div>
  );
};
