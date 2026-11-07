#include "MeshGenerator.h"
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
