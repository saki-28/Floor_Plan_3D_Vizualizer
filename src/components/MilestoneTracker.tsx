import { PageHeader, Tabs } from './ui';
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

const STATUS_LABELS: Record<string, string> = { DONE: 'Done', PARTLY: 'Partly', NEXT: 'Next', TODO: 'To do' };

export const MilestoneTracker: React.FC = () => {
  const [activeSection, setActiveSection] = useState<'m1' | 'schedule' | 'team' | 'equations'>('m1');

  // M0/M1 Gate Checklist items (from the final plan)
  const [m1Checks, setM1Checks] = useState([
    { id: 'c1', label: 'GLFW Window Creation & 3.3 Core Profile Initialization', done: false, member: 'Member 1 (Graphics Lead)', note: 'C++ written, never compiled; works in the WebGL viewer' },
    { id: 'c2', label: 'GLAD Function Pointer Loading & Hardware Strings Query', done: false, member: 'Member 1', note: 'C++ written, never compiled; works in the WebGL viewer' },
    { id: 'c3', label: 'GLSL Shader Compilation & Link-Time Error Check', done: false, member: 'Member 1', note: 'C++ written, never compiled; works in the WebGL viewer' },
    { id: 'c4', label: 'VAO / VBO / EBO Buffer Generation with Interleaved Attributes', done: false, member: 'Member 1 & 3', note: 'C++ written, never compiled; works in the WebGL viewer' },
    { id: 'c5', label: 'GLM Camera LookAt View Matrix & Perspective Projection Matrix', done: false, member: 'Member 1', note: 'C++ written, never compiled; works in the WebGL viewer' },
    { id: 'c6', label: '4-Wall Rectangular Room & Floor Mesh Generation at y=0 to y=h', done: false, member: 'Member 3 (Geometry Lead)', note: 'C++ written, never compiled; works in the WebGL viewer' },
    { id: 'c7', label: 'Hardware Z-Buffer Depth Testing (GL_DEPTH_TEST) & CCW Backface Culling', done: false, member: 'Member 1', note: 'C++ written, never compiled; works in the WebGL viewer' },
    { id: 'c8', label: 'Mouse Orbit / Pan / Zoom and Projection Toggle (P key)', done: false, member: 'Member 1', note: 'C++ written, never compiled; works in the WebGL viewer' },
    // --- M0/M1 gate: R3 fix + validators (added this session) ---
    { id: 'r3', label: '[R3 FIXED] z-sign: imageToWorld now uses z = +s·(v−v₀) — NO mirroring of floor plan', done: true, member: 'Member 3', note: 'Fixed in the web code; the C++ copy still mirrors' },
    { id: 'm0a', label: '[M0 Gate] Asymmetric L-plan no-mirror regression test passing (imageToWorld round-trip)', done: true, member: 'Member 4 (QA Lead)', note: 'Done in the web code' },
    { id: 'm0b', label: '[M0 Gate] CCW winding corrected: cross(e1,e2)·normal > 0 for all 12 triangles per box', done: true, member: 'Member 3', note: 'Done in the web code' },
    { id: 'm0c', label: '[M0 Gate] Mesh validators: winding, outward-normals, edge-manifold, dimension — all passing', done: true, member: 'Member 3 & 4', note: 'Done in the web code' },
    { id: 'm0d', label: '[M0 Gate] OBJ export with v/vn/vt/f lines — verified vertex & face counts', done: true, member: 'Member 3', note: 'Done in the web code' },
    { id: 'm0e', label: '[M0 Gate] PipelineResult, Segment2D, ScaleCalibration types defined (B2 data contract)', done: true, member: 'Member 2 (Vision Lead)', note: 'Done in the web code' },
    { id: 'm0f', label: '[M0 Gate] Test suite passing (node:test)', done: true, member: 'Member 4', note: '27 of 27 tests pass in the web code' },
  ]);

  const toggleCheck = (id: string) => {
    setM1Checks(
      m1Checks.map((c) => (c.id === id ? { ...c, done: !c.done } : c))
    );
  };

  return (
    <div className="flex min-h-full flex-col gap-5 lg:h-full">
      <PageHeader
        title="Milestones"
        description="The team's original plan for the C++ desktop version. For what works in the web app today, see Overview."
      />
      <Tabs
        label="Milestone sections"
        value={activeSection}
        onChange={setActiveSection}
        tabs={[
          { value: 'm1', label: 'Milestone 1 checklist', icon: <Award className="h-4 w-4" strokeWidth={1.5} /> },
          { value: 'schedule', label: 'Schedule', icon: <Calendar className="h-4 w-4" strokeWidth={1.5} /> },
          { value: 'team', label: 'Team and work plan', icon: <Users className="h-4 w-4" strokeWidth={1.5} /> },
          { value: 'equations', label: 'Derivations', icon: <BookOpen className="h-4 w-4" strokeWidth={1.5} /> },
        ]}
      />

      {/* Body */}
      <div className="min-h-0 w-full max-w-5xl flex-1 space-y-6 overflow-y-auto">
        {activeSection === 'm1' && (
          <div className="space-y-5">
            <div className="border-b border-line pb-3 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-ink flex items-center gap-2">
                  <Award className="w-5 h-5 text-ink" /> M0 + M1 Gate: Baseline Build & Correctness
                </h2>
                <p className="text-[13px] text-muted mt-1">
                  The M0/M1 exit gate from the final plan, written for the C++ build. The C++ code has not been compiled
                  yet, so its build items stay open; the same features run in the WebGL app, and the geometry checks pass
                  in the web code's tests.
                </p>
              </div>
              <span className="flex-none whitespace-nowrap rounded-full bg-warning-soft px-3 py-1 text-xs font-medium text-warning-ink">
                {m1Checks.filter((c) => c.done).length} of {m1Checks.length} done
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {m1Checks.map((item) => (
                <div
                  key={item.id}
                  onClick={() => toggleCheck(item.id)}
                  className={`p-3.5 rounded-lg border transition-colors cursor-pointer flex items-start gap-3 ${item.done
                      ? 'bg-raised border-line '
                      : 'bg-raised border-line'
                    }`}
                >
                  <CheckCircle2
                    className={`w-5 h-5 flex-shrink-0 mt-0.5 ${item.done ? 'text-positive' : 'text-muted'
                      }`}
                  />
                  <div>
                    <span className="text-xs font-semibold text-ink block">
                      {item.label}
                    </span>
                    <span className="text-xs text-muted num mt-0.5 block">
                      Owner: {item.member}
                    </span>
                    {item.note && <span className="mt-0.5 block text-xs text-muted">{item.note}</span>}
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 rounded-lg bg-accent-soft border border-line text-xs text-ink space-y-2">
              <span className="font-semibold text-accent block">M0/M1 Gate Exit Criteria (from final plan B6):</span>
              <p className="leading-relaxed text-ink">
                Not yet: a green C++ build, and the tests ported to GoogleTest.<br />
                R3 fix applied: <code className="text-positive">z = +s·(v−v₀)</code> — no left/right mirror of floor plan.<br />
                Asymmetric L-plan regression test passes (imageToWorld no-mirror).<br />
                Mesh validators: winding pass-rate 100%, outward normals 100%, 0 open edges.<br />
                5.00 m wall measures within 1 mm tolerance (dimension validator).<br />
                OBJ export with correct v/vn/vt/f lines verified.<br />
                PipelineResult & ScaleCalibration types defined (B2 data contract).<br />
                27 of 27 tests pass in the web code (node:test).
              </p>
            </div>
          </div>
        )}

        {activeSection === 'schedule' && (
          <div className="space-y-5">
            <div className="border-b border-line pb-3">
              <h2 className="text-lg font-bold text-ink flex items-center gap-2">
                <Calendar className="w-5 h-5 text-accent" /> 12-Week Milestone Schedule (Final Plan)
              </h2>
              <p className="text-[13px] text-muted mt-1">
                8 milestones (M0–M8) from the final implementation plan. Weeks 10–12 double as buffer.
              </p>
            </div>

            <div className="space-y-3">
              {[
                { week: 'Week 1', label: 'M0 + M1: Baseline Build & Sanity Gate', color: 'text-warning', status: 'PARTLY', items: ['Fix R3 z-sign bug, add asymmetric-plan test', 'Port 10 TS tests to GoogleTest format', 'Mesh validators: winding, normals, manifold, dimension', 'OBJ export, PipelineResult types (B2 contract)'] },
                { week: 'Weeks 2–3', label: 'M2: Vision Pipeline with Explainability', color: 'text-warning', status: 'PARTLY', items: ['7-stage pipeline: load→gray→Otsu→morph→Canny→Hough→vectorize', 'Stage 7: angle snap, collinear merge, parallel-edge pairing, endpoint snap', '7-tile mosaic viewer + colour-coded overlays (green/red/yellow/blue)', 'Per-stage log (counts + timing)'] },
                { week: 'Weeks 3–4', label: 'M3: Manual Correction, Calibration & JSON Persistence', color: 'text-warning', status: 'PARTLY', items: ['2D editor: add/delete/drag segments, Shift for orthogonal lock', 'Command stack with undo/redo', 'Two-point calibration → metersPerPixel, default = uncalibrated label', 'JSON save/load {imagePath, scale, segments, openings}'] },
                { week: 'Weeks 4–6', label: 'M4: Geometry Engine', color: 'text-warning', status: 'PARTLY', items: ['Pixel-to-metric mapping (bounding-box centred)', 'End-extension junction strategy (t/2 extension)', 'Door/window openings: lintel, sill, pillar sub-meshes', 'Floor slab from outer contour + ear clipping'] },
                { week: 'Weeks 5–7', label: 'M5: Renderer Completion (parallel)', color: 'text-ink', status: 'NEXT', items: ['Blinn-Phong directional light (vertex+fragment shaders)', 'Normals view, depth view, HUD (FPS, triangle count)', 'Measurement tool: unproject to y=0, corner snap 0.45m', 'Frame-all key (F), cull toggle (C), normals (N), depth (Z)'] },
                { week: 'Week 8', label: 'M6: Integration', color: 'text-warning', status: 'TODO', items: ['App flow: load→pipeline→mosaic→edit→mesh→3D', 'Hot-keys/tabs between 2D debug, editor, 3D', 'config.json for all parameters', 'Failure paths: no walls, bad image, uncalibrated scale'] },
                { week: 'Week 9', label: 'M7: Evaluation', color: 'text-warning', status: 'PARTLY', items: ['Segment precision/recall/F1 on ≥5 annotated plans', 'Wall-mask IoU (rasterized comparison)', 'FPS benchmark: 10/100/1k/5k synthetic walls at 720p/1080p/1440p', 'Parameter ablation figures'] },
                { week: 'Weeks 10–12', label: 'M8: Report, Slides, Viva (+Buffer)', color: 'text-muted', status: 'TODO', items: ['12-section report with per-stage figures and math', 'Viva demo script (8 min): mosaic→editor→3D→validators', 'Recorded backup video + pre-computed JSON', 'Risk: fallback decisions documented in README'] },
              ].map((m) => (
                <div key={m.week} className="bg-raised p-4 rounded-lg border border-line space-y-2">
                  <div className="flex items-center justify-between">
                    <span className={`font-bold text-xs   ${m.color}`}>{m.week}: {m.label}</span>
                    <span className={`flex-none whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
                        m.status === 'DONE' ? 'bg-positive-soft text-positive-ink' :
                        m.status === 'PARTLY' ? 'bg-warning-soft text-warning-ink' :
                        m.status === 'NEXT' ? 'bg-accent-soft text-accent' :
                          'bg-neutral-soft text-neutral-ink'
                      }`}>{STATUS_LABELS[m.status] ?? m.status}</span>
                  </div>
                  <ul className="text-xs text-ink space-y-1 list-disc list-inside">
                    {m.items.map((item, i) => <li key={i}>{item}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeSection === 'team' && (
          <div className="space-y-5">
            <div className="border-b border-line pb-3">
              <h2 className="text-lg font-bold text-ink flex items-center gap-2">
                <Users className="w-5 h-5 text-accent" /> Four-Member Team — Revised Ownership (B4)
              </h2>
              <p className="text-[13px] text-muted mt-1">
                Buddy rule: Member 1 shadows Member 2 on Stage 7 (highest-risk). Member 3 shadows Member 1 on the editor.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-raised p-4 rounded-lg border border-line space-y-2">
                <span className="text-xs font-bold text-accent   block">
                  Member 1 — Graphics & Application Lead
                </span>
                <p className="text-[13px] text-ink leading-relaxed">
                  Renderer, camera, shaders, projection/wireframe/normals/depth modes, HUD, <strong>application state machine</strong> (load→debug→edit→3D), editor <em>UI layer</em>.
                </p>
                <div className="text-xs text-muted num">Secondary: Measurement tool, raycast</div>
                <div className="text-xs text-muted num">Key Files: Renderer.h/.cpp, Camera.h/.cpp, shaders/</div>
              </div>

              <div className="bg-raised p-4 rounded-lg border border-line space-y-2">
                <span className="text-xs font-bold text-positive   block">
                  Member 2 — Vision Lead
                </span>
                <p className="text-[13px] text-ink leading-relaxed">
                  <code>FloorPlanProcessor</code>, all 7 stages, <code>PipelineResult</code>, mosaic & overlays, <strong>Stage 7 merging & pairing</strong>, editor <em>data model & command stack</em>.
                </p>
                <div className="text-xs text-muted num">Secondary: Parameter ablations</div>
                <div className="text-xs text-muted num">Key Files: FloorPlanProcessor.h/.cpp, tests/cv_tests.cpp</div>
              </div>

              <div className="bg-raised p-4 rounded-lg border border-line space-y-2">
                <span className="text-xs font-bold text-accent   block">
                  Member 3 — Geometry Lead
                </span>
                <p className="text-[13px] text-ink leading-relaxed">
                  Mapping, extrusion, junction handling, openings, floor, <strong>validators</strong>, OBJ export, Clipper2 (stretch).
                </p>
                <div className="text-xs text-muted num">Secondary: Geometry unit tests</div>
                <div className="text-xs text-muted num">Key Files: FloorPlanGeometry.h/.cpp, MeshGenerator.h/.cpp</div>
              </div>

              <div className="bg-raised p-4 rounded-lg border border-line space-y-2">
                <span className="text-xs font-bold text-ink   block">
                  Member 4 — QA, Data & Report Lead
                </span>
                <p className="text-[13px] text-ink leading-relaxed">
                  Dataset collection, <strong>ground-truth annotation</strong>, GoogleTest suite, benchmarks, evaluation scripts, report, slides, viva script.
                </p>
                <div className="text-xs text-muted num">Secondary: CMake, CI-style build script</div>
                <div className="text-xs text-muted num">Key Files: CMakeLists.txt, tests/, Report.pdf</div>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'equations' && (
          <div className="space-y-5">
            <div className="border-b border-line pb-3">
              <h2 className="text-lg font-bold text-ink flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-accent" /> Academic Mathematical Derivations
              </h2>
              <p className="text-[13px] text-muted mt-1">
                Rigorous mathematical principles for report Section 7 and viva presentation.
              </p>
            </div>

            <div className="space-y-4">
              <div className="bg-raised p-4 rounded-lg border border-line space-y-2">
                <h3 className="font-bold text-xs text-accent ">
                  1. Image to World Metric Mapping (B3 / R3 fix — no mirroring)
                </h3>
                <div className="bg-surface p-3 rounded num text-[13px] text-positive leading-relaxed">
                  x = +s · (u − u₀)   ← image-right → +X<br />
                  z = +s · (v − v₀)   ← image-down → +Z (NO mirror)
                </div>
                <p className="text-[13px] text-ink leading-relaxed">
                  Where <code className="text-ink">s</code> is meters/pixel, <code className="text-ink">(u₀, v₀)</code> is the segment bounding-box centre.
                  <strong className="text-negative"> Both signs are positive</strong> — the previous <code className="text-ink">z = −s·(v−v₀)</code> was wrong (R3 bug) and caused left/right mirroring of the floor plan.
                  Acceptance test: an asymmetric L-plan top-down render must match the source image without reflection.
                </p>
              </div>

              <div className="bg-raised p-4 rounded-lg border border-line space-y-2">
                <h3 className="font-bold text-xs text-positive ">
                  2. Wall Extrusion & Perpendicular Thickness Vectors
                </h3>
                <div className="bg-surface p-3 rounded num text-[13px] text-positive leading-relaxed">
                  d = (x₂ - x₁, z₂ - z₁),  L = ||d|| = sqrt((x₂ - x₁)² + (z₂ - z₁)²)
                  <br />
                  u = d / L,  n_perp = (-u_z, u_x)
                  <br />
                  A = P₁ + n_perp · (t/2),  B = P₁ - n_perp · (t/2),  C = P₂ - n_perp · (t/2),  D = P₂ + n_perp · (t/2)
                </div>
                <p className="text-[13px] text-ink leading-relaxed">
                  The base quad is extruded vertically from <code className="text-ink">y = 0</code> to <code className="text-ink">y = h</code>, forming 6 outward-oriented quad faces (12 triangles) with counter-clockwise winding order.
                </p>
              </div>

              <div className="bg-raised p-4 rounded-lg border border-line space-y-2">
                <h3 className="font-bold text-xs text-accent ">
                  3. OpenGL Model-View-Projection Matrix Pipeline
                </h3>
                <div className="bg-surface p-3 rounded num text-[13px] text-positive leading-relaxed">
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
