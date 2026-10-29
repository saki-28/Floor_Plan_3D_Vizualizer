/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Header, MainTab } from './components/Header';
import { OpenGLCanvas } from './components/OpenGLCanvas';
import { CVVisualizer } from './components/CVVisualizer';
import { CGAlgorithmsLab } from './components/CGAlgorithmsLab';
import { CppRepoExplorer } from './components/CppRepoExplorer';
import { MilestoneTracker } from './components/MilestoneTracker';
import { SAMPLE_FLOORPLANS } from './data/sampleFloorplans';
import { FloorPlanDataset, WallSegment2D } from './types/floorplan';

export default function App() {
  const [activeTab, setActiveTab] = useState<MainTab>('viewer3d');
  const [currentFloorplan, setCurrentFloorplan] = useState<FloorPlanDataset>(SAMPLE_FLOORPLANS[0]);
  const [walls, setWalls] = useState<WallSegment2D[]>(SAMPLE_FLOORPLANS[0].walls);
  const [wallHeight, setWallHeight] = useState<number>(2.8);
  const [wallThickness, setWallThickness] = useState<number>(0.22);
  const [showFurniture, setShowFurniture] = useState<boolean>(true);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);

  // Sync walls when floorplan changes
  const handleSelectFloorplan = (fp: FloorPlanDataset) => {
    setCurrentFloorplan(fp);
    setWalls(fp.walls);
    setSelectedWallId(null);
  };

  return (
    <div className="w-screen h-screen flex flex-col bg-slate-950 font-sans text-slate-100 overflow-hidden select-none">
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        currentFloorplan={currentFloorplan}
        onSelectFloorplan={handleSelectFloorplan}
        wallHeight={wallHeight}
        onChangeWallHeight={setWallHeight}
        wallThickness={wallThickness}
        onChangeWallThickness={setWallThickness}
        showFurniture={showFurniture}
        onToggleFurniture={() => setShowFurniture((prev) => !prev)}
      />

      <main className="flex-1 p-3 overflow-hidden relative">
        {activeTab === 'viewer3d' && (
          <OpenGLCanvas
            floorplan={currentFloorplan}
            walls={walls}
            wallHeight={wallHeight}
            wallThickness={wallThickness}
            showFurniture={showFurniture}
            selectedWallId={selectedWallId}
            onSelectWall={setSelectedWallId}
          />
        )}

        {activeTab === 'cvPipeline' && (
          <CVVisualizer
            floorplan={currentFloorplan}
            walls={walls}
            onUpdateWalls={setWalls}
            selectedWallId={selectedWallId}
            onSelectWall={setSelectedWallId}
          />
        )}

        {activeTab === 'cgLab' && <CGAlgorithmsLab />}

        {activeTab === 'cppRepo' && <CppRepoExplorer />}

        {activeTab === 'milestones' && <MilestoneTracker />}
      </main>
    </div>
  );
}
