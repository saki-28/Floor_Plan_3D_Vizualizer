/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy, useEffect, useReducer, useState } from 'react';
import { AppShell } from './components/AppShell';
import { Start } from './components/Start';
import { OpenGLCanvas } from './components/OpenGLCanvas';
import { ImagePipelineLab } from './components/ImagePipelineLab';
import { PlanEditor } from './components/PlanEditor';
import { ProjectStatus } from './components/ProjectStatus';
import { SAMPLE_FLOORPLANS } from './data/sampleFloorplans';
import type { FloorPlanDataset } from './types/floorplan';
import { autosavePlan, loadAutosavedPlan } from './data/planStorage';
import { initialPlanState, planReducer } from './data/planHistory';
import { useScreen } from './router';
import { useTheme } from './theme';

// How it works pages load only when opened, so the Studio stays light.
const PipelinePage = lazy(() => import('./components/PipelinePage').then((m) => ({ default: m.PipelinePage })));
const ResultsPage = lazy(() => import('./components/ResultsPage').then((m) => ({ default: m.ResultsPage })));
const AboutPage = lazy(() => import('./components/AboutPage').then((m) => ({ default: m.AboutPage })));
const CGAlgorithmsLab = lazy(() => import('./components/CGAlgorithmsLab').then((m) => ({ default: m.CGAlgorithmsLab })));

/** An empty plan for drawing from scratch. */
function blankPlan(): FloorPlanDataset {
  return {
    id: `plan-${Date.now().toString(36)}`,
    name: 'New plan',
    description: 'Drawn in Edit plan.',
    difficulty: 'Clean Orthogonal',
    widthPx: 800,
    heightPx: 600,
    scale: 0.015,
    u0: 400,
    v0: 300,
    walls: [],
    openings: [],
    rooms: [],
    furniture: [],
  };
}

export default function App() {
  const [theme, setTheme] = useTheme();
  const [screen, navigate] = useScreen();
  // The one current plan (walls, doors and windows, rooms) with its undo history: every screen
  // reads it, Edit plan changes it, and it is autosaved in this browser so a reload comes back to it.
  const [state, dispatch] = useReducer(planReducer, undefined, () =>
    initialPlanState(loadAutosavedPlan(SAMPLE_FLOORPLANS) ?? SAMPLE_FLOORPLANS[0]),
  );
  const plan = state.plan;
  const [wallHeight, setWallHeight] = useState<number>(2.8);
  const [wallThickness, setWallThickness] = useState<number>(0.22);
  const [showFurniture, setShowFurniture] = useState<boolean>(true);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => autosavePlan(plan), 400);
    return () => window.clearTimeout(timer);
  }, [plan]);

  const openPlan = (next: FloorPlanDataset) => {
    dispatch({ type: 'replace', plan: next });
    setSelectedWallId(null);
  };

  // Walls found in an image replace the open plan and are shown in 3D.
  const openDetected = (detected: FloorPlanDataset) => {
    openPlan(detected);
    navigate('viewer3d');
  };

  const viewer = (compact: boolean) => (
    <OpenGLCanvas
      compact={compact}
      floorplan={plan}
      walls={plan.walls}
      wallHeight={wallHeight}
      onChangeWallHeight={setWallHeight}
      wallThickness={wallThickness}
      onChangeWallThickness={setWallThickness}
      showFurniture={showFurniture}
      onToggleFurniture={() => setShowFurniture((prev) => !prev)}
      selectedWallId={selectedWallId}
      onSelectWall={setSelectedWallId}
      theme={theme}
    />
  );

  return (
    <AppShell screen={screen} plan={plan} onSelectPlan={openPlan} theme={theme} onChangeTheme={setTheme}>
      {screen === 'start' && <Start plan={plan} />}

      {screen === 'viewer3d' && viewer(false)}

      {screen === 'imageLab' && <ImagePipelineLab onOpenIn3D={openDetected} />}

      {screen === 'edit' && (
        <PlanEditor
          plan={plan}
          onEdit={(content, mergeKey) => dispatch({ type: 'edit', ...content, mergeKey })}
          onSettle={() => dispatch({ type: 'settle' })}
          onUndo={() => dispatch({ type: 'undo' })}
          onRedo={() => dispatch({ type: 'redo' })}
          canUndo={state.past.length > 0}
          canRedo={state.future.length > 0}
          onRename={(name) => dispatch({ type: 'rename', name })}
          onNewPlan={() => openPlan(blankPlan())}
          preview={viewer(true)}
        />
      )}

      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        {screen === 'pipeline' && <PipelinePage onOpenIn3D={openDetected} />}
        {screen === 'results' && <ResultsPage />}
        {screen === 'graphics' && <CGAlgorithmsLab />}
        {screen === 'about' && <AboutPage />}
      </Suspense>

      {screen === 'status' && <ProjectStatus />}
    </AppShell>
  );
}
