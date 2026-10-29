import React from 'react';
import { FloorPlanDataset } from '../types/floorplan';
import { SAMPLE_FLOORPLANS } from '../data/sampleFloorplans';
import {
  Box,
  Layers,
  Cpu,
  FileCode,
  Award,
  Sliders,
  Armchair,
} from 'lucide-react';

export type MainTab = 'viewer3d' | 'cvPipeline' | 'cgLab' | 'cppRepo' | 'milestones';

interface HeaderProps {
  activeTab: MainTab;
  onTabChange: (tab: MainTab) => void;
  currentFloorplan: FloorPlanDataset;
  onSelectFloorplan: (fp: FloorPlanDataset) => void;
  wallHeight: number;
  onChangeWallHeight: (h: number) => void;
  wallThickness: number;
  onChangeWallThickness: (t: number) => void;
  showFurniture: boolean;
  onToggleFurniture: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onTabChange,
  currentFloorplan,
  onSelectFloorplan,
  wallHeight,
  onChangeWallHeight,
  wallThickness,
  onChangeWallThickness,
  showFurniture,
  onToggleFurniture,
}) => {
  return (
    <header className="bg-slate-900 border-b border-slate-800 text-slate-100 px-4 py-2.5 flex flex-col gap-2.5 shadow-md">
      {/* Top Row: Academic Branding and Sample Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600/30 border border-blue-500/40 flex items-center justify-center text-blue-400 font-bold shadow-inner">
            <Box className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-tight text-white">
                Explainable Floor-Plan-to-3D Reconstruction
              </h1>
              <span className="hidden sm:inline-block px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                OpenGL 3.3 Core & OpenCV
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Theme 2: Intelligent 2D/3D Modelling, Reconstruction & Interactive Architectural Visualization
            </p>
          </div>
        </div>

        {/* Floorplan Selector & Geometry Sliders */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-800">
            <span className="text-slate-400 font-medium">Floor Plan:</span>
            <select
              value={currentFloorplan.id}
              onChange={(e) => {
                const found = SAMPLE_FLOORPLANS.find((fp) => fp.id === e.target.value);
                if (found) onSelectFloorplan(found);
              }}
              className="bg-transparent text-slate-200 font-medium focus:outline-none cursor-pointer"
            >
              {SAMPLE_FLOORPLANS.map((fp) => (
                <option key={fp.id} value={fp.id} className="bg-slate-900 text-slate-200">
                  {fp.name} ({fp.difficulty})
                </option>
              ))}
            </select>
          </div>

          {/* Quick Extrusion Sliders */}
          <div className="hidden xl:flex items-center gap-3 bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-800">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Height:</span>
              <span className="font-mono text-emerald-400 font-semibold">{wallHeight.toFixed(1)}m</span>
              <input
                type="range"
                min="1.5"
                max="4.5"
                step="0.1"
                value={wallHeight}
                onChange={(e) => onChangeWallHeight(+e.target.value)}
                className="w-16 accent-blue-500"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Thickness:</span>
              <span className="font-mono text-cyan-400 font-semibold">{wallThickness.toFixed(2)}m</span>
              <input
                type="range"
                min="0.1"
                max="0.4"
                step="0.02"
                value={wallThickness}
                onChange={(e) => onChangeWallThickness(+e.target.value)}
                className="w-16 accent-blue-500"
              />
            </div>
            <button
              onClick={onToggleFurniture}
              className={`p-1 rounded text-xs transition flex items-center gap-1 ${
                showFurniture
                  ? 'bg-blue-600/30 text-blue-400 border border-blue-500/30'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Toggle Interior Furniture"
            >
              <Armchair className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Row: Navigation Tabs */}
      <nav className="flex items-center gap-1.5 border-t border-slate-800/80 pt-2 overflow-x-auto">
        <button
          onClick={() => onTabChange('viewer3d')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'viewer3d'
              ? 'bg-blue-600 text-white font-semibold shadow-md'
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <Box className="w-3.5 h-3.5" /> 3D OpenGL Renderer
        </button>

        <button
          onClick={() => onTabChange('cvPipeline')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'cvPipeline'
              ? 'bg-blue-600 text-white font-semibold shadow-md'
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <Layers className="w-3.5 h-3.5" /> Explainable CV Pipeline (7 Stages)
        </button>

        <button
          onClick={() => onTabChange('cgLab')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'cgLab'
              ? 'bg-blue-600 text-white font-semibold shadow-md'
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <Cpu className="w-3.5 h-3.5" /> CG Algorithms Demonstrator
        </button>

        <button
          onClick={() => onTabChange('cppRepo')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'cppRepo'
              ? 'bg-blue-600 text-white font-semibold shadow-md'
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <FileCode className="w-3.5 h-3.5" /> C++ & CMake Repository
        </button>

        <button
          onClick={() => onTabChange('milestones')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'milestones'
              ? 'bg-blue-600 text-white font-semibold shadow-md'
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <Award className="w-3.5 h-3.5" /> Milestone 1 & Academic Deliverables
        </button>
      </nav>
    </header>
  );
};
