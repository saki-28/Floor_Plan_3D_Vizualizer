# Project Implementation Guide: FloorPlan3D
**Explainable Floor-Plan-to-3D Reconstruction and Interactive Architectural Visualization Using OpenGL**  
*Academic Theme 2: Intelligent 2D/3D Modelling, Reconstruction, and Visualization*  
*Target Environment: C++17, Modern OpenGL (Core Profile 3.3+), OpenCV 4.x, GLFW, GLAD, GLM, CMake on Windows (VS Code / MSVC / MinGW-w64)*

---

## 1. Executive Summary

This project solves a fundamental engineering problem: **How do we reliably convert a flat, 2D architectural blueprint image into an interactive, physically accurate 3D building model using modern computer graphics and computer vision from scratch?**

### Core Philosophy
1. **No Commercial Black Boxes:** We do not use Unity, Unreal Engine, Blender, or pre-packaged CAD viewers. Every transformation matrix, buffer object, shader program, camera movement, and geometric extrusion is implemented in clean C++ and Modern OpenGL.
2. **No Opaque Machine Learning Gimmicks:** We avoid brittle end-to-end deep learning models that fail when confronted with dimension strings or door arcs. We use classical, **explainable digital image processing** (Otsu binarization, morphological opening/closing, Canny edge detection, Hough vectorization) backed by an interactive **manual correction fallback**.
3. **Decoupled Architecture:** The computer vision pipeline outputs an explicit 2D metric contract (`Point2D`, `WallSegment2D`). The geometric modeling engine turns this contract into watertight 3D meshes. The OpenGL renderer draws the scene. A vision bug will never prevent the 3D renderer from demonstrating computer graphics algorithms.

---

## 2. System Architecture & The 3-Tier Pipeline

