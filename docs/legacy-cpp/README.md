> **Legacy, never compiled.** This is the original C++ and OpenGL desktop design for FloorPlan3D, moved out of the web app on 4 Nov 2026. The product is the web app in `src/`; its milestones are in [`../milestones.md`](../milestones.md).

# Explainable Floor-Plan-to-3D Reconstruction and Visualization

A university-level Computer Graphics & Computer Vision system implementing modern OpenGL (Core Profile 3.3+), OpenCV 4.x, and GLM.

## Prerequisites (Windows 10 / 11)
1. **C++ Compiler**:
   - Visual Studio 2022 Community (MSVC with "Desktop development with C++") OR
   - MinGW-w64 (GCC 12+) via MSYS2.
2. **CMake**: version 3.20 or newer.
3. **vcpkg Dependency Manager** (Recommended for GLFW, GLM, OpenCV):
   ```cmd
   git clone https://github.com/microsoft/vcpkg.git
   cd vcpkg
   bootstrap-vcpkg.bat
   vcpkg install glfw3:x64-windows glm:x64-windows opencv4:x64-windows glad:x64-windows
   ```

## Building with CMake & VS Code
```cmd
# Configure with vcpkg toolchain
cmake -B build -S . -DCMAKE_TOOLCHAIN_FILE="C:/vcpkg/scripts/buildsystems/vcpkg.cmake"

# Build project
cmake --build build --config Release

# Run Unit Tests
ctest --test-dir build -C Release --output-on-failure

# Launch the Application
./build/Release/FloorPlan3D.exe
```

## Controls
- **Left Mouse Click + Drag**: Orbit 3D Camera (Pitch & Yaw).
- **Right Mouse Click + Drag**: Pan Camera along viewing plane.
- **Mouse Scroll**: Zoom In / Out (dolly).
- **Key 'P'**: Toggle Perspective vs Orthographic projection.
- **Key 'W'**: Toggle Wireframe (triangle triangulation) vs Solid Shaded.
- **Key 'N'**: Toggle Surface Normal visual vectors.
- **Key '1'-'7'**: Cycle explainable OpenCV 2D processing stages.
- **Key 'R'**: Reset Camera to default 45° architectural isometric view.
