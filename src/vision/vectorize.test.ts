/**
 * Stage 7 tests on hand-built raw segments: face pairing, gap bridging through ink, openings
 * left open, junction closing, deskew and slanted segments set aside.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { Segment2D } from '../types/floorplan.ts';
import { defaultVectorizeOptions, estimateSkew, vectorizeWalls } from './vectorize.ts';
import { scoreWalls } from './scoreWalls.ts';

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const seg = (ax: number, ay: number, bx: number, by: number): Segment2D => ({ id: '', ax, ay, bx, by, thickness: 0 });

/**
 * A 400×300 room with 16 px walls (outer box 100..500 × 100..400), a 10 px interior wall from
 * the top wall down to y = 300, and a 60 px door in the bottom wall at x 250..310.
 */
const W = 600;
const H = 500;
const solids: Rect[] = [
  { x0: 100, y0: 100, x1: 500, y1: 116 }, // top
  { x0: 100, y0: 384, x1: 250, y1: 400 }, // bottom, left of the door
  { x0: 310, y0: 384, x1: 500, y1: 400 }, // bottom, right of the door
  { x0: 100, y0: 100, x1: 116, y1: 400 }, // left
  { x0: 484, y0: 100, x1: 500, y1: 400 }, // right
  { x0: 295, y0: 116, x1: 305, y1: 300 }, // interior, joins the top wall
];
const isInk = (x: number, y: number) => solids.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);

/** The faces Hough would see, deliberately fragmented: some face pieces are missing. */
const rawFaces: Segment2D[] = [
  seg(100, 100, 300, 100), seg(330, 100, 500, 100), // top outer face, a piece missing at 300..330
  seg(116, 116, 295, 116), seg(305, 116, 484, 116), // top inner face, interrupted by the interior wall
  seg(100, 400, 250, 400), seg(116, 384, 250, 384), // bottom left of the door
  seg(310, 400, 500, 400), seg(310, 384, 484, 384), // bottom right of the door
  seg(100, 100, 100, 400), seg(116, 116, 116, 384), // left faces
  seg(500, 100, 500, 400), seg(484, 116, 484, 250), // right faces, inner one only half found
  seg(295, 116, 295, 300), seg(305, 116, 305, 300), // interior faces
];

const truth: Segment2D[] = [
  seg(108, 108, 492, 108), // top centerline
  seg(108, 392, 250, 392), // bottom left piece
  seg(310, 392, 492, 392), // bottom right piece
  seg(108, 108, 108, 392), // left
  seg(492, 108, 492, 392), // right
  seg(300, 108, 300, 300), // interior
];

test('[Walls] pairs faces into centerlines, bridges gaps through ink, keeps the door open, closes junctions', () => {
  const options = { ...defaultVectorizeOptions(W, H, 20, 30), isInk };
  const result = vectorizeWalls(rawFaces, options);
  const score = scoreWalls(result.walls, truth, { tolerancePx: 3 });
  assert.equal(result.walls.length, truth.length, `expected ${truth.length} walls, got ${result.walls.length}`);
  assert.equal(score.piecesFound, truth.length);
  assert.ok(score.precision > 0.98 && score.recall > 0.98, `precision ${score.precision}, recall ${score.recall}`);

  const thick = result.walls.filter((w) => w.thickness > 13).length;
  const thin = result.walls.filter((w) => w.thickness < 13).length;
  assert.equal(thick, 5, 'outer walls measure about 16 px');
  assert.equal(thin, 1, 'the interior wall measures about 10 px');
});

test('[Walls] without the mask, gaps inside a wall stay open (no evidence to bridge them)', () => {
  const result = vectorizeWalls(rawFaces, defaultVectorizeOptions(W, H, 20, 30));
  const score = scoreWalls(result.walls, truth, { tolerancePx: 3 });
  assert.ok(score.precision > 0.98, 'what is found is still right');
  assert.ok(score.recall < 0.95, 'but the missing face pieces leave holes');
});

