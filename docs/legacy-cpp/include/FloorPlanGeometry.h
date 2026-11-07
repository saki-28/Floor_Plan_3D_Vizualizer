#pragma once

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
