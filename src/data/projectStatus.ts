/**
 * MVP progress, as estimated in the code review of 4 Nov 2026 (web app scope:
 * plan → 3D, draw your own, image → 3D, plus testing and reporting).
 * Weights are shares of the MVP and sum to 100; `done` is the fraction of each
 * item that works today. Every total on screen is computed from these rows.
 */

export type ScreenLink = 'viewer3d' | 'imageLab';

export interface WorkItem {
  name: string;
  weight: number;
  done: number;
  note: string;
}

export interface Phase {
  id: string;
  name: string;
  items: WorkItem[];
}

export const STATUS_DATE = '5 Nov 2026';

export const PHASES: Phase[] = [
  {
    id: 'plan-to-3d',
    name: 'Plan to 3D',
    items: [
      { name: '3D viewer', weight: 10, done: 1, note: 'Orbit, fitted preset views, turn and zoom controls, measuring, OBJ export and touch gestures work' },
      { name: 'Door and window openings', weight: 10, done: 0.9, note: 'Doors and windows are their own list (any number per wall) and are cut into the 3D walls and the OBJ export, with sills and lintels; no glass or door leaves yet' },
      { name: 'Floors for any plan', weight: 5, done: 0.4, note: 'Floors only appear where room outlines were typed in' },
      { name: 'Plan files: save and load', weight: 5, done: 0.9, note: 'One versioned JSON plan format for every source; Open, Save and autosave in this browser; files from the older per-wall format are converted' },
    ],
  },
  {
    id: 'draw',
    name: 'Draw your own',
    items: [
      { name: 'Drawing tools', weight: 8, done: 0.8, note: 'Edit plan draws walls corner by corner and moves wall ends or whole walls, snapping to wall ends, wall sides (T junctions) and a 10 cm grid; joined walls move together. Rooms and floors are not drawn yet' },
      { name: 'Undo, redo and saving', weight: 5, done: 1, note: 'Undo and redo for every edit (one drag is one step, up to 100 steps), autosave in this browser, and Save to a file' },
      { name: 'Live 3D beside the drawing', weight: 5, done: 0.9, note: 'A 3D preview beside the drawing updates with every edit; it does not yet highlight the selected wall' },
      { name: 'Doors and windows on walls', weight: 4, done: 0.9, note: 'Placed with a click where they go, dragged along the wall, and sized by typing width, sill and height; not yet resized by dragging their ends' },
      { name: 'Home with the ways in', weight: 3, done: 1, note: 'Start links the three ways in; How it works is a separate area with its own page links' },
    ],
  },
  {
    id: 'image',
    name: 'Image to 3D',
    items: [
      { name: 'Lines to walls (step 7)', weight: 12, done: 0.6, note: 'Perfect on the 5 generated images; on all 400 CubiCasa5k test plans the rules reach 43% wall IoU and a trained model 74% (doors and windows 73%); the model is not in the app yet' },
      { name: 'Upload and clean-up (steps 1–6)', weight: 10, done: 0.9, note: 'Real OpenCV.js; tested on 5 generated images, no real scans yet' },
      { name: 'Scale step and hand-off to the editor', weight: 4, done: 0.5, note: 'Detected walls become the open plan, so they show in 3D and can be fixed in Edit plan; no scale step yet, so an upload\'s size is guessed from wall thickness' },
      { name: 'Explanation with real numbers', weight: 4, done: 1, note: 'How it works → Pipeline explains the same run as Image to plan, step by step: its image, typeset formula, settings, counts and time, then the step into 3D' },
    ],
  },
  {
    id: 'across',
    name: 'Testing and report',
    items: [
      { name: 'Automated tests', weight: 5, done: 0.8, note: '62 tests: geometry, door and window holes, plan files, plan editing and undo, image pipeline, wall detection, false-wall filters, scoring, every formula shown, and the results data; 4 more for the training labels' },
      { name: 'Accuracy and speed measurements', weight: 5, done: 0.8, note: 'Scripted CubiCasa5k evaluation (npm run eval:cubicasa) on the dataset\'s 400 test plans, for the rules or a trained model\'s masks, with a breakdown of where false walls fall; shown on How it works → Results; no 3D speed benchmarks yet' },
      { name: 'Report, slides and demo', weight: 5, done: 0.2, note: 'Plan documents exist; How it works now holds the results, sources and limits the report needs' },
    ],
  },
];

export const phaseWeight = (phase: Phase) => phase.items.reduce((sum, item) => sum + item.weight, 0);
export const phaseDone = (phase: Phase) => phase.items.reduce((sum, item) => sum + item.weight * item.done, 0);

export const MVP_WEIGHT = PHASES.reduce((sum, phase) => sum + phaseWeight(phase), 0);
export const MVP_DONE = PHASES.reduce((sum, phase) => sum + phaseDone(phase), 0);

console.assert(MVP_WEIGHT === 100, `MVP weights should sum to 100, got ${MVP_WEIGHT}`);
// The screen shows points to one decimal; keep every item on an exact tenth so the shown parts add up to the shown total.
console.assert(
  PHASES.every((phase) => phase.items.every((item) => Math.abs(item.weight * item.done * 10 - Math.round(item.weight * item.done * 10)) < 1e-9)),
  'Every item\'s points should be an exact tenth',
);

/** The unfinished item with the most MVP weight still missing. */
export const BIGGEST_GAP = PHASES.flatMap((phase) => phase.items).reduce((worst, item) =>
  item.weight * (1 - item.done) > worst.weight * (1 - worst.done) ? item : worst,
);

export type ItemState = 'done' | 'in-progress' | 'not-started';

export function itemState(item: WorkItem): ItemState {
  if (item.done >= 0.9) return 'done';
  return item.done > 0 ? 'in-progress' : 'not-started';
}