```
┌────────────────────────────────────────────────────────────────────────┐
│ TIER 1: COMPUTER VISION INGESTION & EXPLAINABLE STAGES (OpenCV)        │
│                                                                        │
│ 1. Raw Image (PNG/JPG)                                                 │
│    └─► 2. Grayscale Normalization (Luminance Y = 0.299R+0.587G+0.114B) │
│        └─► 3. Inverted Otsu Binarization (Isolates ink vs paper)       │
│            └─► 4. Morphological Opening (Removes text and dimension ticks)
│                └─► 5. Canny Edge Detection (Gradient magnitude & hysteresis)
│                    └─► 6. Hough Transform & Orthogonal Snapping (0°/90°)
│                        └─► 7. Vectorized 2D Layout & Manual Adjustment  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Outputs Metric Point2D & WallSegment2D
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ TIER 2: GEOMETRIC MODELLING & MATH BRIDGE (Geometry Engine)            │
│                                                                        │
│ • Coordinate Mapping: (u, v) pixels ──► (x, z) world meters            │
│   x = s * (u - u0),  z = -s * (v - v0)                                 │
│ • Wall Extrusion: Direction vector u_wall, normal n_perp = (-u_z, u_x) │
│   Generates 6-face watertight cuboid with thickness t and height h     │
│ • Ear-Clipping Polygon Triangulation: Prevents concave L-shape slicing │
│ • Raycast Unprojection: Screen pixels (mx, my) ──► Floor plane (y = 0) │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Outputs Vertex Buffers (Pos, Norm, UV)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ TIER 3: MODERN OPENGL 3.3 CORE RENDERING PIPELINE (GLFW, GLAD, GLSL)   │
│                                                                        │
│ • Vertex Array Objects (VAO), Vertex Buffers (VBO), Index Buffers (EBO)│
│ • Orbit & Pan Camera Subsystem (glm::lookAt, yaw, pitch, radius)       │
│ • Projection Subsystem: Perspective (45° FOV) vs Orthographic (Plan)   │
│ • GLSL Shaders: Blinn-Phong directional sunlight + normal/depth modes  │
│ • Hardware Depth Testing (GL_DEPTH_TEST) & Back-face Culling (CCW)     │
│ • Interactive Measurement Tool: Real-time 3D-to-2D dimension overlay   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. What Has Been Completed So Far

### A. The Pure Logic & Mathematics Engine (`src/utils/geometryEngine.ts`)
- **Metric Coordinate Bijection:** Maps image pixel coordinates $(u, v)$ to world floor coordinates $(x, z)$ preserving OpenGL's right-handed convention ($+Y$ up, camera looking down $-Z$).
- **Watertight Box Wall Extrusion:** Computes unit tangent and perpendicular normal vectors for any 2D segment, extruding it from $y=0$ to $y=h$ into 6 quad faces (24 vertices, 36 indices) with counter-clockwise (CCW) triangle winding.
- **Degenerate Geometry Guard:** Safely detects zero-length wall segments ($\Delta x = \Delta z = 0$) and handles them without division-by-zero crashes.
- **Ear-Clipping Triangulation (`triangulatePolygon2D`):** Replaced naive convex fan triangulation with full ear clipping. Correctly triangulates non-convex and L-shaped rooms without producing stray diagonal triangles that slice across partition walls.
- **Camera Matrices:** 4x4 column-major matrix implementations for Model, View (`mat4LookAt`), Perspective (`mat4Perspective`), and Orthographic (`mat4Orthographic`) projections.
- **Screen-to-Floor Unprojection (`screenToFloorRay`):** Uses $(P \times V)^{-1}$ matrix inversion to cast a 3D ray from any 2D mouse position into the scene and calculate its intersection with the ground floor plane ($y=0$).
- **Magnetic Corner Snapping (`snapToFloorGeometry`):** Snaps cursor to within $0.45\text{m}$ of any wall corner, door opening, or room boundary.
- **Computer Graphics Demonstrations:** Pure integer Bresenham line algorithm with decision parameter tracking ($d_k$), floating-point DDA, and non-linear depth buffer distribution analysis.

### B. Automated Unit Test Suite (`src/utils/geometryEngine.test.ts`)
10 automated unit tests passing at 100% under `node:test`:
1. `imageToWorld` bijective coordinate mapping.
2. Degenerate zero-length wall safe handling.
3. Watertight box wall extrusion with 6 faces and outward normals.
4. Bresenham integer line rasterization accuracy.
5. DDA line rasterization endpoint matching.
6. MVP matrix transformation to clip space ($w_c > 0$).
7. Matrix inversion (`mat4Invert`) correctness.
8. Screen-to-floor ray unprojection in top-down camera view.
9. Magnetic geometry threshold snapping.
10. Ear-clipping triangulation on concave L-shaped rooms.

### C. Live Interactive Engineering Studio (Preview Web Application)
- **3D OpenGL Viewer:** Native WebGL canvas executing shaders identical to our C++ GLSL shaders. Includes Orbit, Pan, Zoom, Perspective/Orthographic switching, Wireframe mode, Phong shading, Normal vector visualization, and Z-buffer depth visualization.
- **Measurement Tool Overlay:** Users can click two floor points or corners to measure real-world distance in meters and feet, with orthogonal $\Delta X$ and $\Delta Z$ span breakdown and live 3D-to-2D camera tracking.
- **7-Stage Explainable Vision Visualizer:** Step-by-step interactive inspection of raw image, grayscale, Otsu threshold, morphological cleaning, Canny edges, Hough vectors, and Stage 7 vector editing with door/window punchers.
- **CG Algorithm Lab:** Interactive Bresenham grid, MVP matrix inspector, Z-buffer precision simulator, and Blinn-Phong lighting meters.
- **C++ Repository Explorer:** Interactive file tree and syntax-highlighted browser for the full C++ project with copy/download options.
- **Milestone 1 Acceptance Suite:** Verification matrix tracking GLFW, GLAD, VAO/VBO, shaders, depth testing, and camera input.

### D. Complete C++ Project Codebase (Ready in `src/data/cppProjectFiles.ts`)
- `CMakeLists.txt`: Full CMake configuration finding OpenGL, GLFW, GLAD, GLM, and OpenCV.
- `README.md`: Step-by-step Windows build guide for VS Code with MSVC or MinGW-w64 via `vcpkg`.
- `include/Camera.h` & `src/Camera.cpp`: View and Projection matrix camera controller.
- `include/FloorPlanGeometry.h`: Data structures for 2D points, walls, openings, and scale mapping.
- `include/MeshGenerator.h` & `src/MeshGenerator.cpp`: Extrusion and ear-clipping floor triangulation.
- `assets/shaders/vertex.glsl` & `assets/shaders/fragment.glsl`: Vertex and Fragment shaders.
- `src/main.cpp`: Complete Milestone 1 GLFW application loop.
- `tests/geometry_tests.cpp`: C++ test suite validating geometry math.

---

## 4. Team Member Ownership & Division of Labor

| Role & Member | Primary Responsibilities | Key Source Files |
| :--- | :--- | :--- |
| **Member 1**<br>*(OpenGL & Graphics Lead)* | GLFW window initialization, GLAD loading, GLSL shader authoring, Camera LookAt and Projection matrices, VAO/VBO/EBO management, depth testing, and wireframe toggle. | `Renderer.h/.cpp`<br>`Camera.h/.cpp`<br>`assets/shaders/*`<br>`main.cpp` |
| **Member 2**<br>*(Computer Vision Lead)* | OpenCV 4.x integration, 7-stage image preprocessing, Otsu binarization, morphological opening/closing, Canny edge detection, Hough line extraction, and orthogonal angle snapping. | `FloorPlanProcessor.h/.cpp`<br>`tests/cv_tests.cpp` |
| **Member 3**<br>*(Geometry & Modeling Lead)* | 2D vector data structures, metric pixel-to-world mapping, watertight 3D box wall extrusion, ear-clipping polygon triangulation, door/window opening punchers, and surface normal computation. | `FloorPlanGeometry.h`<br>`MeshGenerator.h/.cpp`<br>`tests/geometry_tests.cpp` |
| **Member 4**<br>*(QA, Benchmarks & Academic Lead)* | CMake build system maintenance, automated unit testing, measuring FPS and processing latencies, geometric error calculation against ground truth, and authoring the project report and slides. | `CMakeLists.txt`<br>`tests/*`<br>`README.md`<br>Project Report & Slides |

---

## 5. What We Do Next: Step-by-Step Implementation Roadmap

### Phase 1: Local Desktop Build (Milestone 1 Acceptance)
1. **Target:** Compile and run `FloorPlan3D.exe` on Windows using Visual Studio Code.
2. **Steps:**
   - Install `vcpkg` and install dependencies: `vcpkg install glfw3:x64-windows glm:x64-windows glad:x64-windows opencv4:x64-windows`.
   - Run CMake configure: `cmake -B build -S . -DCMAKE_TOOLCHAIN_FILE="C:/vcpkg/scripts/buildsystems/vcpkg.cmake"`.
   - Build: `cmake --build build --config Release`.
   - Execute `build/Release/FloorPlan3D.exe` and verify that the 4-wall house renders with camera orbit/pan.

### Phase 2: Advanced Geometric Openings (Milestone 2)
1. **Target:** Parametric door and window openings inside extruded walls.
2. **Algorithm:**
   - When a wall has `hasDoor = true`, divide the single extruded box into 3 sub-meshes:
     - **Left Pillar:** From wall start to opening start ($y = 0$ to $y = h$).
     - **Right Pillar:** From opening end to wall end ($y = 0$ to $y = h$).
     - **Lintel Beam:** Above the door opening ($y = \text{doorHeight}$ to $y = h$).
   - For windows, add a fourth sub-mesh:
     - **Sill Wall:** Beneath the window opening ($y = 0$ to $y = \text{sillHeight}$).
3. **Corner Miter Joints:** Connect intersecting perpendicular walls cleanly to avoid overlapping box artifacts.

### Phase 3: Local OpenCV Image Pipeline Integration (Milestone 3)
1. **Target:** Enable `FloorPlanProcessor` to read real image files from `assets/sample_floorplans/`.
2. **Implementation:**
   - Load image using `cv::imread`.
   - Execute grayscale conversion $\to$ Otsu binarization $\to$ morphological opening.
   - Run `cv::HoughLinesP` to extract line segments.
   - Snap angles to nearest horizontal/vertical within $5^\circ$ tolerance.
   - Convert detected line segments into `WallSegment2D` structs and feed them into `MeshGenerator`.

### Phase 4: Benchmarks, Academic Report & Viva Defense (Milestones 4 & 5)
1. **FPS Benchmarking:** Measure rendering frame rates under varying wall counts and window resolutions.
2. **Geometric Accuracy Metric:** Calculate IoU (Intersection over Union) and Euclidean endpoint deviation between automatically detected walls and ground-truth CAD blueprints.
3. **Academic Deliverables:** Complete the 12 required academic report sections, prepare presentation slides, and rehearse the live viva demonstration.

---

## 6. Key Mathematical Formulas for Reference

### 1. Image Pixel to 3D World Floor Mapping
$$x = s \cdot (u - u_0)$$
$$z = -s \cdot (v - v_0)$$
*Where $s$ is meters/pixel, $(u_0, v_0)$ is the image center, and the negative sign on $z$ maintains a right-handed coordinate system.*

### 2. Wall Extrusion & Perpendicular Thickness Vectors
For a wall from $P_1(x_1, z_1)$ to $P_2(x_2, z_2)$:
$$\vec{d} = (x_2 - x_1, \, z_2 - z_1), \quad L = \|\vec{d}\| = \sqrt{(x_2 - x_1)^2 + (z_2 - z_1)^2}$$
$$\vec{u}_{\text{wall}} = \frac{\vec{d}}{L}, \quad \vec{n}_{\perp} = (-u_z, \, u_x)$$
Base quad corners on floor ($y = 0$):
$$A = P_1 + \vec{n}_{\perp}\frac{t}{2}, \quad B = P_1 - \vec{n}_{\perp}\frac{t}{2}, \quad C = P_2 - \vec{n}_{\perp}\frac{t}{2}, \quad D = P_2 + \vec{n}_{\perp}\frac{t}{2}$$
Top quad corners extruded to ceiling ($y = h$):
$$A_t = A + (0, h, 0), \quad B_t = B + (0, h, 0), \quad C_t = C + (0, h, 0), \quad D_t = D + (0, h, 0)$$

### 3. Raycast Floor Plane Intersection
Given ray origin $\vec{O}$ and direction $\vec{D}$ computed from $(P \times V)^{-1}$:
$$O_y + t \cdot D_y = 0 \implies t = \frac{-O_y}{D_y}$$
$$P_{\text{floor}} = (O_x + t \cdot D_x, \, 0, \, O_z + t \cdot D_z)$$

### 4. Blinn-Phong Shading Model
$$I = k_a I_a + k_d \max(\vec{N} \cdot \vec{L}, 0) I_d + k_s \max(\vec{N} \cdot \vec{H}, 0)^\alpha I_s$$
*Where $\vec{H} = \frac{\vec{L} + \vec{V}}{\|\vec{L} + \vec{V}\|}$ is the halfway vector between light and view directions.*

---

## 7. Common Pitfalls & How We Solve Them

1. **Back-Face Culling Inversion (`GL_CULL_FACE`):**  
   *Issue:* Walls appear invisible or see-through when viewed from the outside.  
   *Fix:* Strictly order vertices Counter-Clockwise (CCW) when viewed from the outside of the wall quad face. OpenGL's front face rule is `glFrontFace(GL_CCW)` and `glCullFace(GL_BACK)`.
2. **Concave Room Floor Slicing:**  
   *Issue:* L-shaped rooms generate a spurious diagonal triangle cutting through interior walls.  
   *Fix:* Use Ear-Clipping Triangulation (`triangulatePolygon2D`) rather than naive triangle fans.
3. **Z-Fighting and Depth Buffer Collapse:**  
   *Issue:* Floors and coplanar wall bases flicker and jitter.  
   *Fix:* Set $z_{\text{near}} \ge 0.1\text{m}$ rather than $0.001\text{m}$. Because perspective depth precision scales as $\frac{1}{z}$, an excessively small near plane consumes $90\%$ of 24-bit precision within the first few centimeters.
4. **Blueprint Annotations Corrupting Wall Detection:**  
   *Issue:* Text labels (e.g. "KITCHEN") and dimension arrows produce dozens of broken line fragments.  
   *Fix:* Apply Morphological Opening ($3 \times 3$ kernel) to erode 1-pixel thin annotation strokes while preserving thick 6-pixel structural wall profiles, followed by manual vector adjustment in Stage 7.
