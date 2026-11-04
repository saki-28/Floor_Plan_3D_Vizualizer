/**
 * Writes synthetic floor-plan test images to public/test-plans/, plus a
 * manifest.json with each image's ground-truth walls (pixel centerlines).
 *
 *   npm run gen:test-plans
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { SAMPLE_FLOORPLANS } from '../src/data/sampleFloorplans';
import { renderSyntheticPlan, type SyntheticPlanOptions } from '../src/vision/syntheticPlan';

interface TestPlanSpec {
  id: string;
  planId: string;
  name: string;
  description: string;
  options: Partial<SyntheticPlanOptions>;
}

const SPECS: TestPlanSpec[] = [
  {
    id: 'apt-2bed-clean',
    planId: 'apt-2bed',
    name: 'Two-bedroom apartment (clean)',
    description: 'Clean drawing: doors with swing arcs, windows, room labels, dimension lines.',
    options: {},
  },
  {
    id: 'studio-loft-clean',
    planId: 'studio-loft',
    name: 'Studio loft (clean)',
    description: 'Simple plan with one partitioned bathroom.',
    options: {},
  },
  {
    id: 'bungalow-l-clean',
    planId: 'bungalow-l',
    name: 'L-shaped bungalow (clean)',
    description: 'Concave outline with thick exterior walls.',
    options: {},
  },
  {
    id: 'office-scan-noisy',
    planId: 'noisy-scan',
    name: 'Office (scan: noise, bold labels)',
    description: 'Tinted paper, uneven lighting, grain, specks, and bold labels thick enough to survive the opening.',
    options: { scanNoise: true, labelScale: 3, seed: 7 },
  },
  {
    id: 'apt-2bed-rotated',
    planId: 'apt-2bed',
    name: 'Two-bedroom apartment (scan, rotated 2°)',
    description: 'Scan noise plus a 2° rotation, so walls are slightly off-axis.',
    options: { scanNoise: true, rotationDeg: 2, seed: 11 },
  },
];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Minimal 8-bit grayscale PNG encoder. */
function encodeGrayPng(width: number, height: number, gray: Uint8Array): Buffer {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // filter: none
    raw.set(gray.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // colour type: grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
}

const round1 = (v: number) => Math.round(v * 10) / 10;

const outDir = new URL('../public/test-plans/', import.meta.url);
mkdirSync(outDir, { recursive: true });

const manifest = {
  generatedBy: 'scripts/generate-test-plans.ts',
  plans: SPECS.map((spec) => {
    const plan = SAMPLE_FLOORPLANS.find((p) => p.id === spec.planId);
    if (!plan) throw new Error(`Unknown sample plan ${spec.planId}`);
    const image = renderSyntheticPlan(plan, spec.options);
    const file = `${spec.id}.png`;
    writeFileSync(new URL(file, outDir), encodeGrayPng(image.width, image.height, image.gray));
    console.log(`${file}: ${image.width}×${image.height}, ${image.groundTruth.length} walls`);
    return {
      id: spec.id,
      file,
      name: spec.name,
      description: spec.description,
      sourcePlanId: spec.planId,
      width: image.width,
      height: image.height,
      pixelsPerMeter: image.pixelsPerMeter,
      wallCount: image.groundTruth.length,
      groundTruthPieces: image.groundTruthPieces.map((s) => ({
        id: s.id,
        ax: round1(s.ax),
        ay: round1(s.ay),
        bx: round1(s.bx),
        by: round1(s.by),
        thickness: round1(s.thickness),
      })),
      groundTruthWalls: image.groundTruth.map((s) => ({
        id: s.id,
        ax: round1(s.ax),
        ay: round1(s.ay),
        bx: round1(s.bx),
        by: round1(s.by),
        thickness: round1(s.thickness),
      })),
    };
  }),
};

writeFileSync(new URL('manifest.json', outDir), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${manifest.plans.length} test plans to public/test-plans/`);
