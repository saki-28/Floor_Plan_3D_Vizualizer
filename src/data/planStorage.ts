/**
 * Autosave: the current plan is kept in this browser (localStorage), in the plan file format, so a
 * reload or a closed tab comes back to the same plan with its edits. Storage can be missing or
 * full (private windows, blocked site data); then the app simply starts from the first sample.
 */

import type { FloorPlanDataset } from '../types/floorplan';
import { parsePlan, samePlan, serializePlan } from './planFile';

const KEY = 'floorplan3d.currentPlan';

/** The autosaved plan, or null. An unedited sample comes back as that sample itself. */
export function loadAutosavedPlan(samples: FloorPlanDataset[]): FloorPlanDataset | null {
  try {
    const text = window.localStorage.getItem(KEY);
    if (!text) return null;
    const plan = parsePlan(text);
    return samples.find((s) => s.id === plan.id && samePlan(s, plan)) ?? plan;
  } catch {
    return null;
  }
}

export function autosavePlan(plan: FloorPlanDataset): void {
  try {
    window.localStorage.setItem(KEY, serializePlan(plan));
  } catch {
    // Storage unavailable or full: the plan still works, it just is not kept across reloads.
  }
}
