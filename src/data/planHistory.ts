/**
 * The current plan with undo and redo. Every edit records the walls and openings it replaced;
 * a run of edits sharing a merge key (one drag, say) is one step to undo. Opening another plan
 * starts a fresh history. A plan whose rooms come from its walls (a drawn plan) gets its rooms
 * worked out again after every change, so floors and room areas follow the walls.
 */

import type { FloorPlanDataset, Opening2D, WallSegment2D } from '../types/floorplan';
import { pruneOpenings } from '../utils/openings';
import { detectRooms, usesDetectedRooms } from '../utils/rooms';

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
  | { type: 'renameRoom'; id: string; name: string }
  | { type: 'settle' }
  | { type: 'undo' }
  | { type: 'redo' };

/** How many steps can be undone. */
export const HISTORY_LIMIT = 100;

/** The plan with new walls and openings, and, when its rooms come from its walls, rooms to match. */
function withContent(plan: FloorPlanDataset, content: PlanContent): FloorPlanDataset {
  const next = { ...plan, ...content };
  return usesDetectedRooms(plan.rooms) ? { ...next, rooms: detectRooms(next.walls, plan.rooms) } : next;
}

export const initialPlanState = (plan: FloorPlanDataset): PlanState => ({
  plan: withContent(plan, contentOf(plan)),
  past: [],
  future: [],
  mergeKey: null,
});

function contentOf(plan: FloorPlanDataset): PlanContent {
  return { walls: plan.walls, openings: plan.openings };
}

export function planReducer(state: PlanState, action: PlanAction): PlanState {
  switch (action.type) {
    case 'replace':
      return initialPlanState(action.plan);
    case 'edit': {
      // A deleted wall takes its doors and windows with it.
      const next = { walls: action.walls, openings: pruneOpenings(action.openings, action.walls) };
      const merging = action.mergeKey !== undefined && action.mergeKey === state.mergeKey;
      return {
        plan: withContent(state.plan, next),
        past: merging ? state.past : [...state.past, contentOf(state.plan)].slice(-HISTORY_LIMIT),
        future: [],
        mergeKey: action.mergeKey ?? null,
      };
    }
    case 'rename':
      // Naming the plan is not a step to undo; it only changes the label and the file name.
      return { ...state, plan: { ...state.plan, name: action.name } };
    case 'renameRoom':
      // Like the plan's name, a room's name is a label, not a step to undo. Detected rooms keep it as walls move.
      return { ...state, plan: { ...state.plan, rooms: state.plan.rooms.map((r) => (r.id === action.id ? { ...r, name: action.name } : r)) } };
    case 'settle':
      return state.mergeKey === null ? state : { ...state, mergeKey: null };
    case 'undo': {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return {
        plan: withContent(state.plan, previous),
        past: state.past.slice(0, -1),
        future: [contentOf(state.plan), ...state.future],
        mergeKey: null,
      };
    }
    case 'redo': {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return {
        plan: withContent(state.plan, next),
        past: [...state.past, contentOf(state.plan)].slice(-HISTORY_LIMIT),
        future: rest,
        mergeKey: null,
      };
    }
  }
}