test('[Walls] a rotated drawing is deskewed, and slanted segments are set aside', () => {
  const angle = (3 * Math.PI) / 180;
  const rotate = (s: Segment2D): Segment2D => {
    const r = (x: number, y: number) => [300 + (x - 300) * Math.cos(angle) - (y - 250) * Math.sin(angle), 250 + (x - 300) * Math.sin(angle) + (y - 250) * Math.cos(angle)];
    const [ax, ay] = r(s.ax, s.ay);
    const [bx, by] = r(s.bx, s.by);
    return { ...s, ax, ay, bx, by };
  };
  const rotated = rawFaces.map(rotate);
  assert.ok(Math.abs(estimateSkew(rotated, 5) - 3) < 0.05, 'skew of 3° recovered');

  const result = vectorizeWalls([...rotated, seg(150, 150, 260, 260)], defaultVectorizeOptions(W, H, 20, 30));
  assert.equal(result.counts.setAside, 1, 'the 45° segment is set aside');
  assert.ok(Math.abs(result.skewDeg - 3) < 0.05);
  const score = scoreWalls(result.walls, truth.map(rotate), { tolerancePx: 3 });
  assert.ok(score.precision > 0.98, `walls land on the rotated truth (precision ${score.precision})`);
});

test('[Walls] lines of a tiled floor are not paired around the line between them', () => {
  // Three thin lines 30 px apart: the outer two are 60 px apart with the middle one on their
  // centerline, so the centerline is ink but the rest of the band is paper: not a wall. A solid
  // 40 px band beside them is one.
  const tiles: Rect[] = [200, 230, 260].map((x) => ({ x0: x - 1.5, y0: 100, x1: x + 1.5, y1: 300 }));
  const band: Rect = { x0: 400, y0: 100, x1: 440, y1: 300 };
  const ink = (x: number, y: number) => [...tiles, band].some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
  const faces = [200, 230, 260, 400, 440].map((x) => seg(x, 100, x, 300));
  const result = vectorizeWalls(faces, { ...defaultVectorizeOptions(W, H, 20, 60), isInk: ink });
  assert.equal(result.walls.length, 1, `walls: ${result.walls.map((w) => `x ${w.ax.toFixed(0)} t ${w.thickness.toFixed(1)}`).join('; ')}`);
  assert.ok(Math.abs(result.walls[0].ax - 420) < 1 && Math.abs(result.walls[0].thickness - 40) < 2, 'the solid band');
});

test('[Walls] a thin line and a stray block are dropped; every real wall is kept', () => {
  const extras: Rect[] = [
    { x0: 100, y0: 450, x1: 500, y1: 455 }, // a dimension line under the plan, 5 px thick
    { x0: 380, y0: 200, x1: 440, y1: 216 }, // a solid furniture block inside the room, touching no wall
  ];
  const ink = (x: number, y: number) => isInk(x, y) || extras.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
  const faces = [...rawFaces, seg(100, 450, 500, 450), seg(100, 455, 500, 455), seg(380, 200, 440, 200), seg(380, 216, 440, 216)];
  const base = { ...defaultVectorizeOptions(W, H, 20, 30), isInk: ink };

  const unfiltered = vectorizeWalls(faces, base);
  assert.equal(unfiltered.walls.length, truth.length + 2, 'without the filters both extras read as walls');

  const result = vectorizeWalls(faces, { ...base, thinWallRatio: 0.4, networkShare: 0.1 });
  assert.equal(result.counts.droppedThin, 1, 'the dimension line is too thin to be a wall');
  assert.equal(result.counts.droppedStray, 1, 'the block is not part of the wall network');
  const score = scoreWalls(result.walls, truth, { tolerancePx: 3 });
  assert.equal(result.walls.length, truth.length);
  assert.equal(score.piecesFound, truth.length, 'the 10 px interior wall survives the thin filter');
});
