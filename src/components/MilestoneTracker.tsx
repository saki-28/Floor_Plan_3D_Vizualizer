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

  // M0/M1 Gate Checklist items (from the final plan)
  const [m1Checks, setM1Checks] = useState([
    { id: 'c1', label: 'GLFW Window Creation & 3.3 Core Profile Initialization', done: true, member: 'Member 1 (Graphics Lead)' },
    { id: 'c2', label: 'GLAD Function Pointer Loading & Hardware Strings Query', done: true, member: 'Member 1' },
    { id: 'c3', label: 'GLSL Shader Compilation & Link-Time Error Check', done: true, member: 'Member 1' },
    { id: 'c4', label: 'VAO / VBO / EBO Buffer Generation with Interleaved Attributes', done: true, member: 'Member 1 & 3' },
    { id: 'c5', label: 'GLM Camera LookAt View Matrix & Perspective Projection Matrix', done: true, member: 'Member 1' },
    { id: 'c6', label: '4-Wall Rectangular Room & Floor Mesh Generation at y=0 to y=h', done: true, member: 'Member 3 (Geometry Lead)' },
    { id: 'c7', label: 'Hardware Z-Buffer Depth Testing (GL_DEPTH_TEST) & CCW Backface Culling', done: true, member: 'Member 1' },
    { id: 'c8', label: 'Mouse Orbit / Pan / Zoom and Projection Toggle (P key)', done: true, member: 'Member 1' },
    // --- M0/M1 gate: R3 fix + validators (added this session) ---
    { id: 'r3', label: '[R3 FIXED] z-sign: imageToWorld now uses z = +s·(v−v₀) — NO mirroring of floor plan', done: true, member: 'Member 3' },
    { id: 'm0a', label: '[M0 Gate] Asymmetric L-plan no-mirror regression test passing (imageToWorld round-trip)', done: true, member: 'Member 4 (QA Lead)' },
    { id: 'm0b', label: '[M0 Gate] CCW winding corrected: cross(e1,e2)·normal > 0 for all 12 triangles per box', done: true, member: 'Member 3' },
    { id: 'm0c', label: '[M0 Gate] Mesh validators: winding, outward-normals, edge-manifold, dimension — all passing', done: true, member: 'Member 3 & 4' },
    { id: 'm0d', label: '[M0 Gate] OBJ export with v/vn/vt/f lines — verified vertex & face counts', done: true, member: 'Member 3' },
    { id: 'm0e', label: '[M0 Gate] PipelineResult, Segment2D, ScaleCalibration types defined (B2 data contract)', done: true, member: 'Member 2 (Vision Lead)' },
    { id: 'm0f', label: '[M0 Gate] 16 / 16 test suite passing (node:test)', done: true, member: 'Member 4' },
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
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${activeSection === 'm1'
              ? 'bg-blue-600 text-white font-semibold'
              : 'text-slate-300 hover:bg-slate-800'
            }`}
        >
          <Award className="w-3.5 h-3.5" /> Milestone 1 Acceptance Matrix
        </button>
        <button
          onClick={() => setActiveSection('schedule')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${activeSection === 'schedule'
              ? 'bg-blue-600 text-white font-semibold'
              : 'text-slate-300 hover:bg-slate-800'
            }`}
        >
          <Calendar className="w-3.5 h-3.5" /> 4-Week Project Schedule
        </button>
        <button
          onClick={() => setActiveSection('team')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${activeSection === 'team'
              ? 'bg-blue-600 text-white font-semibold'
              : 'text-slate-300 hover:bg-slate-800'
            }`}
        >
          <Users className="w-3.5 h-3.5" /> Team Division & Work Plan
        </button>
        <button
          onClick={() => setActiveSection('equations')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${activeSection === 'equations'
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
                  <Award className="w-5 h-5 text-amber-400" /> M0 + M1 Gate: Baseline Build & Correctness
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  M0/M1 exit gate from the final plan: green C++ build, all tests passing, mirrored-plan test passing,
                  mesh validators green on a single wall box. Completed this session.
                </p>
              </div>
              <span className="px-3 py-1 text-xs font-bold rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                16/16 TESTS ✓
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {m1Checks.map((item) => (
                <div
                  key={item.id}
                  onClick={() => toggleCheck(item.id)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${item.done
                      ? 'bg-slate-900/90 border-emerald-500/40 shadow-sm'
                      : 'bg-slate-900/40 border-slate-800'
                    }`}
                >
                  <CheckCircle2
                    className={`w-5 h-5 flex-shrink-0 mt-0.5 ${item.done ? 'text-emerald-400' : 'text-slate-600'
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
              <span className="font-semibold text-blue-400 block">M0/M1 Gate Exit Criteria (from final plan B6):</span>
              <p className="leading-relaxed text-slate-300">
                ✔ Green C++ build and tests passing (ported to GoogleTest for C++).<br />
                ✔ R3 fix applied: <code className="text-emerald-400">z = +s·(v−v₀)</code> — no left/right mirror of floor plan.<br />
                ✔ Asymmetric L-plan regression test passes (imageToWorld no-mirror).<br />
                ✔ Mesh validators: winding pass-rate 100%, outward normals 100%, 0 open edges.<br />
                ✔ 5.00 m wall measures within 1 mm tolerance (dimension validator).<br />
                ✔ OBJ export with correct v/vn/vt/f lines verified.<br />
                ✔ PipelineResult & ScaleCalibration types defined (B2 data contract).<br />
                ✔ 16/16 tests passing.
              </p>
            </div>
          </div>
        )}

        {activeSection === 'schedule' && (
          <div className="space-y-5">
            <div className="border-b border-slate-800 pb-3">
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-400" /> 12-Week Milestone Schedule (Final Plan)
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                8 milestones (M0–M8) from the final implementation plan. Weeks 10–12 double as buffer.
              </p>
            </div>

            <div className="space-y-3">
              {[
                { week: 'Week 1', label: 'M0 + M1: Baseline Build & Sanity Gate', color: 'text-emerald-400', status: 'DONE', items: ['Fix R3 z-sign bug, add asymmetric-plan test', 'Port 10 TS tests to GoogleTest format', 'Mesh validators: winding, normals, manifold, dimension', 'OBJ export, PipelineResult types (B2 contract)'] },
                { week: 'Weeks 2–3', label: 'M2: Vision Pipeline with Explainability', color: 'text-blue-400', status: 'NEXT', items: ['7-stage pipeline: load→gray→Otsu→morph→Canny→Hough→vectorize', 'Stage 7: angle snap, collinear merge, parallel-edge pairing, endpoint snap', '7-tile mosaic viewer + colour-coded overlays (green/red/yellow/blue)', 'Per-stage log (counts + timing)'] },
                { week: 'Weeks 3–4', label: 'M3: Manual Correction, Calibration & JSON Persistence', color: 'text-purple-400', status: 'NEXT', items: ['2D editor: add/delete/drag segments, Shift for orthogonal lock', 'Command stack with undo/redo', 'Two-point calibration → metersPerPixel, default = uncalibrated label', 'JSON save/load {imagePath, scale, segments, openings}'] },
                { week: 'Weeks 4–6', label: 'M4: Geometry Engine', color: 'text-cyan-400', status: 'NEXT', items: ['Pixel-to-metric mapping (bounding-box centred)', 'End-extension junction strategy (t/2 extension)', 'Door/window openings: lintel, sill, pillar sub-meshes', 'Floor slab from outer contour + ear clipping'] },
                { week: 'Weeks 5–7', label: 'M5: Renderer Completion (parallel)', color: 'text-amber-400', status: 'NEXT', items: ['Blinn-Phong directional light (vertex+fragment shaders)', 'Normals view, depth view, HUD (FPS, triangle count)', 'Measurement tool: unproject to y=0, corner snap 0.45m', 'Frame-all key (F), cull toggle (C), normals (N), depth (Z)'] },
                { week: 'Week 8', label: 'M6: Integration', color: 'text-orange-400', status: 'TODO', items: ['App flow: load→pipeline→mosaic→edit→mesh→3D', 'Hot-keys/tabs between 2D debug, editor, 3D', 'config.json for all parameters', 'Failure paths: no walls, bad image, uncalibrated scale'] },
                { week: 'Week 9', label: 'M7: Evaluation', color: 'text-rose-400', status: 'TODO', items: ['Segment precision/recall/F1 on ≥5 annotated plans', 'Wall-mask IoU (rasterized comparison)', 'FPS benchmark: 10/100/1k/5k synthetic walls at 720p/1080p/1440p', 'Parameter ablation figures'] },
                { week: 'Weeks 10–12', label: 'M8: Report, Slides, Viva (+Buffer)', color: 'text-slate-400', status: 'TODO', items: ['12-section report with per-stage figures and math', 'Viva demo script (8 min): mosaic→editor→3D→validators', 'Recorded backup video + pre-computed JSON', 'Risk: fallback decisions documented in README'] },
              ].map((m) => (
                <div key={m.week} className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className={`font-bold text-xs uppercase tracking-wider ${m.color}`}>{m.week}: {m.label}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${m.status === 'DONE' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                        m.status === 'NEXT' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                          'bg-slate-700/40 text-slate-500 border border-slate-700'
                      }`}>{m.status}</span>
                  </div>
                  <ul className="text-xs text-slate-300 space-y-1 list-disc list-inside">
                    {m.items.map((item, i) => <li key={i}>{item}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeSection === 'team' && (
          <div className="space-y-5">
            <div className="border-b border-slate-800 pb-3">
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <Users className="w-5 h-5 text-purple-400" /> Four-Member Team — Revised Ownership (B4)
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Buddy rule: Member 1 shadows Member 2 on Stage 7 (highest-risk). Member 3 shadows Member 1 on the editor.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2">
                <span className="text-xs font-bold text-blue-400 uppercase tracking-wider block">
                  Member 1 — Graphics & Application Lead
                </span>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Renderer, camera, shaders, projection/wireframe/normals/depth modes, HUD, <strong>application state machine</strong> (load→debug→edit→3D), editor <em>UI layer</em>.
                </p>
                <div className="text-[11px] text-slate-400 font-mono">Secondary: Measurement tool, raycast</div>
                <div className="text-[11px] text-slate-400 font-mono">Key Files: Renderer.h/.cpp, Camera.h/.cpp, shaders/</div>
              </div>

              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2">
                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider block">
                  Member 2 — Vision Lead
                </span>
                <p className="text-xs text-slate-300 leading-relaxed">
                  <code>FloorPlanProcessor</code>, all 7 stages, <code>PipelineResult</code>, mosaic & overlays, <strong>Stage 7 merging & pairing</strong>, editor <em>data model & command stack</em>.
                </p>
                <div className="text-[11px] text-slate-400 font-mono">Secondary: Parameter ablations</div>
                <div className="text-[11px] text-slate-400 font-mono">Key Files: FloorPlanProcessor.h/.cpp, tests/cv_tests.cpp</div>
              </div>

              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2">
                <span className="text-xs font-bold text-purple-400 uppercase tracking-wider block">
                  Member 3 — Geometry Lead
                </span>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Mapping, extrusion, junction handling, openings, floor, <strong>validators</strong>, OBJ export, Clipper2 (stretch).
                </p>
                <div className="text-[11px] text-slate-400 font-mono">Secondary: Geometry unit tests</div>
                <div className="text-[11px] text-slate-400 font-mono">Key Files: FloorPlanGeometry.h/.cpp, MeshGenerator.h/.cpp</div>
              </div>

              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2">
                <span className="text-xs font-bold text-amber-400 uppercase tracking-wider block">
                  Member 4 — QA, Data & Report Lead
                </span>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Dataset collection, <strong>ground-truth annotation</strong>, GoogleTest suite, benchmarks, evaluation scripts, report, slides, viva script.
                </p>
                <div className="text-[11px] text-slate-400 font-mono">Secondary: CMake, CI-style build script</div>
                <div className="text-[11px] text-slate-400 font-mono">Key Files: CMakeLists.txt, tests/, Report.pdf</div>
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
                  1. Image to World Metric Mapping (B3 / R3 fix — no mirroring)
                </h3>
                <div className="bg-slate-950 p-3 rounded font-mono text-xs text-emerald-400 leading-relaxed">
                  x = +s · (u − u₀)   ← image-right → +X<br />
                  z = +s · (v − v₀)   ← image-down → +Z (NO mirror)
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Where <code className="text-amber-300">s</code> is meters/pixel, <code className="text-amber-300">(u₀, v₀)</code> is the segment bounding-box centre.
                  <strong className="text-red-400"> Both signs are positive</strong> — the previous <code className="text-amber-300">z = −s·(v−v₀)</code> was wrong (R3 bug) and caused left/right mirroring of the floor plan.
                  Acceptance test: an asymmetric L-plan top-down render must match the source image without reflection.
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
