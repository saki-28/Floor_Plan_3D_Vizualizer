import React, { useState } from 'react';
import {
  CheckCircle2,
  Calendar,
  Users,
  BookOpen,
  Award,
  ChevronDown,
  ChevronUp,
  AlertCircle,
} from 'lucide-react';

export const MilestoneTracker: React.FC = () => {
  const [activeSection, setActiveSection] = useState<'m1' | 'schedule' | 'team' | 'equations'>('m1');

  // Milestone 1 Checklist items
  const [m1Checks, setM1Checks] = useState([
    { id: 'c1', label: 'GLFW Window Creation & 3.3 Core Profile Initialization', done: true, member: 'Member 1 (OpenGL Lead)' },
    { id: 'c2', label: 'GLAD Function Pointer Loading & Hardware Strings Query', done: true, member: 'Member 1' },
    { id: 'c3', label: 'GLSL Shader Compilation & Link-Time Error Check', done: true, member: 'Member 1' },
    { id: 'c4', label: 'VAO / VBO / EBO Buffer Generation with Interleaved Attributes', done: true, member: 'Member 1 & 3' },
    { id: 'c5', label: 'GLM Camera LookAt View Matrix & Perspective Projection Matrix', done: true, member: 'Member 1' },
    { id: 'c6', label: '4-Wall Rectangular Room & Floor Mesh Generation at y=0 to y=h', done: true, member: 'Member 3 (Geometry Lead)' },
    { id: 'c7', label: 'Hardware Z-Buffer Depth Testing (GL_DEPTH_TEST) & CCW Backface Culling', done: true, member: 'Member 1' },
    { id: 'c8', label: 'Mouse Orbit / Pan / Zoom and Projection Toggle (P key)', done: true, member: 'Member 1' },
  ]);

  const toggleCheck = (id: string) => {
    setM1Checks(
      m1Checks.map((c) => (c.id === id ? { ...c, done: !c.done } : c))
    );
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden rounded-xl border border-slate-800">
      {/* Sub-Nav */}
      <div className="bg-slate-900 border-b border-slate-800 p-2.5 flex items-center gap-2 overflow-x-auto">
        <button
          onClick={() => setActiveSection('m1')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
            activeSection === 'm1'
              ? 'bg-blue-600 text-white font-semibold'
              : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <Award className="w-3.5 h-3.5" /> Milestone 1 Acceptance Matrix
        </button>
        <button
          onClick={() => setActiveSection('schedule')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
            activeSection === 'schedule'
              ? 'bg-blue-600 text-white font-semibold'
              : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <Calendar className="w-3.5 h-3.5" /> 4-Week Project Schedule
        </button>
        <button
          onClick={() => setActiveSection('team')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
            activeSection === 'team'
              ? 'bg-blue-600 text-white font-semibold'
              : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <Users className="w-3.5 h-3.5" /> Team Division & Work Plan
        </button>
        <button
          onClick={() => setActiveSection('equations')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
            activeSection === 'equations'
              ? 'bg-blue-600 text-white font-semibold'
              : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" /> Mathematical Derivations
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 p-5 overflow-y-auto max-w-5xl mx-auto w-full space-y-6">
        {activeSection === 'm1' && (
          <div className="space-y-5">
            <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                  <Award className="w-5 h-5 text-amber-400" /> Milestone 1: Working Modern OpenGL Foundation
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  P0 Milestone requirement: The application must compile and render an interactive 3D house before integrating automated floor-plan computer vision.
                </p>
              </div>
              <span className="px-3 py-1 text-xs font-bold rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                100% COMPLETE & VERIFIED
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {m1Checks.map((item) => (
                <div
                  key={item.id}
                  onClick={() => toggleCheck(item.id)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
                    item.done
                      ? 'bg-slate-900/90 border-emerald-500/40 shadow-sm'
                      : 'bg-slate-900/40 border-slate-800'
                  }`}
                >
                  <CheckCircle2
                    className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
                      item.done ? 'text-emerald-400' : 'text-slate-600'
                    }`}
                  />
                  <div>
                    <span className="text-xs font-semibold text-slate-200 block">
                      {item.label}
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono mt-0.5 block">
                      Owner: {item.member}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 rounded-xl bg-blue-950/30 border border-blue-900/40 text-xs text-slate-300 space-y-2">
              <span className="font-semibold text-blue-400 block">Milestone 1 Acceptance Verification Method:</span>
              <p className="leading-relaxed text-slate-300">
                1. Build <code className="text-emerald-400">FloorPlan3D.exe</code> via CMake on Windows.
                <br />
                2. Verify that 4 watertight walls with thickness 0.25m and height 2.8m appear with outward-facing normals and depth-buffered floor.
                <br />
                3. Press <kbd className="bg-slate-800 px-1 rounded text-slate-200">P</kbd> to toggle between perspective and orthographic camera projections.
                <br />
                4. Press <kbd className="bg-slate-800 px-1 rounded text-slate-200">W</kbd> to inspect the triangular mesh wireframe.
              </p>
            </div>
          </div>
        )}

        {activeSection === 'schedule' && (
          <div className="space-y-5">
            <div className="border-b border-slate-800 pb-3">
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-400" /> 4-Week Implementation Schedule (One-Month Scope)
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Structured into 4 weekly sprints with strict P0/P1 scope boundaries to ensure guaranteed on-time university submission.
              </p>
            </div>

            <div className="space-y-4">
              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-blue-400 text-xs uppercase tracking-wider">
                    Week 1: Core OpenGL Foundation & Camera Pipeline (P0)
                  </span>
                  <span className="text-xs text-slate-400">Days 1 - 7</span>
                </div>
                <ul className="text-xs text-slate-300 space-y-1 list-disc list-inside">
                  <li>Setup GLFW, GLAD, GLM, CMake build system on Windows VS Code.</li>
                  <li>Implement Vertex & Fragment shaders with MVP matrix transformations.</li>
                  <li>Implement Orbit & Pan camera with perspective and orthographic modes.</li>
                  <li>Render hardcoded Milestone 1 house (floor + 4 walls + coordinate axes).</li>
                </ul>
              </div>

              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-400 text-xs uppercase tracking-wider">
                    Week 2: 2D Geometry Engine & 3D Parametric Mesh Generation (P0/P1)
                  </span>
                  <span className="text-xs text-slate-400">Days 8 - 14</span>
                </div>
                <ul className="text-xs text-slate-300 space-y-1 list-disc list-inside">
                  <li>Define explicit 2D data structures: Point2D, WallSegment2D, Room2D.</li>
                  <li>Implement parametric wall extrusion algorithm with thickness $t$ and height $h$.</li>
                  <li>Implement outward surface normals calculation and CCW triangle winding.</li>
                  <li>Implement door and window opening punch algorithms (lintels and sills).</li>
                  <li>Unit test degenerate segment handling (zero length, collinear walls).</li>
                </ul>
              </div>

              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-purple-400 text-xs uppercase tracking-wider">
                    Week 3: OpenCV Floor Plan Preprocessing & Explainable Stages (P0/P1)
                  </span>
                  <span className="text-xs text-slate-400">Days 15 - 21</span>
                </div>
                <ul className="text-xs text-slate-300 space-y-1 list-disc list-inside">
                  <li>Integrate OpenCV 4.x via CMake.</li>
                  <li>Implement 7 explainable stages: Grayscale, Otsu, Morphology, Canny, Hough.</li>
                  <li>Implement pixel-to-metric world mapping: $x = s(u-u_0), z = -s(v-v_0)$.</li>
                  <li>Build manual correction fallback mode for ambiguous door swings and text.</li>
                </ul>
              </div>

              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-400 text-xs uppercase tracking-wider">
                    Week 4: End-to-End Integration, Evaluation & Final Submission (P0/P1)
                  </span>
                  <span className="text-xs text-slate-400">Days 22 - 28</span>
                </div>
                <ul className="text-xs text-slate-300 space-y-1 list-disc list-inside">
                  <li>Connect OpenCV extracted/corrected geometry directly to OpenGL MeshGenerator.</li>
                  <li>Add Blinn-Phong directional sunlight and texture/material presets.</li>
                  <li>Implement CG algorithm demonstrations (Bresenham line rasterization overlay).</li>
                  <li>Benchmark FPS and wall reconstruction error against ground-truth blueprints.</li>
                  <li>Finalize academic report, architecture diagrams, and viva demonstration.</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'team' && (
          <div className="space-y-5">
            <div className="border-b border-slate-800 pb-3">
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <Users className="w-5 h-5 text-purple-400" /> Four-Member Engineering Team Role Matrix
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Clear separation of concerns to avoid merge conflicts and ensure parallel student velocity.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2">
                <span className="text-xs font-bold text-blue-400 uppercase tracking-wider block">
                  Member 1 — OpenGL Lead & Graphics Architect
                </span>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Responsible for GLFW window setup, GLAD, GLSL shaders, camera transformations (LookAt, Perspective, Orthographic), VAO/VBO management, depth testing, and wireframe rendering.
                </p>
                <div className="text-[11px] text-slate-400 font-mono">
                  Key Files: Renderer.h/.cpp, Camera.h/.cpp, shaders/
                </div>
              </div>

              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2">
                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider block">
                  Member 2 — Computer Vision & Preprocessing Lead
                </span>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Responsible for OpenCV integration, 7-stage explainable pipeline (Grayscale, Otsu binarization, Morphological opening/closing, Canny edges, Probabilistic Hough Lines), and manual vector fallback editor.
                </p>
                <div className="text-[11px] text-slate-400 font-mono">
                  Key Files: FloorPlanProcessor.h/.cpp, tests/cv_tests.cpp
                </div>
              </div>

              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2">
                <span className="text-xs font-bold text-purple-400 uppercase tracking-wider block">
                  Member 3 — Geometric Modelling & Mesh Lead
                </span>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Responsible for WallSegment2D data structures, pixel-to-world mapping, 3D box wall extrusion with thickness $t$, door/window punchers, surface normal generation, and CCW triangle winding.
                </p>
                <div className="text-[11px] text-slate-400 font-mono">
                  Key Files: FloorPlanGeometry.h/.cpp, MeshGenerator.h/.cpp
                </div>
              </div>

              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2">
                <span className="text-xs font-bold text-amber-400 uppercase tracking-wider block">
                  Member 4 — Testing, Benchmarking & Academic Report Lead
                </span>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Responsible for CMake configuration, unit testing, performance benchmarking (FPS, memory), geometric accuracy evaluation against ground truth, and authoring the project report and slides.
                </p>
                <div className="text-[11px] text-slate-400 font-mono">
                  Key Files: CMakeLists.txt, tests/, Report.pdf
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'equations' && (
          <div className="space-y-5">
            <div className="border-b border-slate-800 pb-3">
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-cyan-400" /> Academic Mathematical Derivations
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Rigorous mathematical principles for report Section 7 and viva presentation.
              </p>
            </div>

            <div className="space-y-4">
              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2">
                <h3 className="font-bold text-xs text-blue-400 uppercase">
                  1. Image to World Metric Mapping
                </h3>
                <div className="bg-slate-950 p-3 rounded font-mono text-xs text-emerald-400 leading-relaxed">
                  x = s · (u - u₀)
                  <br />
                  z = -s · (v - v₀)
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Where <code className="text-amber-300">s</code> is the scale factor in meters per pixel, <code className="text-amber-300">(u₀, v₀)</code> is the chosen origin (typically image center), and the negative sign on <code className="text-amber-300">z</code> preserves the right-handed OpenGL coordinate system where the positive Y axis is up and the camera faces towards -Z.
                </p>
              </div>

              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2">
                <h3 className="font-bold text-xs text-emerald-400 uppercase">
                  2. Wall Extrusion & Perpendicular Thickness Vectors
                </h3>
                <div className="bg-slate-950 p-3 rounded font-mono text-xs text-emerald-400 leading-relaxed">
                  d = (x₂ - x₁, z₂ - z₁),  L = ||d|| = sqrt((x₂ - x₁)² + (z₂ - z₁)²)
                  <br />
                  u = d / L,  n_perp = (-u_z, u_x)
                  <br />
                  A = P₁ + n_perp · (t/2),  B = P₁ - n_perp · (t/2),  C = P₂ - n_perp · (t/2),  D = P₂ + n_perp · (t/2)
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  The base quad is extruded vertically from <code className="text-amber-300">y = 0</code> to <code className="text-amber-300">y = h</code>, forming 6 outward-oriented quad faces (12 triangles) with counter-clockwise winding order.
                </p>
              </div>

              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2">
                <h3 className="font-bold text-xs text-purple-400 uppercase">
                  3. OpenGL Model-View-Projection Matrix Pipeline
                </h3>
                <div className="bg-slate-950 p-3 rounded font-mono text-xs text-emerald-400 leading-relaxed">
                  p_clip = P × V × M × p_model
                  <br />
                  p_ndc = [x_clip / w_clip, y_clip / w_clip, z_clip / w_clip] ∈ [-1, 1]³
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
