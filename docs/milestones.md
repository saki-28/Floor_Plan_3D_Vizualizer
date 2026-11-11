# Milestones of the original C++ plan

This is the team's original plan for the C++ and OpenGL desktop version, moved out of the web app on 4 Nov 2026. The product is now the web app. The C++ code itself is in [`legacy-cpp/`](legacy-cpp/) and has never been compiled.

## M0 + M1 gate: baseline build and correctness

The exit gate from the final plan, written for the C++ build. The C++ code has not been compiled, so its build items stay open. The same features run in the WebGL app, and the geometry checks pass in the web code's tests. **7 of 15 done.**

| Item | Owner | State |
|---|---|---|
| GLFW window creation and 3.3 core profile | Member 1 (Graphics lead) | C++ written, never compiled; works in the WebGL viewer |
| GLAD function loading and hardware strings query | Member 1 | C++ written, never compiled; works in the WebGL viewer |
| GLSL shader compilation and link-time error check | Member 1 | C++ written, never compiled; works in the WebGL viewer |
| VAO / VBO / EBO buffers with interleaved attributes | Members 1 and 3 | C++ written, never compiled; works in the WebGL viewer |
| GLM LookAt view matrix and perspective projection | Member 1 | C++ written, never compiled; works in the WebGL viewer |
| 4-wall room and floor mesh from y = 0 to y = h | Member 3 (Geometry lead) | C++ written, never compiled; works in the WebGL viewer |
| Z-buffer depth testing and CCW back-face culling | Member 1 | C++ written, never compiled; works in the WebGL viewer |
| Mouse orbit, pan, zoom and projection toggle (P) | Member 1 | C++ written, never compiled; works in the WebGL viewer |
| R3 fix: imageToWorld uses z = +s·(v − v₀), no mirroring | Member 3 | Done in the web code; the C++ copy still mirrors |
| Asymmetric L-plan no-mirror regression test | Member 4 (QA lead) | Done in the web code |
| CCW winding: cross(e1, e2)·normal > 0 for all 12 triangles per box | Member 3 | Done in the web code |
| Mesh validators: winding, outward normals, edge manifold, dimension | Members 3 and 4 | Done in the web code |
| OBJ export with v/vn/vt/f lines, vertex and face counts verified | Member 3 | Done in the web code |
| PipelineResult, Segment2D, ScaleCalibration types (B2 data contract) | Member 2 (Vision lead) | Done in the web code |
| Test suite passing (node:test) | Member 4 | Done in the web code (27 of 27 then; 49 now) |

Not yet: a green C++ build, and the tests ported to GoogleTest.

## 12-week schedule

8 milestones (M0–M8) from the final implementation plan; weeks 10–12 double as buffer. States are as of 4 Nov 2026.

| Weeks | Milestone | State | Items |
|---|---|---|---|
| 1 | M0 + M1: baseline build and sanity gate | Partly | Fix the R3 z-sign bug and add the asymmetric-plan test; port 10 TS tests to GoogleTest; mesh validators (winding, normals, manifold, dimension); OBJ export and PipelineResult types (B2 contract) |
| 2–3 | M2: vision pipeline with explainability | Partly | 7-stage pipeline (load → gray → Otsu → morph → Canny → Hough → vectorize); stage 7: angle snap, collinear merge, parallel-edge pairing, endpoint snap; 7-tile mosaic with colour-coded overlays; per-stage log (counts and timing) |
| 3–4 | M3: manual correction, calibration and JSON persistence | Partly | 2D editor (add, delete, drag segments, Shift for orthogonal lock); command stack with undo/redo; two-point calibration → metres per pixel, labelled uncalibrated by default; JSON save/load with scale, segments and openings |
| 4–6 | M4: geometry engine | Partly | Pixel-to-metric mapping (bounding-box centred); end-extension junctions (t/2); door and window openings (lintel, sill, pillar sub-meshes); floor slab from the outer contour with ear clipping |
| 5–7 | M5: renderer completion (parallel) | Next | Blinn-Phong directional light; normals view, depth view, HUD (FPS, triangle count); measuring tool (unproject to y = 0, 0.45 m corner snap); keys F (frame all), C (cull), N (normals), Z (depth) |
| 8 | M6: integration | To do | App flow load → pipeline → mosaic → edit → mesh → 3D; keys and tabs between 2D debug, editor and 3D; config.json for all parameters; failure paths (no walls, bad image, uncalibrated scale) |
| 9 | M7: evaluation | Partly | Segment precision/recall/F1 on ≥ 5 annotated plans; wall-mask IoU (rasterised comparison); FPS benchmark with 10 to 5,000 synthetic walls at 720p, 1080p and 1440p; parameter ablation figures |
| 10–12 | M8: report, slides, viva (+ buffer) | To do | 12-section report with per-stage figures and maths; 8-minute viva demo (mosaic → editor → 3D → validators); recorded backup video and pre-computed JSON; fallback decisions documented in the README |

## Team and ownership (B4)

Buddy rule: Member 1 shadows Member 2 on stage 7 (the highest risk), and Member 3 shadows Member 1 on the editor.

| Member | Role | Owns | Secondary | Key files (C++ plan) |
|---|---|---|---|---|
| 1 | Graphics and application lead | Renderer, camera, shaders, projection/wireframe/normals/depth modes, HUD, application state machine (load → debug → edit → 3D), editor UI | Measuring tool, raycast | Renderer.h/.cpp, Camera.h/.cpp, shaders/ |
| 2 | Vision lead | FloorPlanProcessor, all 7 stages, PipelineResult, mosaic and overlays, stage 7 merging and pairing, editor data model and command stack | Parameter ablations | FloorPlanProcessor.h/.cpp, tests/cv_tests.cpp |
| 3 | Geometry lead | Mapping, extrusion, junctions, openings, floor, validators, OBJ export, Clipper2 (stretch) | Geometry unit tests | FloorPlanGeometry.h/.cpp, MeshGenerator.h/.cpp |
| 4 | QA, data and report lead | Dataset collection, ground-truth annotation, GoogleTest suite, benchmarks, evaluation scripts, report, slides, viva script | CMake, CI-style build script | CMakeLists.txt, tests/, Report.pdf |

## Derivations (for the report and viva)

**1. Image to world mapping (B3, the R3 fix: no mirroring).** With s in metres per pixel and (u₀, v₀) the centre of the walls' bounding box:

    x = +s · (u − u₀)    image right → +X
    z = +s · (v − v₀)    image down  → +Z  (no mirror)

Both signs are positive. The earlier z = −s·(v − v₀) was the R3 bug that mirrored plans left to right. Acceptance test: a top-down render of an asymmetric L-shaped plan matches the source image without reflection.

**2. Wall extrusion and the thickness vector.**

    d = (x₂ − x₁, z₂ − z₁),  L = ‖d‖
    u = d / L,  n = (−u_z, u_x)
    A = P₁ + n·t/2,  B = P₁ − n·t/2,  C = P₂ − n·t/2,  D = P₂ + n·t/2

The base quad is extruded from y = 0 to y = h into 6 outward quad faces (12 triangles) with counter-clockwise winding. Doors and windows now split this box along the wall into solid pieces, sills and lintels (`extrudeWallWithOpenings` in `src/utils/geometryEngine.ts`).

**3. Model-view-projection.**

    p_clip = P × V × M × p_model
    p_ndc  = (x_clip, y_clip, z_clip) / w_clip  ∈ [−1, 1]³
