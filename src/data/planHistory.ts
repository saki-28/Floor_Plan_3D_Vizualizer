/**
 * The current plan with undo and redo. Every edit records the walls and openings it replaced;
 * a run of edits sharing a merge key (one drag, say) is one step to undo. Opening another plan
 * starts a fresh history.
 */

import type { FloorPlanDataset, Opening2D, WallSegment2D } from '../types/floorplan';
import { pruneOpenings } from '../utils/openings';

export interface PlanContent {
  walls: WallSegment2D[];
  openings: Opening2D[];
}

export interface PlanState {
  plan: FloorPlanDataset;
  past: PlanContent[];
  future: PlanContent[];
  /** The merge key of the last edit, while its run is still going. */
  mergeKey: string | null;
}

export type PlanAction =
  | { type: 'replace'; plan: FloorPlanDataset }
  | { type: 'edit'; walls: WallSegment2D[]; openings: Opening2D[]; mergeKey?: string }
  | { type: 'rename'; name: string }
  | { type: 'settle' }
  | { type: 'undo' }
  | { type: 'redo' };

/** How many steps can be undone. */
export const HISTORY_LIMIT = 100;

export const initialPlanState = (plan: FloorPlanDataset): PlanState => ({ plan, past: [], future: [], mergeKey: null });

const contentOf = (plan: FloorPlanDataset): PlanContent => ({ walls: plan.walls, openings: plan.openings });

export function planReducer(state: PlanState, action: PlanAction): PlanState {
  switch (action.type) {
    case 'replace':
      return initialPlanState(action.plan);
    case 'edit': {
      // A deleted wall takes its doors and windows with it.
      const next = { walls: action.walls, openings: pruneOpenings(action.openings, action.walls) };
      const merging = action.mergeKey !== undefined && action.mergeKey === state.mergeKey;
      return {
        plan: { ...state.plan, ...next },
        past: merging ? state.past : [...state.past, contentOf(state.plan)].slice(-HISTORY_LIMIT),
        future: [],
        mergeKey: action.mergeKey ?? null,
      };
    }
    case 'rename':
      // Naming the plan is not a step to undo; it only changes the label and the file name.
      return { ...state, plan: { ...state.plan, name: action.name } };
    case 'settle':
      return state.mergeKey === null ? state : { ...state, mergeKey: null };
    case 'undo': {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return {
        plan: { ...state.plan, ...previous },
        past: state.past.slice(0, -1),
        future: [contentOf(state.plan), ...state.future],
        mergeKey: null,
      };
    }
    case 'redo': {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return {
        plan: { ...state.plan, ...next },
        past: [...state.past, contentOf(state.plan)].slice(-HISTORY_LIMIT),
        future: rest,
        mergeKey: null,
      };
    }
  }
}
