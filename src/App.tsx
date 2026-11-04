/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { AppShell, type Screen } from './components/AppShell';
import { Overview } from './components/Overview';
import { OpenGLCanvas } from './components/OpenGLCanvas';
import { CVVisualizer } from './components/CVVisualizer';
import { ImagePipelineLab } from './components/ImagePipelineLab';
import { CGAlgorithmsLab } from './components/CGAlgorithmsLab';
import { CppRepoExplorer } from './components/CppRepoExplorer';
import { MilestoneTracker } from './components/MilestoneTracker';
import { SAMPLE_FLOORPLANS } from './data/sampleFloorplans';
import { FloorPlanDataset, Opening2D, WallSegment2D } from './types/floorplan';
import { autosavePlan, loadAutosavedPlan } from './data/planStorage';
import { pruneOpenings } from './utils/openings';
import { useTheme } from './theme';

export default function App() {
  const [theme, setTheme] = useTheme();
  const [screen, setScreen] = useState<Screen>('overview');
  // The one current plan (walls, doors and windows, rooms): every screen reads it, edits replace it,
  // and it is autosaved in this browser so a reload comes back to it.
  const [plan, setPlan] = useState<FloorPlanDataset>(() => loadAutosavedPlan(SAMPLE_FLOORPLANS) ?? SAMPLE_FLOORPLANS[0]);
  const [wallHeight, setWallHeight] = useState<number>(2.8);
  const [wallThickness, setWallThickness] = useState<number>(0.22);
  const [showFurniture, setShowFurniture] = useState<boolean>(true);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => autosavePlan(plan), 400);
    return () => window.clearTimeout(timer);
  }, [plan]);

  const handleSelectFloorplan = (fp: FloorPlanDataset) => {
    setPlan(fp);
    setSelectedWallId(null);
  };
  // A deleted wall takes its doors and windows with it.
  const setWalls = (walls: WallSegment2D[]) => setPlan((p) => ({ ...p, walls, openings: pruneOpenings(p.openings, walls) }));
  const setOpenings = (openings: Opening2D[]) => setPlan((p) => ({ ...p, openings }));

  return (
    <AppShell
      screen={screen}
      onNavigate={setScreen}
      plan={plan}
      onSelectPlan={handleSelectFloorplan}
      theme={theme}
      onChangeTheme={setTheme}
    >
      {screen === 'overview' && <Overview plan={plan} onNavigate={setScreen} />}

      {screen === 'viewer3d' && (
        <OpenGLCanvas
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
      )}

      {screen === 'imageLab' && (
        <ImagePipelineLab
          onOpenIn3D={(plan) => {
            handleSelectFloorplan(plan);
            setScreen('viewer3d');
          }}
        />
      )}

      {screen === 'cvPipeline' && (
        <CVVisualizer
          floorplan={plan}
          walls={plan.walls}
          onUpdateWalls={setWalls}
          onUpdateOpenings={setOpenings}
          selectedWallId={selectedWallId}
          onSelectWall={setSelectedWallId}
        />
      )}

      {screen === 'cgLab' && <CGAlgorithmsLab />}

      {screen === 'cppRepo' && <CppRepoExplorer />}

      {screen === 'milestones' && <MilestoneTracker />}
    </AppShell>
  );
}
