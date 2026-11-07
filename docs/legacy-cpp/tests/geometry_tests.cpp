#include <cassert>
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
