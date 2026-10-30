# FloorPlan3D: Final Implementation Plan (Reviewed and Revised)

**Explainable Floor-Plan-to-3D Reconstruction and Interactive Architectural Visualization Using Modern OpenGL and OpenCV**
Theme 2: Intelligent 2D/3D Modelling, Reconstruction and Visualization
Stack: C++17, OpenCV 4.x, GLFW, GLAD (GL 3.3 Core), GLM, CMake, GoogleTest, Windows (MSVC or MinGW-w64)

This document has two parts. **Part A** is a review of the current Project Implementation Guide: what is solid, and what must change. **Part B** is the final plan with those fixes applied.

---

# PART A: Review of the Current Guide

## A1. What is already strong (keep as is)

- **Decoupled 3-tier architecture** with an explicit 2D data contract between vision, geometry and rendering. A vision bug can never block the graphics demo.
- **Classical, explainable vision** instead of end-to-end ML, which matches the abstract.
- **24 vertices per box** (flat per-face normals), CCW winding, and a degenerate-segment guard.
- **Ear-clipping triangulation** instead of a naive fan, and the explanation of why.
- **Screen-to-floor unprojection and corner snapping** as the basis of an interactive measurement tool.
- **Pitfalls section** (culling, near plane, annotation noise) is good viva material.
- **Math reference** is concise and reusable in the report.

## A2. Findings that must be fixed

