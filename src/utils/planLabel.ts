import type { FloorPlanDataset } from '../types/floorplan';

/** "Sample 1: Two-Bedroom Urban Suite (P0 Benchmark)" → "Two-Bedroom Urban Suite". */
export function planLabel(plan: FloorPlanDataset): string {
  return plan.name.replace(/^Sample \d+:\s*/, '').replace(/\s*\(.*\)\s*$/, '');
}
