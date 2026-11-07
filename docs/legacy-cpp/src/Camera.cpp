#include "Camera.h"
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
