#pragma once

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