| ID | Severity | Finding | Fix (where applied in Part B) |
|---|---|---|---|
| R1 | **Critical** | The **manual correction fallback**, **scale calibration** and **JSON save/load** are headline items in the abstract, but the C++ roadmap has no phase for them. They exist only in the web preview. | New milestone M3 (Section B6) |
| R2 | **Critical** | Stage 7 lacks **collinear merging** and **parallel-edge pairing**. `HoughLinesP` on Canny edges returns hundreds of overlapping fragments and **two lines per thick wall** (one per wall face). Without merging, Milestone 3 output is unusable and walls get doubled. | Stage 7 spec (Section B7) |
| R3 | **Critical** | **Mirrored coordinate mapping.** The guide uses `z = -s·(v - v0)` and claims this preserves right-handedness. With a standard top-down camera (up = -Z), image-down is **+Z**, so the negative sign produces a **mirror image** of the plan. The correct map is `z = +s·(v - v0)`. (My earlier plan's "flip the Y axis" wording was misleading for the same reason; it is corrected here.) | Section B3 |
| R4 | **Critical** | **Explainability lives only in the web visualizer.** The C++ product also needs `PipelineResult`, the 7-tile stage mosaic, colour-coded overlays and per-stage logs, otherwise the "explainable" claim is not demonstrated by the actual deliverable. | Sections B2, B7 |
| R5 | **Critical** | **Floor polygon source is undefined.** Ear clipping needs a room or outline polygon, but the vision output is wall segments only. | Floor strategy (Section B8.4) |
| R6 | Major | **Watertight claim is overstated.** Each wall box is a closed manifold, but a *union* of boxes with overlaps at corners and T-junctions is not, and coplanar overlapping faces cause z-fighting. "Miter joints" alone does not fix T-junctions. Door sub-meshes also create touching coplanar internal faces. | Junction strategy and validator (Section B8) |
| R7 | Major | **Status is overstated.** The TypeScript engine and WebGL studio are a prototype; the graded deliverable is C++. The C++ code is described as "ready" but has never been compiled on a target machine. The 10 passing tests are `node:test`, not C++. | M0/M1 gate, port tests to GoogleTest (Section B6) |
| R8 | Major | **Contract inconsistency.** The Tier 1 diagram says vision outputs *metric* points, but vision works in pixels. Metric conversion belongs to Tier 2, and the **scale source** (calibration or default) is never specified. | Data contract (Section B2) |
| R9 | Major | **Morphology is under-specified.** Only a fixed 3x3 opening is used. Text strokes at 1600 px are often thicker than 1 px, so they survive. There is no closing step to bridge door gaps, no connected-component size filter, and no deskew for rotated scans. | Vision spec (Section B7) |
| R10 | Major | **Evaluation is ill-defined.** "IoU between detected walls and ground-truth CAD" is not meaningful for line segments. There is no ground-truth process. FPS tests with tiny scenes will be capped by vsync and tell nothing. | Evaluation plan (Section B10) |
| R11 | Moderate | **Scope creep risk.** Measurement overlay, Bresenham/DDA lab, Z-buffer simulator and the repository explorer are not in the abstract. Fine as stretch, but they must not delay core items. | Priority tiers (Section B1) |
| R12 | Moderate | **Ownership gaps.** The editor and the integration shell are unowned. Member 2 is a single point of failure for the riskiest module. | Revised ownership (Section B4) |
| R13 | Moderate | **No timeline, exit criteria, or fallback decisions.** | Section B6 |
| R14 | Moderate | **Z-fighting between floor and wall bottoms** (both at y = 0) is not covered, only the near-plane case. | Section B8.5 |
| R15 | Minor | "Physically accurate" is an overclaim; say "metrically scaled". Door and window **detection** is not implemented (arcs are not detected), so openings are **manually annotated**; say so explicitly. "No ML" needs a one-paragraph justification in the report. OpenCV through vcpkg can take an hour or more to build; use binary caching or the prebuilt Windows package. | Throughout |

---

# PART B: Final Plan

## B1. Scope and Priorities

**Tier 1: Must have (maps one-to-one to the abstract)**
1. 7-stage explainable CV pipeline in C++ with `PipelineResult`, stage mosaic and logs.
2. Orthogonal vectorization with merging and parallel-edge pairing.
3. Interactive manual correction tool with two-point calibration and JSON persistence.
4. Pixel-to-metric mapping and extrusion into 3D wall meshes with outward normals and CCW winding.
5. Mesh validators (winding, normals, edge-manifold check) and OBJ export.
6. Modern OpenGL 3.3 Core renderer: MVP, orbit and pan camera, perspective/orthographic toggle, depth test, wireframe, Blinn-Phong directional light.
7. Evaluation, report, demo.

**Tier 2: Should have**
- Door and window openings (manually annotated, parametric sub-meshes).
- Floor slab from the outer contour.
- HUD (FPS, mode), normals view, depth view.
- Raycast unprojection and the measurement tool.

**Tier 3: Nice to have (only if ahead of schedule)**
- Clipper2 polygon union for a single watertight shell.
- Bresenham/DDA and Z-buffer teaching demos.
- Textures, room labels, room segmentation.

## B2. Architecture and Data Contract

```
┌──────────────────────────────────────────────────────────────────────┐
│ TIER 1: VISION (OpenCV)                    output: PIXEL space       │
│ Load/resize → Gray+CLAHE → Otsu (inv) → Open/Close + CC filter →     │
│ Canny → HoughLinesP → Orthogonal vectorization (snap, merge, pair)   │
│ Stores every intermediate cv::Mat in PipelineResult                  │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ vector<Segment2D> (pixels) + PipelineResult
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ MANUAL CORRECTION + CALIBRATION (editor)   output: PIXEL space       │
│ Add/delete/drag segments, undo/redo, 2-point scale, JSON save/load   │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ corrected segments + metersPerPixel
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ TIER 2: GEOMETRY                           output: METRIC (meters)   │
│ Pixel→world map, junction handling, extrusion, openings, floor,      │
│ validators, OBJ export                                               │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ Mesh (pos, normal, [uv]) + indices
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ TIER 3: RENDERER (GLFW, GLAD, GLSL 3.30)                             │
│ VAO/VBO/EBO, orbit+pan camera, persp/ortho, depth, cull, wireframe,  │
│ Blinn-Phong, HUD, measurement overlay                                │
└──────────────────────────────────────────────────────────────────────┘
```

**Core types**

```cpp
struct Segment2D   { glm::vec2 a, b; float thickness = 0.f; /* px until mapped */ };
struct Opening     { int wallId; float t0, t1;        // 0..1 along wall
                     float sill, head; };              // meters (door: sill = 0)
struct Scale       { float metersPerPixel; bool calibrated; };
struct PipelineResult {
    cv::Mat src, gray, binary, cleaned, edges, houghOverlay, vectorOverlay;
    std::vector<Segment2D> raw, snapped, merged, final;
    std::map<std::string, std::string> log;            // per-stage params and counts
    std::map<std::string, double> timingMs;
};
struct Mesh { std::vector<Vertex> v; std::vector<uint32_t> i; };
```

## B3. Conventions (fix R3)

- World: right-handed, **+Y up**, plan lies in the **XZ** plane.
- Pixel to world (v grows downward in the image, +Z grows toward the bottom of a top-down view):

```
x =  s · (u − u0)
z =  s · (v − v0)        ← positive sign: NO mirroring
```

- Top-down camera: `eye = (cx, H, cz)`, `up = (0, 0, −1)`. Verified: right = +X, screen-up = −Z, so image-down = +Z.
- **Acceptance test:** use an asymmetric plan (an L-shaped plan with a distinctive notch). The top-down orthographic render must match the source image **without mirroring**.
- Triangle winding: CCW as seen from outside. `glFrontFace(GL_CCW)`, `glCullFace(GL_BACK)`.
- glm matrices are column-major; the normal matrix is `transpose(inverse(mat3(M)))`.

## B4. Team Ownership (revised, fixes R12)

| Member | Primary ownership | Secondary |
|---|---|---|
| **1: Graphics and Application Lead** | Renderer, camera, shaders, projection/wireframe/normals/depth modes, HUD, **application state machine** (load → debug → edit → 3D), editor **UI layer** | Measurement tool, raycast |
| **2: Vision Lead** | `FloorPlanProcessor`, all 7 stages, `PipelineResult`, mosaic and overlays, Stage 7 merging and pairing, editor **data model and command stack** | Parameter ablations |
| **3: Geometry Lead** | Mapping, extrusion, junction handling, openings, floor, validators, OBJ export, Clipper2 (stretch) | Geometry unit tests |
| **4: QA, Data and Report Lead** | Dataset collection, **ground-truth annotation**, GoogleTest suite, benchmarks, evaluation scripts, report, slides, viva script | CMake, CI-style build script |

**Buddy rule:** Member 1 shadows Member 2 on Stage 7 (the highest-risk module), and Member 3 shadows Member 1 on the editor. No module should have only one person who understands it.

## B5. Definition of Done per Tier-1 Item

| Item | Done when |
|---|---|
| Vision pipeline | Given any dataset image, produces segments plus 7-tile mosaic plus log file in under 1 s at 1600 px |
| Editor | Add, delete, drag, undo/redo, calibrate, save/load JSON, and the saved file regenerates the same mesh |
| Geometry | Every triangle passes the winding test; validator reports zero open edges on a single wall and a documented, explained result on multi-wall plans |
| Renderer | All controls from the abstract work; no visual artifacts (flicker, missing faces) on the sample plans |
| Evaluation | Tables and figures generated by a script that can be re-run |

## B6. Milestones and Timeline (12 weeks, adjust to your calendar)

### M0 + M1: Baseline Build and Sanity Gate (Week 1)
*(addresses R7)*
1. Install vcpkg. Use **binary caching** or the prebuilt OpenCV Windows package to avoid a very long OpenCV build.
   `vcpkg install glfw3 glm glad opencv4 gtest --triplet x64-windows`
2. Configure and build:
   `cmake -B build -S . -DCMAKE_TOOLCHAIN_FILE=C:/vcpkg/scripts/buildsystems/vcpkg.cmake`
   `cmake --build build --config Release`
3. Run `FloorPlan3D.exe`: the 4-wall house must render with orbit, pan, zoom, P (projection), W (wireframe).
4. **Port the 10 TypeScript tests to GoogleTest** (`tests/geometry_tests.cpp`). The C++ suite, not the TS one, is the evidence of correctness.
5. Fix the Z sign (R3) and add the asymmetric-plan test.
6. Collect the dataset (8-10 plans: CAD export, clean scan, noisy scan, hand-drawn, one deliberately ambiguous plan, one rotated scan).
7. Repository rule: the web studio is a **design prototype**, kept in `/prototype`, and is not part of the graded build.

**Exit gate:** green C++ build, tests passing, mirrored-plan test passing.

### M2: Vision Pipeline with Explainability (Weeks 2-3)
Implement every stage as a pure function that writes to `PipelineResult`. See B7. Includes the mosaic viewer, overlays, logs, and the Stage 7 merging/pairing logic.

**Exit gate:** on at least 6 of 8 dataset plans, auto-detected walls are recognizable and within 20 percent of the ground-truth count before manual correction.

### M3: Manual Correction, Calibration, Persistence (Weeks 3-4)
*(addresses R1)*
1. Window showing the image with segments overlaid.
2. Add (drag), delete (right-click), move endpoints, Shift for orthogonal lock, optional grid snap.
3. Command stack (add, delete, move) with undo/redo.
4. **Two-point calibration:** click two points, type the real distance (meters), compute `metersPerPixel`. Default if skipped: scale such that a typical door (0.9 m) matches, clearly labelled "uncalibrated".
5. JSON save/load of `{imagePath, scale, segments, openings}`.
6. Opening annotation tool (click on a wall, drag extent, choose door or window).

**Exit gate:** corrected output feeds the same downstream path as automatic output.

### M4: Geometry Engine (Weeks 4-6)
See B8. Mapping, extrusion, junction handling, openings, floor, validators, OBJ export.

**Exit gate:** OBJ files open correctly in MeshLab or Blender with correct orientation and outward normals.

### M5: Renderer Completion (Weeks 5-7, parallel with M4 where possible)
See B9.

### M6: Integration (Week 8)
1. App flow: load image → pipeline → mosaic → optional edit → build mesh → 3D viewer.
2. Hot-keys or tabs to move among 2D debug, editor, 3D.
3. Config file (`config.json`) for all parameters.
4. Failure paths: no walls found, image unreadable, scale not calibrated → warn and route to the editor.

### M7: Evaluation (Week 9)
See B10. Run the scripted evaluation, collect tables and figures.

### M8: Report, Slides, Viva (Weeks 10-12)
See B11. Weeks 11-12 double as **buffer** for slips in M2-M4.

**Fallback decisions (decide in advance):**
- If Stage 7 auto-detection is poor by end of Week 3: lower the auto-accuracy target, lean on the manual editor, and report honestly with an ablation.
- If Clipper2 union or openings slip: ship per-wall boxes with end extension and document the limitation.

## B7. Vision Pipeline Specification (fixes R2, R4, R9)

Normalize first: resize so the longest side is at most 1600 px. **Express all kernel sizes and distance thresholds as fractions of image size** (so parameters survive different resolutions).

| # | Stage | Operation | Notes and default parameters |
|---|---|---|---|
| 1 | Load and resize | `imread`, `resize(INTER_AREA)` | Longest side ≤ 1600 px. Optional **deskew**: estimate dominant angle from a Hough angle histogram, rotate if off-axis by more than 1° |
| 2 | Grayscale normalization | `cvtColor`, CLAHE (clip 2.0, 8x8 tiles) | Compensates uneven scan lighting |
| 3 | Otsu binarization | `threshold(THRESH_BINARY_INV \| THRESH_OTSU)` | Ink becomes white. Log the Otsu threshold value |
| 4 | Morphological cleanup | Opening (3x3), then closing (about 5x5), then **connected-component area filter** | Opening removes thin strokes; closing bridges small door gaps; `connectedComponentsWithStats` drops components below a minimum area (text, dimension ticks). Do not rely on opening alone, since text can be thicker than 1 px |
| 5 | Canny edges | `Canny(low = 0.5·otsu, high = otsu)` | Thresholds derived from the Otsu value |
| 6 | Probabilistic Hough | `HoughLinesP(rho 1, theta π/180, threshold ~80, minLen ~3% of long side, maxGap ~10 px)` | Produces raw fragments (log count) |
| 7 | Orthogonal vectorization | Custom, see below | Output: final `vector<Segment2D>` plus overlays |

### Stage 7 algorithm (the core contribution)

1. **Angle snap:** if a segment is within about 5° of 0° or 90°, snap it to exactly horizontal or vertical (keep the midpoint). Discard or flag the rest (flag for manual review rather than silently dropping).
2. **Cluster by orientation** (horizontal and vertical).
3. **Cluster by perpendicular offset** (about 5-8 px tolerance) to group collinear fragments.
4. **Merge intervals along the axis:** union overlapping or near-touching intervals (gap tolerance about 10-15 px).
5. **Parallel-edge pairing (fixes the "two lines per wall" problem):** within each orientation, pair merged lines whose offsets differ by a plausible wall thickness `[t_min, t_max]`. Replace each pair with one **centerline** segment whose thickness is the offset difference. Unpaired lines become single-line walls with a default thickness.
6. **Endpoint snapping:** snap endpoints that lie within about 10 px of another wall's line or endpoint, to close corners and T-junctions.
7. **Optional thickness check:** sample the distance transform of the cleaned mask along each centerline (median value times 2) and compare with the paired value.

### Explainability outputs (required deliverables)
- **7-tile mosaic**, one tile per stage, each with its title and parameter line.
- **Overlay legend:** green = kept, red = discarded in merging, yellow = snapped, blue = paired centerline.
- **Per-stage log:** for example `Hough: 412 raw → 63 merged → 31 centerlines`, plus timing per stage.

## B8. Geometry Specification (fixes R5, R6, R14)

### B8.1 Mapping
Apply Section B3 with `u0, v0` set to the segment bounding-box center so the model is centered at the origin. All thickness values convert with `s`. Default height 2.7 m, default thickness 0.15 m if not measured.

### B8.2 Wall extrusion
For each segment from P1 to P2 (world XZ), with `d = P2 − P1`, `L = |d|`, `u = d/L`, `n = (−u_z, u_x)`:

```
A = P1 + n·t/2     B = P1 − n·t/2
C = P2 − n·t/2     D = P2 + n·t/2          (base, y = 0)
top corners = same + (0, h, 0)
```

- 6 faces × 4 vertices = **24 vertices, 36 indices** per box, per-face flat normals.
- Skip segments with `L < ε` (degenerate guard, already implemented).

### B8.3 Junction strategy (R6)
Decide on one approach per release, and **say precisely what is claimed in the report**:
- **Baseline (Tier 1):** extend each wall end by `t/2` where it meets another wall, so corners and T-junctions have no gaps. Overlapping boxes are accepted. Claim: *every wall is a closed 2-manifold; junction overlaps are hidden inside solid volume.*
- **Stretch (Tier 3):** rasterize wall footprints to polygons, union with Clipper2, and extrude the union for a **single watertight shell**. Only then claim whole-mesh watertightness.

### B8.4 Floor (R5)
- **Baseline:** floor quad over the bounding box of the walls.
- **Better:** compute the outer contour of the cleaned wall mask (`findContours`, `approxPolyDP`), convert to world coordinates, and run **ear clipping** on that polygon. This is where the existing `triangulatePolygon2D` gets its input.
- Ear clipping handles concave outlines but not polygons with holes; state this limitation.

### B8.5 Coplanar faces and z-fighting (R14)
- Wall bottom faces coincide with the floor at y = 0. Either omit wall bottom faces in the render mesh (keep them for export and validation), or apply `glPolygonOffset` to the floor, or lower the floor by 1-2 mm.
- Keep `zNear ≥ 0.1 m`, `zFar` just beyond the model radius.

### B8.6 Openings (Tier 2)
Openings are **manually annotated** (not auto-detected). For a wall with openings sorted along its length:
- Pillar boxes between openings (full height).
- Lintel box above each opening (`head` to `h`).
- Sill box under each window (`0` to `sill`).
Remember that adjacent sub-boxes share coplanar internal faces; the validator reports this honestly.

### B8.7 Validators and tests
1. **Winding:** for every triangle, `dot(cross(v1−v0, v2−v0), faceNormal) > 0`.
2. **Normal direction:** each face normal points away from the box centroid; report the percentage.
3. **Edge manifold check:** weld vertices by position, count how many triangles use each edge; for a single box every edge must have count 2.
4. **Dimension check:** a 5.00 m wall in the source must measure within tolerance in the mesh after calibration.
5. **OBJ export** with normals, for external inspection.

## B9. Renderer Specification

1. **Context and buffers:** GLFW 3.3 Core, GLAD, VAO/VBO/EBO, shader compile/link helper with log output, framebuffer-resize callback (viewport and aspect).
2. **Shaders (GLSL 330):**
   - Vertex: `FragPos = vec3(M·pos)`, `Normal = normalMatrix·n`, `gl_Position = P·V·M·pos`.
   - Fragment (Blinn-Phong, directional light): `ambient + kd·max(N·L,0) + ks·pow(max(N·H,0), shininess)`, with `H = normalize(L + V)`.
   - Extra modes via uniform: normals-as-colour, linearized depth.
3. **Camera:**
   - Orbit: yaw, pitch (clamped to ±89°), radius around a target; left drag.
   - Pan: right or middle drag moves the target along camera right and up vectors.
   - Zoom: scroll changes radius (and the ortho extent).
   - Frame-all key (F) to fit the model.
4. **Projection toggle (P):** perspective (45° FOV) and orthographic. Derive the ortho half-height from `radius·tan(fov/2)` so framing stays consistent when switching.
5. **Render modes:** wireframe (W) via `glPolygonMode`; cull toggle (C); normals (N); depth (Z).
6. **State:** `glEnable(GL_DEPTH_TEST)`, `GL_CULL_FACE` with CCW front faces.
7. **HUD:** FPS, projection mode, wireframe state, triangle count (window title or ImGui).
8. **Measurement tool (Tier 2):** unproject the mouse via `(P·V)⁻¹` to the plane y = 0, snap to nearby corners within 0.45 m, show the distance in meters and feet with ΔX and ΔZ.

## B10. Evaluation Plan (fixes R10)

### Ground truth
Annotate ground-truth wall segments for at least 5 plans **using the manual editor itself** (saved JSON). Member 4 annotates; Member 2 reviews, to avoid bias.

### Vision metrics
- **Segment precision and recall:** a detected segment matches a ground-truth segment if angle difference ≤ 3°, perpendicular distance ≤ 8 px (or 0.15 m), and overlap along the axis ≥ 50 percent. Report precision, recall, F1 per plan.
- **Wall-mask IoU:** rasterize both segment sets with their thickness into binary masks and compute pixel IoU (this is the meaningful IoU, not segment-to-segment IoU).
- **Endpoint deviation:** mean and maximum Euclidean error in pixels and in centimeters after calibration.
- **Human-in-the-loop cost:** number of edits and time needed to correct the auto result to ground truth. Report results **before and after manual correction**.

### Geometry metrics
Winding pass rate, outward-normal percentage, manifold-edge check results, and dimensional error against known real dimensions (for example a 3.00 m room measured in the mesh).

### Performance metrics
- **Pipeline:** per-stage time (mean of 20 runs, `std::chrono`), total latency at 1600 px.
- **Rendering:** disable vsync (`glfwSwapInterval(0)`), report average FPS and frame time (ms) for **synthetic scenes of 10, 100, 1000, and 5000 walls**, at 720p, 1080p, and 1440p. Real floor plans have too few walls to stress the GPU, so the synthetic grid is necessary. Record the machine specs.

### Qualitative
- Parameter ablations (Hough threshold, closing kernel, angle tolerance, with and without pair-merging) with before and after figures.
- Failure analysis: curved walls, hatched walls, text and furniture symbols, rotated scans, double-line walls. Show how the editor recovers each.

### Test suite (GoogleTest)
Angle snapping, interval merging, parallel pairing, mapping (including the no-mirror test), extrusion counts, winding, normals, edge-manifold validator, ear clipping on L-shapes, ray-floor intersection, snapping threshold, JSON round-trip.

## B11. Report, Slides and Viva

**Report contents** (map them onto your required 12 sections):
1. Problem and motivation; 2. Related work (including a short comparison with CNN-based plan parsers and why a classical approach was chosen: explainability, no training data, deterministic debugging); 3. Architecture and data contract; 4. Vision pipeline with per-stage figures; 5. Manual correction and calibration; 6. Metric mapping and mesh generation, with the math (mapping, extrusion, normals, winding); 7. Rendering pipeline, with the math (MVP, normal matrix, Blinn-Phong); 8. Implementation details and testing; 9. Results; 10. Failure analysis and limitations; 11. Future work (door detection, room segmentation, textures, learned wall detection); 12. Conclusion and references.

**Claims discipline:** say "metrically scaled" not "physically accurate"; say "openings are manually annotated"; say exactly what is watertight (B8.3).

**Viva demo script (8 minutes):**
1. Load a clean plan: show the 7-tile mosaic and the log.
2. Load the ambiguous plan: show the failure, then fix it in the editor and calibrate.
3. Generate the mesh and open the 3D view.
4. Demonstrate orbit, pan, zoom, perspective/orthographic, wireframe, normals, depth.
5. Toggle culling to prove the winding.
6. Show the validator output and the OBJ in MeshLab.
7. Show the evaluation tables.

Have a **recorded backup video** and a **pre-computed JSON** for each demo plan in case of live-demo trouble.

## B12. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Stage 7 produces doubled or fragmented walls | High | High | Parallel-edge pairing, merging, editor fallback, buddy review |
| C++ build or dependency problems on a member's machine | Medium | High | Week-1 gate, vcpkg manifest file, documented setup, one reference machine |
| Mirrored model slips back in | Low | Medium | Asymmetric-plan regression test |
| Junction gaps or z-fighting | Medium | Medium | End extension, floor offset, validators |
| Wrong scale | Medium | High | Mandatory calibration prompt; "uncalibrated" label when defaulted |
| Scope creep into Tier 3 | Medium | Medium | Tier gating at every weekly review |
| Evaluation done too late | Medium | High | Ground-truth annotation starts in Week 3 |
| Live demo failure | Low | High | Recorded video and cached JSON |

## B13. Reference Formulas

**Pixel to world (no mirroring)**
```
x = s·(u − u0),   z = s·(v − v0)
```

**Extrusion**
```
d = P2 − P1,  L = |d|,  u = d / L,  n = (−u_z, u_x)
A = P1 + n·t/2,  B = P1 − n·t/2,  C = P2 − n·t/2,  D = P2 + n·t/2
top corners = base corners + (0, h, 0)
```

**Ray to floor plane**
```
t = −O_y / D_y,   P = (O_x + t·D_x, 0, O_z + t·D_z)
```

**Blinn-Phong**
```
I = ka·Ia + kd·max(N·L, 0)·Id + ks·max(N·H, 0)^α·Is,   H = (L + V) / |L + V|
```

**Normal matrix**
```
N_matrix = transpose(inverse(mat3(M)))
```

---

## B14. Immediate Next Actions (this week)

1. Everyone builds `FloorPlan3D.exe` and reports success or errors (Member 4 collects).
2. Member 3 fixes the Z sign and adds the asymmetric-plan test.
3. Member 4 ports the 10 tests to GoogleTest and starts the dataset.
4. Member 2 creates `PipelineResult` and the stage skeletons; Member 1 builds the mosaic viewer.
5. Decide the target milestone dates in the first team meeting and record them in the README.
