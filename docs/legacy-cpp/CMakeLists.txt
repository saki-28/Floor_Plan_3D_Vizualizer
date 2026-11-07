cmake_minimum_required(VERSION 3.20)
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
    ${OPENGL_INCLUDE_DIR}
    ${OpenCV_INCLUDE_DIRS}
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
add_executable(FloorPlan3D ${SOURCES})

target_link_libraries(FloorPlan3D PRIVATE
    OpenGL::GL
    glfw
    glm::glm
    ${OpenCV_LIBS}
)

# Copy shaders and sample floorplans to binary directory
add_custom_command(TARGET FloorPlan3D POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_directory
    ${CMAKE_SOURCE_DIR}/assets ${CMAKE_CURRENT_BINARY_DIR}/assets
)

# Unit test executable for Milestone 1 geometry & transformations
enable_testing()
add_executable(geometry_tests tests/geometry_tests.cpp src/FloorPlanGeometry.cpp src/MeshGenerator.cpp)
target_link_libraries(geometry_tests PRIVATE glm::glm)
add_test(NAME GeometryUnitTests COMMAND geometry_tests)
