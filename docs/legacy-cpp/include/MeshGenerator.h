#pragma once

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
