/**
 * Reads the walls, doors and windows of a CubiCasa5k `model.svg` the way CubiCasa's own loader
 * does (floortrans/loaders/svg_utils.py): every `<g>` whose id is Wall, Door or Window, taking the
 * `points` of its first direct `<polygon>` child as "x,y" pairs, with no transform applied.
 */

import type { Point } from './maskScore';

export interface CubiCasaAnnotation {
  width?: number;
  height?: number;
  walls: Point[][];
  doors: Point[][];
  windows: Point[][];
}

const ATTRIBUTE = (name: string) => new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`);

function parsePoints(points: string): Point[] {
  return points
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(',').map(Number))
    .filter((xy): xy is [number, number] => xy.length === 2 && xy.every(Number.isFinite));
}

export function parseCubiCasaSvg(svg: string): CubiCasaAnnotation {
  const result: CubiCasaAnnotation = { walls: [], doors: [], windows: [] };
  const root = svg.match(/<svg\b[^>]*>/);
  if (root) {
    const width = Number(root[0].match(ATTRIBUTE('width'))?.[1]);
    const height = Number(root[0].match(ATTRIBUTE('height'))?.[1]);
    if (Number.isFinite(width)) result.width = width;
    if (Number.isFinite(height)) result.height = height;
  }

  // A stack of open <g> elements: the id of each, and whether its first polygon was taken.
  const stack: { id: string; taken: boolean }[] = [];
  const tags = /<(\/?)(g|polygon)\b([^>]*?)(\/?)>/g;
  for (let m = tags.exec(svg); m; m = tags.exec(svg)) {
    const [, closing, tag, attributes, selfClosing] = m;
    if (tag === 'g') {
      if (closing) stack.pop();
      else if (!selfClosing) stack.push({ id: attributes.match(ATTRIBUTE('id'))?.[1] ?? '', taken: false });
      continue;
    }
    if (closing) continue;
    const parent = stack[stack.length - 1];
    if (!parent || parent.taken) continue;
    const list = parent.id === 'Wall' ? result.walls : parent.id === 'Door' ? result.doors : parent.id === 'Window' ? result.windows : null;
    if (!list) continue;
    const points = parsePoints(attributes.match(ATTRIBUTE('points'))?.[1] ?? '');
    if (points.length >= 3) list.push(points);
    parent.taken = true;
  }
  return result;
}
