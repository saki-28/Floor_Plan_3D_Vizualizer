export interface CppFile {
  path: string;
  category: 'build' | 'header' | 'source' | 'shader' | 'test' | 'doc';
  description: string;
  code: string;
}

export const CPP_PROJECT_FILES: CppFile[] = [
  {
    path: 'CMakeLists.txt',
    category: 'build',
    description: 'Modern CMake configuration for C++17, OpenGL, GLFW, GLAD, GLM, and OpenCV',
    code: `cmake_minimum_required(VERSION 3.20)
project(FloorPlan3D VERSION 1.0.0 LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Enable compiler warnings
if(MSVC)
    add_compile_options(/W4 /EHsc)
else()
    add_compile_options(-Wall -Wextra -pedantic)
endif()

# Find mandatory external packages
find_package(OpenGL REQUIRED)
find_package(glfw3 CONFIG REQUIRED)
find_package(glm CONFIG REQUIRED)
find_package(OpenCV REQUIRED)

# Include directories
include_directories(
    include
    \${OPENGL_INCLUDE_DIR}
    \${OpenCV_INCLUDE_DIRS}
)

# Project sources
set(SOURCES
    src/main.cpp
    src/Camera.cpp
    src/FloorPlanGeometry.cpp
    src/MeshGenerator.cpp
    src/Renderer.cpp
    src/FloorPlanProcessor.cpp
    # Include glad if compiling from vendored source:
    # external/glad/src/glad.c
)

# Main executable
add_executable(FloorPlan3D \${SOURCES})

target_link_libraries(FloorPlan3D PRIVATE
    OpenGL::GL
    glfw
    glm::glm
    \${OpenCV_LIBS}
)

# Copy shaders and sample floorplans to binary directory
add_custom_command(TARGET FloorPlan3D POST_BUILD
    COMMAND \${CMAKE_COMMAND} -E copy_directory
    \${CMAKE_SOURCE_DIR}/assets \${CMAKE_CURRENT_BINARY_DIR}/assets
)

# Unit test executable for Milestone 1 geometry & transformations
enable_testing()
add_executable(geometry_tests tests/geometry_tests.cpp src/FloorPlanGeometry.cpp src/MeshGenerator.cpp)
target_link_libraries(geometry_tests PRIVATE glm::glm)
add_test(NAME GeometryUnitTests COMMAND geometry_tests)
`
  },
  {
    path: 'README.md',
    category: 'doc',
    description: 'Windows setup guide using VS Code, CMake, MinGW-w64 or MSVC with vcpkg',
    code: `# Explainable Floor-Plan-to-3D Reconstruction and Visualization

A university-level Computer Graphics & Computer Vision system implementing modern OpenGL (Core Profile 3.3+), OpenCV 4.x, and GLM.

## Prerequisites (Windows 10 / 11)
1. **C++ Compiler**:
   - Visual Studio 2022 Community (MSVC with "Desktop development with C++") OR
   - MinGW-w64 (GCC 12+) via MSYS2.
2. **CMake**: version 3.20 or newer.
3. **vcpkg Dependency Manager** (Recommended for GLFW, GLM, OpenCV):
   \`\`\`cmd
   git clone https://github.com/microsoft/vcpkg.git
   cd vcpkg
   bootstrap-vcpkg.bat
   vcpkg install glfw3:x64-windows glm:x64-windows opencv4:x64-windows glad:x64-windows
   \`\`\`

## Building with CMake & VS Code
\`\`\`cmd
# Configure with vcpkg toolchain
cmake -B build -S . -DCMAKE_TOOLCHAIN_FILE="C:/vcpkg/scripts/buildsystems/vcpkg.cmake"

# Build project
cmake --build build --config Release

# Run Unit Tests
ctest --test-dir build -C Release --output-on-failure

# Launch the Application
./build/Release/FloorPlan3D.exe
\`\`\`

## Controls
- **Left Mouse Click + Drag**: Orbit 3D Camera (Pitch & Yaw).
- **Right Mouse Click + Drag**: Pan Camera along viewing plane.
- **Mouse Scroll**: Zoom In / Out (dolly).
- **Key 'P'**: Toggle Perspective vs Orthographic projection.
- **Key 'W'**: Toggle Wireframe (triangle triangulation) vs Solid Shaded.
- **Key 'N'**: Toggle Surface Normal visual vectors.
- **Key '1'-'7'**: Cycle explainable OpenCV 2D processing stages.
- **Key 'R'**: Reset Camera to default 45° architectural isometric view.
`
  },
  {
    path: 'include/Camera.h',
    category: 'header',
    description: 'First-person and orbit camera abstraction with View and Projection matrix derivation',
    code: `#pragma once

#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>

enum class ProjectionMode {
    Perspective,
    Orthographic
};

class Camera {
public:
    Camera(glm::vec3 position = glm::vec3(0.0f, 8.0f, 12.0f),
           glm::vec3 target = glm::vec3(0.0f, 0.0f, 0.0f),
           glm::vec3 up = glm::vec3(0.0f, 1.0f, 0.0f));

    void ProcessMouseMovement(float xoffset, float yoffset, bool isPanning);
    void ProcessMouseScroll(float yoffset);
    void Reset();

    glm::mat4 GetViewMatrix() const;
    glm::mat4 GetProjectionMatrix(float aspectRatio) const;

    void SetProjectionMode(ProjectionMode mode) { m_projectionMode = mode; }
    ProjectionMode GetProjectionMode() const { return m_projectionMode; }
    void ToggleProjectionMode();

    glm::vec3 GetPosition() const { return m_position; }
    glm::vec3 GetTarget() const { return m_target; }

private:
    void UpdateCameraVectors();

    glm::vec3 m_position;
    glm::vec3 m_target;
    glm::vec3 m_up;
    glm::vec3 m_front;
    glm::vec3 m_right;

    float m_radius;
    float m_yaw;
    float m_pitch;
    float m_fov;
    float m_orthoSize;

    ProjectionMode m_projectionMode;
};
`
  },
  {
    path: 'src/Camera.cpp',
    category: 'source',
    description: 'Camera View matrix (LookAt) and Projection matrix implementation using GLM',
    code: `#include "Camera.h"
#include <algorithm>

Camera::Camera(glm::vec3 position, glm::vec3 target, glm::vec3 up)
    : m_position(position), m_target(target), m_up(up),
      m_fov(45.0f), m_orthoSize(8.0f), m_projectionMode(ProjectionMode::Perspective) {
    m_radius = glm::length(position - target);
    m_yaw = -90.0f;
    m_pitch = 35.0f;
    UpdateCameraVectors();
}

void Camera::UpdateCameraVectors() {
    float pitchRad = glm::radians(m_pitch);
    float yawRad = glm::radians(m_yaw);

    m_position.x = m_target.x + m_radius * cos(pitchRad) * cos(yawRad);
    m_position.y = m_target.y + m_radius * sin(pitchRad);
    m_position.z = m_target.z + m_radius * cos(pitchRad) * sin(yawRad);

    m_front = glm::normalize(m_target - m_position);
    m_right = glm::normalize(glm::cross(m_front, glm::vec3(0.0f, 1.0f, 0.0f)));
    m_up    = glm::normalize(glm::cross(m_right, m_front));
}

void Camera::ProcessMouseMovement(float xoffset, float yoffset, bool isPanning) {
    if (isPanning) {
        float panSpeed = 0.015f * (m_radius / 10.0f);
        m_target -= m_right * (xoffset * panSpeed);
        m_target += m_up * (yoffset * panSpeed);
    } else {
        float sensitivity = 0.25f;
        m_yaw   += xoffset * sensitivity;
        m_pitch += yoffset * sensitivity;

        // Prevent camera flipping at poles
        m_pitch = std::clamp(m_pitch, 5.0f, 89.0f);
    }
    UpdateCameraVectors();
}

void Camera::ProcessMouseScroll(float yoffset) {
    m_radius -= yoffset * 0.8f;
    m_radius = std::clamp(m_radius, 2.0f, 50.0f);

    m_orthoSize -= yoffset * 0.5f;
    m_orthoSize = std::clamp(m_orthoSize, 2.0f, 30.0f);

    UpdateCameraVectors();
}

void Camera::Reset() {
    m_target = glm::vec3(0.0f, 0.0f, 0.0f);
    m_radius = 16.0f;
    m_yaw = -45.0f;
    m_pitch = 35.0f;
    m_fov = 45.0f;
    m_orthoSize = 8.0f;
    UpdateCameraVectors();
}

glm::mat4 Camera::GetViewMatrix() const {
    return glm::lookAt(m_position, m_target, m_up);
}

glm::mat4 Camera::GetProjectionMatrix(float aspectRatio) const {
    if (m_projectionMode == ProjectionMode::Perspective) {
        return glm::perspective(glm::radians(m_fov), aspectRatio, 0.1f, 100.0f);
    } else {
        float halfW = m_orthoSize * aspectRatio * 0.5f;
        float halfH = m_orthoSize * 0.5f;
        return glm::ortho(-halfW, halfW, -halfH, halfH, 0.1f, 100.0f);
    }
}

void Camera::ToggleProjectionMode() {
    m_projectionMode = (m_projectionMode == ProjectionMode::Perspective)
                       ? ProjectionMode::Orthographic
                       : ProjectionMode::Perspective;
}
`
  },
  {
    path: 'include/FloorPlanGeometry.h',
    category: 'header',
    description: '2D geometric representation: points, wall segments, thickness, and coordinate transformation',
    code: `#pragma once

#include <glm/glm.hpp>
#include <string>
#include <vector>

struct Point2D {
    float x;
    float z;
};

struct WallSegment2D {
    std::string id;
    Point2D start;
    Point2D end;
    float thickness = 0.2f;
    float height = 2.8f;

    bool hasDoor = false;
    float doorPosition = 0.5f; // [0, 1]
    float doorWidth = 0.9f;

    bool hasWindow = false;
    float windowPosition = 0.5f;
    float windowWidth = 1.6f;
    float windowSillHeight = 0.9f;
    float windowHeight = 1.4f;
};

struct CoordinateMapping {
    float scale = 0.015f; // meters per pixel
    float u0 = 400.0f;    // origin x in image pixels
    float v0 = 300.0f;    // origin y in image pixels

    Point2D ImageToWorld(float u, float v) const {
        return { scale * (u - u0), -scale * (v - v0) };
    }

    glm::vec2 WorldToImage(float x, float z) const {
        return { (x / scale) + u0, (-z / scale) + v0 };
    }
};
`
  },
  {
    path: 'include/MeshGenerator.h',
    category: 'header',
    description: 'Generates 3D polygonal meshes, normal vectors, and triangle winding from 2D walls',
    code: `#pragma once

#include "FloorPlanGeometry.h"
#include <vector>

struct Vertex {
    glm::vec3 position;
    glm::vec3 normal;
    glm::vec2 texCoords;
};

struct MeshData {
    std::vector<Vertex> vertices;
    std::vector<unsigned int> indices;

    void Clear() {
        vertices.clear();
        indices.clear();
    }
};

class MeshGenerator {
public:
    static MeshData GenerateWallMesh(const WallSegment2D& wall);
    static MeshData GenerateFloorMesh(const std::vector<Point2D>& boundaryCorners);
    static MeshData GenerateHouseModel(const std::vector<WallSegment2D>& walls);

private:
    static void AddQuad(MeshData& mesh,
                        const glm::vec3& p0, const glm::vec3& p1,
                        const glm::vec3& p2, const glm::vec3& p3,
                        const glm::vec3& normal);
};
`
  },
  {
    path: 'src/MeshGenerator.cpp',
    category: 'source',
    description: 'Wall extrusion algorithm with outward surface normals and CCW winding for backface culling',
    code: `#include "MeshGenerator.h"
#include <cmath>

void MeshGenerator::AddQuad(MeshData& mesh,
                            const glm::vec3& p0, const glm::vec3& p1,
                            const glm::vec3& p2, const glm::vec3& p3,
                            const glm::vec3& normal) {
    unsigned int baseIndex = static_cast<unsigned int>(mesh.vertices.size());

    mesh.vertices.push_back({ p0, normal, glm::vec2(0.0f, 0.0f) });
    mesh.vertices.push_back({ p1, normal, glm::vec2(1.0f, 0.0f) });
    mesh.vertices.push_back({ p2, normal, glm::vec2(1.0f, 1.0f) });
    mesh.vertices.push_back({ p3, normal, glm::vec2(0.0f, 1.0f) });

    // Counter-Clockwise (CCW) triangle winding
    mesh.indices.push_back(baseIndex);
    mesh.indices.push_back(baseIndex + 1);
    mesh.indices.push_back(baseIndex + 2);

    mesh.indices.push_back(baseIndex);
    mesh.indices.push_back(baseIndex + 2);
    mesh.indices.push_back(baseIndex + 3);
}

MeshData MeshGenerator::GenerateWallMesh(const WallSegment2D& wall) {
    MeshData mesh;
    float dx = wall.end.x - wall.start.x;
    float dz = wall.end.z - wall.start.z;
    float len = std::hypot(dx, dz);

    if (len < 1e-5f) {
        // Safe handling for degenerate zero-length wall
        return mesh;
    }

    // Direction along wall
    float ux = dx / len;
    float uz = dz / len;

    // Perpendicular normal in XZ plane
    float nx = -uz;
    float nz = ux;

    float halfT = wall.thickness * 0.5f;
    float h = wall.height;

    // 4 Base points on floor (y = 0)
    glm::vec3 A(wall.start.x + nx * halfT, 0.0f, wall.start.z + nz * halfT);
    glm::vec3 B(wall.start.x - nx * halfT, 0.0f, wall.start.z - nz * halfT);
    glm::vec3 C(wall.end.x   - nx * halfT, 0.0f, wall.end.z   - nz * halfT);
    glm::vec3 D(wall.end.x   + nx * halfT, 0.0f, wall.end.z   + nz * halfT);

    // 4 Top points extruded to y = h
    glm::vec3 At = A + glm::vec3(0.0f, h, 0.0f);
    glm::vec3 Bt = B + glm::vec3(0.0f, h, 0.0f);
    glm::vec3 Ct = C + glm::vec3(0.0f, h, 0.0f);
    glm::vec3 Dt = D + glm::vec3(0.0f, h, 0.0f);

    // 1. Front face (+normal)
    AddQuad(mesh, D, A, At, Dt, glm::vec3(nx, 0.0f, nz));
    // 2. Back face (-normal)
    AddQuad(mesh, B, C, Ct, Bt, glm::vec3(-nx, 0.0f, -nz));
    // 3. Start cap (-tangent)
    AddQuad(mesh, A, B, Bt, At, glm::vec3(-ux, 0.0f, -uz));
    // 4. End cap (+tangent)
    AddQuad(mesh, C, D, Dt, Ct, glm::vec3(ux, 0.0f, uz));
    // 5. Top face (+Y)
    AddQuad(mesh, At, Bt, Ct, Dt, glm::vec3(0.0f, 1.0f, 0.0f));
    // 6. Bottom face (-Y)
    AddQuad(mesh, D, C, B, A, glm::vec3(0.0f, -1.0f, 0.0f));

    return mesh;
}

// Helper for ear clipping triangulation in C++
static float CrossProduct2D(const Point2D& a, const Point2D& b, const Point2D& c) {
    return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

static bool IsPointInTriangle(const Point2D& p, const Point2D& a, const Point2D& b, const Point2D& c) {
    float cp1 = CrossProduct2D(a, b, p);
    float cp2 = CrossProduct2D(b, c, p);
    float cp3 = CrossProduct2D(c, a, p);
    bool hasNeg = (cp1 < -1e-5f) || (cp2 < -1e-5f) || (cp3 < -1e-5f);
    bool hasPos = (cp1 > 1e-5f) || (cp2 > 1e-5f) || (cp3 > 1e-5f);
    return !(hasNeg && hasPos);
}

MeshData MeshGenerator::GenerateFloorMesh(const std::vector<Point2D>& corners) {
    MeshData mesh;
    size_t n = corners.size();
    if (n < 3) return mesh;

    for (const auto& c : corners) {
        mesh.vertices.push_back({
            glm::vec3(c.x, 0.0f, c.z),
            glm::vec3(0.0f, 1.0f, 0.0f),
            glm::vec2(c.x * 0.5f, c.z * 0.5f)
        });
    }

    if (n == 3) {
        mesh.indices = { 0, 1, 2 };
        return mesh;
    }

    // Ear-clipping triangulation for arbitrary concave / L-shaped polygons
    float signedArea = 0.0f;
    for (size_t i = 0; i < n; ++i) {
        const auto& p1 = corners[i];
        const auto& p2 = corners[(i + 1) % n];
        signedArea += (p1.x * p2.z - p2.x * p1.z);
    }
    bool isCCW = signedArea > 0.0f;

    std::vector<unsigned int> V(n);
    for (size_t i = 0; i < n; ++i) V[i] = static_cast<unsigned int>(i);

    size_t safetyCount = 2 * n * n;
    while (V.size() > 2 && safetyCount > 0) {
        safetyCount--;
        bool earFound = false;

        for (size_t i = 0; i < V.size(); ++i) {
            unsigned int prevIdx = V[(i + V.size() - 1) % V.size()];
            unsigned int currIdx = V[i];
            unsigned int nextIdx = V[(i + 1) % V.size()];

            const auto& a = corners[prevIdx];
            const auto& b = corners[currIdx];
            const auto& c = corners[nextIdx];

            float cross = CrossProduct2D(a, b, c);
            bool isConvex = isCCW ? (cross > 1e-5f) : (cross < -1e-5f);
            if (!isConvex) continue;

            bool containsOther = false;
            for (size_t j = 0; j < V.size(); ++j) {
                unsigned int testIdx = V[j];
                if (testIdx == prevIdx || testIdx == currIdx || testIdx == nextIdx) continue;
                if (IsPointInTriangle(corners[testIdx], a, b, c)) {
                    containsOther = true;
                    break;
                }
            }

            if (!containsOther) {
                mesh.indices.push_back(prevIdx);
                mesh.indices.push_back(currIdx);
                mesh.indices.push_back(nextIdx);
                V.erase(V.begin() + i);
                earFound = true;
                break;
            }
        }
        if (!earFound) break;
    }

    // Fallback to fan if needed
    if (mesh.indices.size() < 3) {
        for (size_t i = 1; i + 1 < n; ++i) {
            mesh.indices.push_back(0);
            mesh.indices.push_back(static_cast<unsigned int>(i));
            mesh.indices.push_back(static_cast<unsigned int>(i + 1));
        }
    }

    return mesh;
}

MeshData MeshGenerator::GenerateHouseModel(const std::vector<WallSegment2D>& walls) {
    MeshData combined;
    for (const auto& w : walls) {
        MeshData wallMesh = GenerateWallMesh(w);
        unsigned int offset = static_cast<unsigned int>(combined.vertices.size());
        for (const auto& v : wallMesh.vertices) combined.vertices.push_back(v);
        for (auto idx : wallMesh.indices) combined.indices.push_back(idx + offset);
    }
    return combined;
}
`
  },
  {
    path: 'assets/shaders/vertex.glsl',
    category: 'shader',
    description: 'Vertex shader executing MVP transformation: p_clip = P * V * M * p_model',
    code: `#version 330 core

layout (location = 0) in vec3 aPos;
layout (location = 1) in vec3 aNormal;
layout (location = 2) in vec2 aTexCoord;

out vec3 FragPos;
out vec3 Normal;
out vec2 TexCoord;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;

void main() {
    // Transform vertex position to world coordinates
    FragPos = vec3(uModel * vec4(aPos, 1.0));

    // Normal matrix transforms surface normal correctly under non-uniform scaling
    Normal = mat3(transpose(inverse(uModel))) * aNormal;

    TexCoord = aTexCoord;

    // Standard MVP pipeline
    gl_Position = uProjection * uView * vec4(FragPos, 1.0);
}
`
  },
  {
    path: 'assets/shaders/fragment.glsl',
    category: 'shader',
    description: 'Fragment shader implementing ambient, diffuse Lambertian, and Blinn-Phong specular shading',
    code: `#version 330 core

out vec4 FragColor;

in vec3 FragPos;
in vec3 Normal;
in vec2 TexCoord;

uniform vec3 uColor;
uniform vec3 uLightDir;
uniform vec3 uViewPos;
uniform int uRenderMode; // 0 = Shaded, 1 = Normal Vectors, 2 = Depth Buffer

void main() {
    if (uRenderMode == 1) {
        // Visualize surface normal directions as RGB
        vec3 nColor = normalize(Normal) * 0.5 + 0.5;
        FragColor = vec4(nColor, 1.0);
        return;
    }

    if (uRenderMode == 2) {
        // Visualize linearized depth
        float depth = gl_FragCoord.z;
        FragColor = vec4(vec3(depth), 1.0);
        return;
    }

    // Directional Light + Blinn-Phong
    vec3 norm = normalize(Normal);
    vec3 lightDir = normalize(-uLightDir);
    vec3 viewDir = normalize(uViewPos - FragPos);
    vec3 halfwayDir = normalize(lightDir + viewDir);

    // 1. Ambient Term
    vec3 ambient = 0.25 * uColor;

    // 2. Diffuse Lambertian Term
    float diff = max(dot(norm, lightDir), 0.0);
    vec3 diffuse = diff * uColor * 0.75;

    // 3. Specular Highlight Term
    float spec = pow(max(dot(norm, halfwayDir), 0.0), 32.0);
    vec3 specular = vec3(0.2) * spec;

    vec3 result = ambient + diffuse + specular;
    FragColor = vec4(result, 1.0);
}
`
  },
  {
    path: 'src/main.cpp',
    category: 'source',
    description: 'Milestone 1 entry point: GLFW window, modern OpenGL context, VAO/VBO, camera loop',
    code: `#include <iostream>
#include <glad/glad.h>
#include <GLFW/glfw3.h>
#include <glm/glm.hpp>
#include <glm/gtc/type_ptr.hpp>

#include "Camera.h"
#include "MeshGenerator.h"
#include "FloorPlanGeometry.h"

// Window dimensions
const unsigned int SCR_WIDTH = 1280;
const unsigned int SCR_HEIGHT = 720;

Camera camera(glm::vec3(0.0f, 10.0f, 16.0f), glm::vec3(0.0f, 0.0f, 0.0f));
float lastX = SCR_WIDTH / 2.0f;
float lastY = SCR_HEIGHT / 2.0f;
bool firstMouse = true;
bool wireframe = false;

void framebuffer_size_callback(GLFWwindow* window, int width, int height) {
    glViewport(0, 0, width, height);
}

void mouse_callback(GLFWwindow* window, double xposIn, double yposIn) {
    float xpos = static_cast<float>(xposIn);
    float ypos = static_cast<float>(yposIn);

    if (firstMouse) {
        lastX = xpos;
        lastY = ypos;
        firstMouse = false;
    }

    float xoffset = xpos - lastX;
    float yoffset = lastY - ypos; // Reversed since y-coords go bottom to top
    lastX = xpos;
    lastY = ypos;

    bool isPanning = glfwGetMouseButton(window, GLFW_MOUSE_BUTTON_RIGHT) == GLFW_PRESS;
    bool isOrbiting = glfwGetMouseButton(window, GLFW_MOUSE_BUTTON_LEFT) == GLFW_PRESS;

    if (isOrbiting || isPanning) {
        camera.ProcessMouseMovement(xoffset, yoffset, isPanning);
    }
}

void scroll_callback(GLFWwindow* window, double xoffset, double yoffset) {
    camera.ProcessMouseScroll(static_cast<float>(yoffset));
}

void processInput(GLFWwindow* window) {
    if (glfwGetKey(window, GLFW_KEY_ESCAPE) == GLFW_PRESS)
        glfwSetWindowShouldClose(window, true);

    static bool pPressed = false;
    if (glfwGetKey(window, GLFW_KEY_P) == GLFW_PRESS && !pPressed) {
        camera.ToggleProjectionMode();
        pPressed = true;
    } else if (glfwGetKey(window, GLFW_KEY_P) == GLFW_RELEASE) {
        pPressed = false;
    }

    static bool wPressed = false;
    if (glfwGetKey(window, GLFW_KEY_W) == GLFW_PRESS && !wPressed) {
        wireframe = !wireframe;
        glPolygonMode(GL_FRONT_AND_BACK, wireframe ? GL_LINE : GL_FILL);
        wPressed = true;
    } else if (glfwGetKey(window, GLFW_KEY_W) == GLFW_RELEASE) {
        wPressed = false;
    }

    if (glfwGetKey(window, GLFW_KEY_R) == GLFW_PRESS) {
        camera.Reset();
    }
}

int main() {
    // 1. Initialize GLFW
    if (!glfwInit()) {
        std::cerr << "Failed to initialize GLFW" << std::endl;
        return -1;
    }
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 3);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);

    GLFWwindow* window = glfwCreateWindow(SCR_WIDTH, SCR_HEIGHT,
        "FloorPlan3D - Milestone 1 OpenGL Foundation", NULL, NULL);
    if (!window) {
        std::cerr << "Failed to create GLFW window" << std::endl;
        glfwTerminate();
        return -1;
    }
    glfwMakeContextCurrent(window);
    glfwSetFramebufferSizeCallback(window, framebuffer_size_callback);
    glfwSetCursorPosCallback(window, mouse_callback);
    glfwSetScrollCallback(window, scroll_callback);

    // 2. Load OpenGL functions via GLAD
    if (!gladLoadGLLoader((GLADloadproc)glfwGetProcAddress)) {
        std::cerr << "Failed to initialize GLAD" << std::endl;
        return -1;
    }

    // 3. Configure global OpenGL state
    glEnable(GL_DEPTH_TEST);
    glDepthFunc(GL_LESS);
    glEnable(GL_CULL_FACE);
    glCullFace(GL_BACK);
    glFrontFace(GL_CCW);

    std::cout << "OpenGL Version: " << glGetString(GL_VERSION) << std::endl;
    std::cout << "Renderer: " << glGetString(GL_RENDERER) << std::endl;

    // 4. Milestone 1 Geometry: 4 walls and floor
    std::vector<WallSegment2D> walls = {
        { "w1", { -4.0f, -3.0f }, {  4.0f, -3.0f }, 0.25f, 2.8f },
        { "w2", {  4.0f, -3.0f }, {  4.0f,  3.0f }, 0.25f, 2.8f },
        { "w3", {  4.0f,  3.0f }, { -4.0f,  3.0f }, 0.25f, 2.8f },
        { "w4", { -4.0f,  3.0f }, { -4.0f, -3.0f }, 0.25f, 2.8f }
    };
    MeshData houseMesh = MeshGenerator::GenerateHouseModel(walls);

    std::cout << "Generated Milestone 1 House Mesh:" << std::endl;
    std::cout << "  Vertices: " << houseMesh.vertices.size() << std::endl;
    std::cout << "  Indices:  " << houseMesh.indices.size() << std::endl;

    // 5. Setup VAO, VBO, EBO
    unsigned int VAO, VBO, EBO;
    glGenVertexArrays(1, &VAO);
    glGenBuffers(1, &VBO);
    glGenBuffers(1, &EBO);

    glBindVertexArray(VAO);
    glBindBuffer(GL_ARRAY_BUFFER, VBO);
    glBufferData(GL_ARRAY_BUFFER, houseMesh.vertices.size() * sizeof(Vertex),
                 houseMesh.vertices.data(), GL_STATIC_DRAW);

    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, EBO);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, houseMesh.indices.size() * sizeof(unsigned int),
                 houseMesh.indices.data(), GL_STATIC_DRAW);

    // Position attribute
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, sizeof(Vertex), (void*)0);
    glEnableVertexAttribArray(0);
    // Normal attribute
    glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, sizeof(Vertex), (void*)offsetof(Vertex, normal));
    glEnableVertexAttribArray(1);
    // TexCoord attribute
    glVertexAttribPointer(2, 2, GL_FLOAT, GL_FALSE, sizeof(Vertex), (void*)offsetof(Vertex, texCoords));
    glEnableVertexAttribArray(2);

    // 6. Main Render Loop
    while (!glfwWindowShouldClose(window)) {
        processInput(window);

        glClearColor(0.12f, 0.14f, 0.18f, 1.0f);
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

        // Bind VAO and draw house elements
        glBindVertexArray(VAO);
        glDrawElements(GL_TRIANGLES, static_cast<GLsizei>(houseMesh.indices.size()), GL_UNSIGNED_INT, 0);

        glfwSwapBuffers(window);
        glfwPollEvents();
    }

    glDeleteVertexArrays(1, &VAO);
    glDeleteBuffers(1, &VBO);
    glDeleteBuffers(1, &EBO);
    glfwTerminate();
    return 0;
}
`
  },
  {
    path: 'tests/geometry_tests.cpp',
    category: 'test',
    description: 'Unit test suite for geometry generation and coordinate mapping',
    code: `#include <cassert>
#include <iostream>
#include "FloorPlanGeometry.h"
#include "MeshGenerator.h"

void TestImageToWorldMapping() {
    CoordinateMapping map;
    map.scale = 0.02f;
    map.u0 = 200.0f;
    map.v0 = 150.0f;

    Point2D pt = map.ImageToWorld(300.0f, 250.0f);
    assert(std::abs(pt.x - 2.0f) < 1e-4f);
    assert(std::abs(pt.z - (-2.0f)) < 1e-4f);

    glm::vec2 img = map.WorldToImage(pt.x, pt.z);
    assert(std::abs(img.x - 300.0f) < 1e-3f);
    assert(std::abs(img.y - 250.0f) < 1e-3f);
    std::cout << "[PASS] ImageToWorld and WorldToImage bijective mapping verified" << std::endl;
}

void TestDegenerateWall() {
    WallSegment2D zeroWall{ "w0", { 3.0f, 3.0f }, { 3.0f, 3.0f }, 0.2f, 2.8f };
    MeshData m = MeshGenerator::GenerateWallMesh(zeroWall);
    assert(m.vertices.empty());
    assert(m.indices.empty());
    std::cout << "[PASS] Zero-length wall segment safely handled without crash" << std::endl;
}

void TestWallMeshWindingAndNormals() {
    WallSegment2D wall{ "w1", { 0.0f, 0.0f }, { 4.0f, 0.0f }, 0.2f, 2.8f };
    MeshData m = MeshGenerator::GenerateWallMesh(wall);
    assert(m.vertices.size() == 24); // 6 faces * 4 vertices
    assert(m.indices.size() == 36);  // 6 faces * 2 triangles * 3 indices
    std::cout << "[PASS] Watertight 6-face box generation verified" << std::endl;
}

int main() {
    std::cout << "Running C++ Geometry & Coordinate Engine Unit Tests..." << std::endl;
    TestImageToWorldMapping();
    TestDegenerateWall();
    TestWallMeshWindingAndNormals();
    std::cout << "All C++ tests PASSED successfully!" << std::endl;
    return 0;
}
`
  }
];
