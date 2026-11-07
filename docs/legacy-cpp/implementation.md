# Project Implementation Guide: FloorPlan3D
Explainable Floor-Plan-to-3D Reconstruction and Interactive Architectural Visualization Using OpenGL
Academic Theme 2: Intelligent 2D/3D Modelling, Reconstruction, and Visualization

## 1. Executive Summary
This project converts flat 2D architectural blueprints into interactive 3D building models using modern computer graphics and computer vision from scratch.
- No commercial black boxes (no Unity, Unreal, or Blender). All transformations, shaders, buffers, and meshes are built in C++ and OpenGL 3.3 Core Profile.
- No opaque machine learning. We use classical, explainable digital image processing (Otsu, morphology, Canny, Hough) with an interactive manual fallback.
- Decoupled architecture: The vision pipeline outputs a clean 2D metric contract (Point2D, WallSegment2D). The geometry engine turns this into watertight 3D meshes. The OpenGL renderer draws the scene.

## 2. 3-Tier Pipeline
1. Tier 1: Computer Vision Ingestion (OpenCV)
   Raw Image -> Grayscale -> Otsu Inverted Binarization -> Morphological Opening -> Canny Edges -> Hough Lines -> Vector Layout & Fallback.
2. Tier 2: Geometric Modeling & Math Bridge (Geometry Engine)
   - Coordinate Mapping: x = s*(u - u0), z = -s*(v - v0)
   - Watertight Box Extrusion (y=0 to y=h) with outward normals & CCW winding.
   - Ear-Clipping Polygon Triangulation (prevents concave L-shape floor slicing).
   - Raycast Unprojection: Screen pixels (mx, my) -> Floor plane (y = 0).
3. Tier 3: Modern OpenGL 3.3 Core Rendering Pipeline
   - VAO / VBO / EBO buffer management.
   - Orbit/Pan Camera (glm::lookAt), Perspective (45° FOV) & Orthographic views.
   - Blinn-Phong directional sunlight shaders.
   - Interactive 2-Point Measurement Tool with live 3D-to-2D tracking.

## 3. What Has Been Completed
- Core Geometry & Math Engine: Tested coordinate transforms, extrusion, winding, ear-clipping, matrix inversion, raycasting.
- Automated Test Suite: 10/10 unit tests passing under node:test.
- Live Interactive Studio: 3D WebGL renderer, 7-stage CV pipeline, CG algorithms lab (Bresenham, MVP, Z-buffer), measurement tool, and milestone matrix.
- Complete C++ Codebase: CMakeLists.txt, main.cpp, Camera.cpp, MeshGenerator.cpp, shaders, and unit tests ready.

## 4. Team Ownership
- Member 1 (OpenGL & Graphics Lead): Renderer.cpp, Camera.cpp, shaders/, main.cpp
- Member 2 (Computer Vision Lead): FloorPlanProcessor.cpp, tests/cv_tests.cpp
- Member 3 (Geometry & Modeling Lead): FloorPlanGeometry.h, MeshGenerator.cpp
- Member 4 (QA, Benchmarks & Academic Lead): CMakeLists.txt, unit tests, Report.pdf, slides

## 5. What We Do Next
1. Phase 1: Local Windows Desktop Build (Milestone 1 acceptance in VS Code).
2. Phase 2: Parametric Openings (splitting walls into left pillar, right pillar, lintel, and sill for doors/windows).
3. Phase 3: Local OpenCV Pipeline Integration (reading real PNG/JPG files from disk).
4. Phase 4: Benchmarks, Academic Report & Viva Defense.

## 6. Key Formulas
- Coordinate mapping: x = s*(u - u0), z = -s*(v - v0)
- Wall normal: u = d / ||d||, n_perp = (-u_z, u_x)
- Raycast intersection: t = -O_y / D_y, P_floor = O + t*D
- Blinn-Phong: I = k_a*I_a + k_d*max(N·L, 0)*I_d + k_s*max(N·H, 0)^alpha*I_s
