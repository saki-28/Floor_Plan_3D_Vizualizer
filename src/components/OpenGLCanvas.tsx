import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  FloorPlanDataset,
  WallSegment2D,
  Point2D,
} from '../types/floorplan';
import {
  extrudeWallSegment,
  generateFloorMesh,
  combineMeshes,
  Mesh3D,
  mat4Identity,
  mat4Multiply,
  mat4Perspective,
  mat4Orthographic,
  mat4LookAt,
  screenToFloorRay,
  worldToScreen,
  snapToFloorGeometry,
  distance2D,
  Mat4,
} from '../utils/geometryEngine';
import {
  Eye,
  Maximize2,
  Box,
  Layers,
  Compass,
  RotateCcw,
  Sun,
  Grid,
  Ruler,
  Crosshair,
  Trash2,
  Copy,
  Check,
  CheckCircle2,
  Magnet,
} from 'lucide-react';

interface OpenGLCanvasProps {
  floorplan: FloorPlanDataset;
  walls: WallSegment2D[];
  wallHeight: number;
  wallThickness: number;
  showFurniture: boolean;
  selectedWallId: string | null;
  onSelectWall: (wallId: string | null) => void;
}

export type RenderStyle = 'architectural' | 'blueprint' | 'clay';
export type ViewPreset = 'perspective' | 'top' | 'front' | 'side' | 'isometric';

export const OpenGLCanvas: React.FC<OpenGLCanvasProps> = ({
  floorplan,
  walls,
  wallHeight,
  wallThickness,
  showFurniture,
  selectedWallId,
  onSelectWall,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isOrthographic, setIsOrthographic] = useState(false);
  const [isWireframe, setIsWireframe] = useState(false);
  const [renderMode, setRenderMode] = useState<'shaded' | 'normals' | 'depth'>('shaded');
  const [renderStyle, setRenderStyle] = useState<RenderStyle>('architectural');

  // Camera state
  const [cameraRadius, setCameraRadius] = useState(16.0);
  const [cameraYaw, setCameraYaw] = useState(-45.0);
  const [cameraPitch, setCameraPitch] = useState(35.0);
  const [cameraTarget, setCameraTarget] = useState<[number, number, number]>([0, 0, 0]);

  // Mouse interaction state
  const isDraggingRef = useRef(false);
  const isPanningRef = useRef(false);
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const mouseDownPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Measurement Tool State
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [snapToCorners, setSnapToCorners] = useState(true);
  const [measurePointA, setMeasurePointA] = useState<Point2D | null>(null);
  const [measurePointB, setMeasurePointB] = useState<Point2D | null>(null);
  const [hoverFloorPoint, setHoverFloorPoint] = useState<Point2D | null>(null);
  const [isHoverSnapped, setIsHoverSnapped] = useState(false);
  const [copiedDistance, setCopiedDistance] = useState(false);

  // Store active camera matrices for live 3D-to-2D screen projection of measurement overlay
  const cameraMatsRef = useRef<{ viewMat: Mat4; projMat: Mat4 } | null>(null);
  const [screenOverlayCoords, setScreenOverlayCoords] = useState<{
    screenA: [number, number] | null;
    screenB: [number, number] | null;
    screenHover: [number, number] | null;
  }>({ screenA: null, screenB: null, screenHover: null });

  // WebGL context and program refs
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const wallBufferRef = useRef<{ vao: WebGLBuffer | null; count: number }>({ vao: null, count: 0 });
  const floorBufferRef = useRef<{ vao: WebGLBuffer | null; count: number }>({ vao: null, count: 0 });
  const furnitureBufferRef = useRef<{ vao: WebGLBuffer | null; count: number }>({ vao: null, count: 0 });

  const [stats, setStats] = useState({ vertices: 0, triangles: 0, fps: 60 });
  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(performance.now());

  // Shaders (matching assets/shaders/vertex.glsl and fragment.glsl in C++)
  const VS_SOURCE = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec2 aTexCoord;

    uniform mat4 uModel;
    uniform mat4 uView;
    uniform mat4 uProjection;

    varying vec3 vFragPos;
    varying vec3 vNormal;
    varying vec2 vTexCoord;

    void main() {
      vFragPos = vec3(uModel * vec4(aPosition, 1.0));
      vNormal = mat3(uModel) * aNormal;
      vTexCoord = aTexCoord;
      gl_Position = uProjection * uView * vec4(vFragPos, 1.0);
    }
  `;

  const FS_SOURCE = `
    precision mediump float;

    varying vec3 vFragPos;
    varying vec3 vNormal;
    varying vec2 vTexCoord;

    uniform vec3 uColor;
    uniform vec3 uLightDir;
    uniform vec3 uViewPos;
    uniform int uRenderMode; // 0=Shaded, 1=Normals, 2=Depth
    uniform int uIsWireframe;

    void main() {
      if (uRenderMode == 1) {
        vec3 nColor = normalize(vNormal) * 0.5 + 0.5;
        gl_FragColor = vec4(nColor, 1.0);
        return;
      }

      if (uRenderMode == 2) {
        float depth = gl_FragCoord.z;
        gl_FragColor = vec4(vec3(depth), 1.0);
        return;
      }

      vec3 norm = normalize(vNormal);
      vec3 lightDir = normalize(-uLightDir);
      vec3 viewDir = normalize(uViewPos - vFragPos);
      vec3 halfDir = normalize(lightDir + viewDir);

      // Ambient
      vec3 ambient = 0.35 * uColor;

      // Diffuse Lambert
      float diff = max(dot(norm, lightDir), 0.0);
      vec3 diffuse = diff * uColor * 0.75;

      // Specular Blinn-Phong
      float spec = pow(max(dot(norm, halfDir), 0.0), 24.0);
      vec3 specular = vec3(0.25) * spec;

      vec3 result = ambient + diffuse + specular;

      if (uIsWireframe == 1) {
        // Blueprint wireframe glow
        result = mix(result, vec3(0.2, 0.9, 1.0), 0.7);
      }

      gl_FragColor = vec4(result, 1.0);
    }
  `;

  // Initialize WebGL
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', { antialias: true, depth: true });
    if (!gl) {
      console.error('WebGL not supported');
      return;
    }
    glRef.current = gl;

    // Compile shaders
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, VS_SOURCE);
    gl.compileShader(vs);

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, FS_SOURCE);
    gl.compileShader(fs);

    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Shader program linking failed:', gl.getProgramInfoLog(program));
      return;
    }

    programRef.current = program;

    // Enable Depth Testing and Backface Culling
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    return () => {
      if (gl) {
        gl.deleteProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
      }
    };
  }, []);

  // Update Meshes and Buffers whenever walls or parameters change
  useEffect(() => {
    const gl = glRef.current;
    if (!gl) return;

    // Extrude walls with current height and thickness
    const wallMeshes: Mesh3D[] = walls.map((w) =>
      extrudeWallSegment({
        ...w,
        height: wallHeight,
        thickness: wallThickness,
      })
    );
    const combinedWalls = combineMeshes(wallMeshes);

    // Floor meshes
    const floorMeshes = floorplan.rooms.map((r) => generateFloorMesh(r.corners));
    const combinedFloors = combineMeshes(floorMeshes);

    // Helper to upload mesh to WebGL buffer
    const createGLMeshBuffer = (mesh: Mesh3D) => {
      if (mesh.indices.length === 0) return { vao: null, count: 0 };

      // Flatten vertices into interleaved [px, py, pz, nx, ny, nz, u, v]
      const flattened: number[] = [];
      for (const idx of mesh.indices) {
        const v = mesh.vertices[idx];
        flattened.push(
          v.position[0], v.position[1], v.position[2],
          v.normal[0], v.normal[1], v.normal[2],
          v.texCoord[0], v.texCoord[1]
        );
      }

      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(flattened), gl.STATIC_DRAW);

      return { vao: buffer, count: mesh.indices.length };
    };

    wallBufferRef.current = createGLMeshBuffer(combinedWalls);
    floorBufferRef.current = createGLMeshBuffer(combinedFloors);

    // Furniture representation
    if (showFurniture && floorplan.furniture.length > 0) {
      const furnMeshes: Mesh3D[] = [];
      for (const f of floorplan.furniture) {
        // Generate box for each furniture item
        const [w, h, d] = f.size;
        const [fx, fy, fz] = f.position;
        const boxWall: WallSegment2D = {
          id: f.id,
          start: { x: fx - w / 2, z: fz },
          end: { x: fx + w / 2, z: fz },
          thickness: d,
          height: h,
        };
        furnMeshes.push(extrudeWallSegment(boxWall));
      }
      furnitureBufferRef.current = createGLMeshBuffer(combineMeshes(furnMeshes));
    } else {
      furnitureBufferRef.current = { vao: null, count: 0 };
    }

    setStats({
      vertices: combinedWalls.vertices.length + combinedFloors.vertices.length,
      triangles: (combinedWalls.indices.length + combinedFloors.indices.length) / 3,
      fps: 60,
    });
  }, [walls, floorplan, wallHeight, wallThickness, showFurniture]);

  // Render loop
  const renderScene = useCallback(() => {
    const gl = glRef.current;
    const program = programRef.current;
    const canvas = canvasRef.current;
    if (!gl || !program || !canvas) return;

    // Viewport and clear
    gl.viewport(0, 0, canvas.width, canvas.height);

    // Clear color based on style
    if (renderStyle === 'blueprint') {
      gl.clearColor(0.04, 0.09, 0.18, 1.0);
    } else if (renderStyle === 'clay') {
      gl.clearColor(0.92, 0.93, 0.95, 1.0);
    } else {
      gl.clearColor(0.09, 0.11, 0.15, 1.0);
    }
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(program);

    // Calculate Camera Position from spherical coordinates
    const pitchRad = (cameraPitch * Math.PI) / 180.0;
    const yawRad = (cameraYaw * Math.PI) / 180.0;

    const eyeX = cameraTarget[0] + cameraRadius * Math.cos(pitchRad) * Math.cos(yawRad);
    const eyeY = cameraTarget[1] + cameraRadius * Math.sin(pitchRad);
    const eyeZ = cameraTarget[2] + cameraRadius * Math.cos(pitchRad) * Math.sin(yawRad);

    const aspect = canvas.width / canvas.height;

    // View matrix (LookAt)
    const viewMat = mat4LookAt(
      eyeX, eyeY, eyeZ,
      cameraTarget[0], cameraTarget[1], cameraTarget[2],
      0, 1, 0
    );

    // Projection matrix (Perspective or Orthographic)
    const projMat = isOrthographic
      ? mat4Orthographic(-cameraRadius * 0.45 * aspect, cameraRadius * 0.45 * aspect, -cameraRadius * 0.45, cameraRadius * 0.45, 0.1, 100.0)
      : mat4Perspective((45 * Math.PI) / 180.0, aspect, 0.1, 100.0);

    // Store active matrices for live screen projection
    cameraMatsRef.current = { viewMat, projMat };

    const container = containerRef.current;
    if (container) {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const sA = measurePointA ? worldToScreen([measurePointA.x, 0.05, measurePointA.z], viewMat, projMat, cw, ch) : null;
      const targetB = measurePointB || (isMeasuring && measurePointA ? hoverFloorPoint : null);
      const sB = targetB ? worldToScreen([targetB.x, 0.05, targetB.z], viewMat, projMat, cw, ch) : null;
      const sHover = hoverFloorPoint ? worldToScreen([hoverFloorPoint.x, 0.05, hoverFloorPoint.z], viewMat, projMat, cw, ch) : null;
      setScreenOverlayCoords({ screenA: sA, screenB: sB, screenHover: sHover });
    }

    const modelMat = mat4Identity();

    // Set uniform matrices
    const uModelLoc = gl.getUniformLocation(program, 'uModel');
    const uViewLoc = gl.getUniformLocation(program, 'uView');
    const uProjLoc = gl.getUniformLocation(program, 'uProjection');
    const uColorLoc = gl.getUniformLocation(program, 'uColor');
    const uLightDirLoc = gl.getUniformLocation(program, 'uLightDir');
    const uViewPosLoc = gl.getUniformLocation(program, 'uViewPos');
    const uRenderModeLoc = gl.getUniformLocation(program, 'uRenderMode');
    const uIsWireframeLoc = gl.getUniformLocation(program, 'uIsWireframe');

    gl.uniformMatrix4fv(uModelLoc, false, new Float32Array(modelMat));
    gl.uniformMatrix4fv(uViewLoc, false, new Float32Array(viewMat));
    gl.uniformMatrix4fv(uProjLoc, false, new Float32Array(projMat));

    // Directional sunlight coming from upper left
    gl.uniform3f(uLightDirLoc, -0.6, -1.0, -0.5);
    gl.uniform3f(uViewPosLoc, eyeX, eyeY, eyeZ);

    const rModeInt = renderMode === 'shaded' ? 0 : renderMode === 'normals' ? 1 : 2;
    gl.uniform1i(uRenderModeLoc, rModeInt);
    gl.uniform1i(uIsWireframeLoc, isWireframe ? 1 : 0);

    const aPosLoc = gl.getAttribLocation(program, 'aPosition');
    const aNormLoc = gl.getAttribLocation(program, 'aNormal');
    const aTexLoc = gl.getAttribLocation(program, 'aTexCoord');

    const drawBuffer = (buffer: { vao: WebGLBuffer | null; count: number }, color: [number, number, number]) => {
      if (!buffer.vao || buffer.count === 0) return;

      gl.bindBuffer(gl.ARRAY_BUFFER, buffer.vao);
      gl.uniform3f(uColorLoc, color[0], color[1], color[2]);

      const stride = 8 * 4; // 8 floats per vertex * 4 bytes
      gl.vertexAttribPointer(aPosLoc, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(aPosLoc);

      gl.vertexAttribPointer(aNormLoc, 3, gl.FLOAT, false, stride, 3 * 4);
      gl.enableVertexAttribArray(aNormLoc);

      gl.vertexAttribPointer(aTexLoc, 2, gl.FLOAT, false, stride, 6 * 4);
      gl.enableVertexAttribArray(aTexLoc);

      if (isWireframe) {
        // Simulate wireframe via LINE_LOOP / LINES on modern WebGL
        gl.drawArrays(gl.LINE_STRIP, 0, buffer.count);
      } else {
        gl.drawArrays(gl.TRIANGLES, 0, buffer.count);
      }
    };

    // Color schemes based on style
    let wallColor: [number, number, number] = [0.88, 0.89, 0.92];
    let floorColor: [number, number, number] = [0.28, 0.32, 0.38];
    let furnColor: [number, number, number] = [0.45, 0.55, 0.70];

    if (renderStyle === 'blueprint') {
      wallColor = [0.15, 0.45, 0.85];
      floorColor = [0.08, 0.20, 0.40];
      furnColor = [0.25, 0.60, 0.95];
    } else if (renderStyle === 'clay') {
      wallColor = [0.96, 0.96, 0.96];
      floorColor = [0.80, 0.80, 0.80];
      furnColor = [0.88, 0.88, 0.88];
    }

    // 1. Draw Floor
    drawBuffer(floorBufferRef.current, floorColor);

    // 2. Draw Walls
    drawBuffer(wallBufferRef.current, wallColor);

    // 3. Draw Furniture if enabled
    if (showFurniture) {
      drawBuffer(furnitureBufferRef.current, furnColor);
    }

    // Measure FPS
    frameCountRef.current++;
    const now = performance.now();
    const elapsed = now - lastFpsTimeRef.current;
    if (elapsed >= 1000) {
      const measured = Math.round((frameCountRef.current * 1000) / elapsed);
      setStats((prev) => ({
        ...prev,
        fps: Number.isFinite(measured) && measured > 0 ? measured : 60,
      }));
      frameCountRef.current = 0;
      lastFpsTimeRef.current = now;
    }
  }, [
    cameraRadius,
    cameraYaw,
    cameraPitch,
    cameraTarget,
    isOrthographic,
    isWireframe,
    renderMode,
    renderStyle,
    showFurniture,
    measurePointA,
    measurePointB,
    hoverFloorPoint,
    isMeasuring,
  ]);

  // Animation frame request loop
  useEffect(() => {
    let animId: number;
    const loop = () => {
      renderScene();
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [renderScene]);

  // Resize canvas according to display resolution
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Preset view setting
  const applyViewPreset = (preset: ViewPreset) => {
    switch (preset) {
      case 'perspective':
        setIsOrthographic(false);
        setCameraYaw(-45);
        setCameraPitch(35);
        setCameraRadius(18);
        setCameraTarget([0, 0, 0]);
        break;
      case 'top':
        setIsOrthographic(true);
        setCameraYaw(-90);
        setCameraPitch(89);
        setCameraRadius(22);
        setCameraTarget([0, 0, 0]);
        break;
      case 'front':
        setIsOrthographic(true);
        setCameraYaw(-90);
        setCameraPitch(5);
        setCameraRadius(20);
        setCameraTarget([0, wallHeight / 2, 0]);
        break;
      case 'side':
        setIsOrthographic(true);
        setCameraYaw(0);
        setCameraPitch(5);
        setCameraRadius(20);
        setCameraTarget([0, wallHeight / 2, 0]);
        break;
      case 'isometric':
        setIsOrthographic(true);
        setCameraYaw(-45);
        setCameraPitch(35.264);
        setCameraRadius(22);
        setCameraTarget([0, 0, 0]);
        break;
    }
  };

  // Snapping candidates from all walls and room corners
  const snappingCandidates = useMemo<Point2D[]>(() => {
    const pts: Point2D[] = [];
    for (const w of walls) {
      pts.push(w.start);
      pts.push(w.end);
      if (w.hasDoor && w.doorPosition !== undefined) {
        const dx = w.end.x - w.start.x;
        const dz = w.end.z - w.start.z;
        pts.push({ x: w.start.x + dx * w.doorPosition, z: w.start.z + dz * w.doorPosition });
      }
    }
    for (const r of floorplan.rooms) {
      for (const c of r.corners) {
        pts.push(c);
      }
    }
    return pts;
  }, [walls, floorplan.rooms]);

  // Active measurement values
  const activeMeasureTarget = measurePointB || (measurePointA ? hoverFloorPoint : null);
  const measuredDistanceMeters =
    measurePointA && activeMeasureTarget ? distance2D(measurePointA, activeMeasureTarget) : 0;
  const measuredDistanceFeet = measuredDistanceMeters * 3.28084;
  const deltaX =
    measurePointA && activeMeasureTarget ? Math.abs(activeMeasureTarget.x - measurePointA.x) : 0;
  const deltaZ =
    measurePointA && activeMeasureTarget ? Math.abs(activeMeasureTarget.z - measurePointA.z) : 0;

  // Keyboard shortcut listener for measurement tool (M) and clear (Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'm' || e.key === 'M') {
        setIsMeasuring((prev) => !prev);
      } else if (e.key === 'Escape') {
        if (measurePointB) {
          setMeasurePointB(null);
        } else if (measurePointA) {
          setMeasurePointA(null);
        } else if (isMeasuring) {
          setIsMeasuring(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [measurePointA, measurePointB, isMeasuring]);

  const handleCopyDistance = () => {
    if (!measurePointA || !activeMeasureTarget) return;
    navigator.clipboard.writeText(`${measuredDistanceMeters.toFixed(2)} m`);
    setCopiedDistance(true);
    setTimeout(() => setCopiedDistance(false), 2000);
  };

  const handleClearMeasurement = () => {
    setMeasurePointA(null);
    setMeasurePointB(null);
    setHoverFloorPoint(null);
  };

  // Mouse handlers for Orbit, Pan, and Measurement
  const handleMouseDown = (e: React.MouseEvent) => {
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };

    if (e.button === 2 || e.shiftKey) {
      // Right-click or Shift-drag: Pan camera
      isDraggingRef.current = true;
      isPanningRef.current = true;
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (isMeasuring && e.button === 0) {
      // In measurement mode, left click places measurement points on mouseUp
      return;
    }

    isDraggingRef.current = true;
    isPanningRef.current = false;
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const container = containerRef.current;
    if (container && cameraMatsRef.current && isMeasuring) {
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const rawFloor = screenToFloorRay(
        mouseX,
        mouseY,
        rect.width,
        rect.height,
        cameraMatsRef.current.viewMat,
        cameraMatsRef.current.projMat
      );

      if (rawFloor) {
        if (snapToCorners) {
          const snapped = snapToFloorGeometry(rawFloor, snappingCandidates, 0.45);
          setHoverFloorPoint(snapped.point);
          setIsHoverSnapped(snapped.snapped);
        } else {
          setHoverFloorPoint(rawFloor);
          setIsHoverSnapped(false);
        }
      }
    }

    if (!isDraggingRef.current) return;

    const dx = e.clientX - lastMousePosRef.current.x;
    const dy = e.clientY - lastMousePosRef.current.y;
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };

    if (isPanningRef.current) {
      // Pan camera target
      const panFactor = 0.015 * (cameraRadius / 15.0);
      const yawRad = (cameraYaw * Math.PI) / 180.0;
      const rightX = -Math.sin(yawRad);
      const rightZ = Math.cos(yawRad);

      setCameraTarget((prev) => [
        prev[0] - rightX * dx * panFactor,
        prev[1] + dy * panFactor,
        prev[2] - rightZ * dx * panFactor,
      ]);
    } else {
      // Orbit camera
      setCameraYaw((prev) => prev + dx * 0.4);
      setCameraPitch((prev) => Math.max(5, Math.min(89, prev - dy * 0.4)));
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    const moveDist = Math.hypot(
      e.clientX - mouseDownPosRef.current.x,
      e.clientY - mouseDownPosRef.current.y
    );

    // Left click with minimal movement places measurement points
    if (isMeasuring && moveDist < 6 && e.button === 0 && hoverFloorPoint) {
      if (!measurePointA) {
        setMeasurePointA(hoverFloorPoint);
        setMeasurePointB(null);
      } else if (!measurePointB) {
        setMeasurePointB(hoverFloorPoint);
      } else {
        // Third click starts new measurement from this point
        setMeasurePointA(hoverFloorPoint);
        setMeasurePointB(null);
      }
    }

    isDraggingRef.current = false;
    isPanningRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setCameraRadius((prev) => Math.max(3.0, Math.min(45.0, prev + e.deltaY * 0.02)));
  };

  // Screen coordinates for overlay
  const { screenA, screenB, screenHover } = screenOverlayCoords;
  const targetScreen = screenB || (isMeasuring && screenA ? screenHover : null);

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full bg-slate-950 flex flex-col select-none overflow-hidden rounded-xl border border-slate-800 shadow-2xl ${
        isMeasuring ? 'cursor-crosshair' : ''
      }`}
    >
      {/* Top Toolbar */}
      <div className="absolute top-3 left-3 right-3 z-10 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        {/* View Presets */}
        <div className="flex items-center gap-1 bg-slate-900/90 backdrop-blur-md p-1.5 rounded-lg border border-slate-700/80 shadow-lg pointer-events-auto">
          <span className="text-xs font-semibold text-slate-400 px-2 flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-blue-400" /> Camera:
          </span>
          <button
            onClick={() => applyViewPreset('perspective')}
            className="px-2.5 py-1 text-xs font-medium rounded-md text-slate-200 hover:bg-slate-800 hover:text-white transition"
          >
            3D Orbit
          </button>
          <button
            onClick={() => applyViewPreset('top')}
            className="px-2.5 py-1 text-xs font-medium rounded-md text-slate-200 hover:bg-slate-800 hover:text-white transition"
          >
            Plan (Top)
          </button>
          <button
            onClick={() => applyViewPreset('isometric')}
            className="px-2.5 py-1 text-xs font-medium rounded-md text-slate-200 hover:bg-slate-800 hover:text-white transition"
          >
            Isometric 45°
          </button>
          <button
            onClick={() => applyViewPreset('front')}
            className="px-2.5 py-1 text-xs font-medium rounded-md text-slate-200 hover:bg-slate-800 hover:text-white transition"
          >
            Elevation
          </button>
        </div>

        {/* Shading, Projection & Measurement Toggles */}
        <div className="flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-md p-1.5 rounded-lg border border-slate-700/80 shadow-lg pointer-events-auto">
          {/* Measurement Overlay Tool Button */}
          <button
            onClick={() => {
              setIsMeasuring(!isMeasuring);
              if (!isMeasuring && !measurePointA) {
                // activate
              }
            }}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition flex items-center gap-1.5 ${
              isMeasuring
                ? 'bg-emerald-600 text-white font-semibold ring-2 ring-emerald-400/50 shadow-md'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
            title="Measure real-world distance between two points on the floorplan (Shortcut: M)"
          >
            <Ruler className="w-3.5 h-3.5 text-emerald-300" />
            <span>Measure Tool</span>
            <kbd className="text-[10px] bg-slate-800 px-1 py-0.2 rounded border border-slate-700 font-mono">M</kbd>
          </button>

          {isMeasuring && (
            <button
              onClick={() => setSnapToCorners(!snapToCorners)}
              className={`px-2 py-1 text-xs font-medium rounded-md transition flex items-center gap-1 ${
                snapToCorners
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
              title="Magnetic snap to nearest wall corner or opening"
            >
              <Magnet className="w-3.5 h-3.5" />
              <span>Snap</span>
            </button>
          )}

          <div className="w-[1px] h-4 bg-slate-700 mx-0.5" />

          <button
            onClick={() => setIsOrthographic(!isOrthographic)}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition flex items-center gap-1 ${
              isOrthographic
                ? 'bg-blue-600 text-white font-semibold shadow-inner'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
            title="Toggle between Perspective and Orthographic projection matrix"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            {isOrthographic ? 'Ortho (P)' : 'Perspective'}
          </button>

          <button
            onClick={() => setIsWireframe(!isWireframe)}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition flex items-center gap-1 ${
              isWireframe
                ? 'bg-amber-600 text-white font-semibold'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
            title="Toggle wireframe triangle mesh visualization"
          >
            <Grid className="w-3.5 h-3.5" />
            Wireframe
          </button>

          {/* Render Mode */}
          <select
            value={renderMode}
            onChange={(e) => setRenderMode(e.target.value as any)}
            className="bg-slate-800 text-slate-200 text-xs rounded-md px-2 py-1 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
          >
            <option value="shaded">Phong Shaded</option>
            <option value="normals">Normal Vectors [RGB]</option>
            <option value="depth">Z-Buffer Depth</option>
          </select>

          {/* Style Theme */}
          <select
            value={renderStyle}
            onChange={(e) => setRenderStyle(e.target.value as any)}
            className="bg-slate-800 text-slate-200 text-xs rounded-md px-2 py-1 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
          >
            <option value="architectural">Architectural Plaster</option>
            <option value="blueprint">Cyan Blueprint</option>
            <option value="clay">Clay Model</option>
          </select>

          <button
            onClick={() => applyViewPreset('perspective')}
            className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition"
            title="Reset Camera"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Measurement Mode Context Banner */}
      {isMeasuring && (
        <div className="absolute top-16 left-3 right-3 z-10 flex items-center justify-between pointer-events-none">
          <div className="bg-slate-900/95 backdrop-blur-md px-3.5 py-2 rounded-lg border border-emerald-500/40 shadow-xl flex items-center gap-3 text-xs text-slate-200 pointer-events-auto animate-in fade-in duration-150">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <div className="flex items-center gap-2">
              <span className="font-semibold text-emerald-400">Ruler Mode:</span>
              {!measurePointA ? (
                <span className="text-slate-300">Click first point on the floorplan (e.g. wall corner or doorway)</span>
              ) : !measurePointB ? (
                <span className="text-slate-300">Click second point to finish measurement (or press Esc to clear)</span>
              ) : (
                <span className="text-emerald-300 font-medium">Measurement Locked ({measuredDistanceMeters.toFixed(2)} m) — Click anywhere to measure new span</span>
              )}
            </div>

            {measurePointA && (
              <div className="flex items-center gap-2 border-l border-slate-700 pl-3">
                <span className="font-mono text-xs font-bold text-emerald-400">
                  {measuredDistanceMeters.toFixed(2)} m
                </span>
                <span className="text-[11px] text-slate-400 font-mono">
                  ({measuredDistanceFeet.toFixed(2)} ft)
                </span>
                <button
                  onClick={handleCopyDistance}
                  className="p-1 hover:bg-slate-800 text-slate-400 hover:text-white rounded transition"
                  title="Copy distance to clipboard"
                >
                  {copiedDistance ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={handleClearMeasurement}
                  className="p-1 hover:bg-slate-800 text-red-400 hover:text-red-300 rounded transition"
                  title="Clear measurement"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* WebGL Canvas Element */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={handleWheel}
        className="w-full h-full block"
      />

      {/* SVG Measurement Overlay Projected onto 3D Scene */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible">
        <defs>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Dynamic Measurement Line between Point A and Point B / Hover Point */}
        {screenA && targetScreen && (
          <g>
            {/* Background shadow stroke for contrast */}
            <line
              x1={screenA[0]}
              y1={screenA[1]}
              x2={targetScreen[0]}
              y2={targetScreen[1]}
              stroke="#0f172a"
              strokeWidth="5"
              strokeLinecap="round"
            />
            {/* Glowing architectural dimension line */}
            <line
              x1={screenA[0]}
              y1={screenA[1]}
              x2={targetScreen[0]}
              y2={targetScreen[1]}
              stroke="#10b981"
              strokeWidth="2.5"
              strokeDasharray={measurePointB ? 'none' : '6,4'}
              filter="url(#glow)"
            />

            {/* Perpendicular tick marks at endpoints */}
            {(() => {
              const dx = targetScreen[0] - screenA[0];
              const dy = targetScreen[1] - screenA[1];
              const len = Math.hypot(dx, dy);
              if (len > 8) {
                const nx = (-dy / len) * 8;
                const ny = (dx / len) * 8;
                return (
                  <>
                    <line
                      x1={screenA[0] - nx}
                      y1={screenA[1] - ny}
                      x2={screenA[0] + nx}
                      y2={screenA[1] + ny}
                      stroke="#10b981"
                      strokeWidth="2.5"
                    />
                    <line
                      x1={targetScreen[0] - nx}
                      y1={targetScreen[1] - ny}
                      x2={targetScreen[0] + nx}
                      y2={targetScreen[1] + ny}
                      stroke="#10b981"
                      strokeWidth="2.5"
                    />
                  </>
                );
              }
              return null;
            })()}

            {/* Floating Distance Badge placed at line midpoint */}
            {(() => {
              const midX = (screenA[0] + targetScreen[0]) / 2;
              const midY = (screenA[1] + targetScreen[1]) / 2;
              return (
                <foreignObject
                  x={midX - 90}
                  y={midY - 32}
                  width="180"
                  height="64"
                  className="overflow-visible pointer-events-none select-none"
                >
                  <div className="flex flex-col items-center">
                    <div className="bg-slate-900/95 backdrop-blur-md px-2.5 py-1 rounded-md border border-emerald-500 shadow-xl flex items-center gap-1.5 text-center">
                      <Ruler className="w-3 h-3 text-emerald-400" />
                      <span className="font-mono text-xs font-bold text-emerald-300">
                        {measuredDistanceMeters.toFixed(2)} m
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        ({measuredDistanceFeet.toFixed(2)} ft)
                      </span>
                    </div>
                    <div className="text-[9px] font-mono text-slate-300 bg-slate-950/90 px-2 py-0.5 rounded border border-slate-800 shadow mt-0.5">
                      ΔX: {deltaX.toFixed(2)}m · ΔZ: {deltaZ.toFixed(2)}m
                    </div>
                  </div>
                </foreignObject>
              );
            })()}
          </g>
        )}

        {/* Start Point Marker A */}
        {screenA && (
          <g>
            <circle cx={screenA[0]} cy={screenA[1]} r="7" fill="#10b981" fillOpacity="0.3" filter="url(#glow)" />
            <circle cx={screenA[0]} cy={screenA[1]} r="4.5" fill="#10b981" stroke="#ffffff" strokeWidth="1.5" />
            <text
              x={screenA[0] + 8}
              y={screenA[1] - 8}
              fill="#10b981"
              fontSize="10"
              fontWeight="bold"
              fontFamily="monospace"
            >
              P1 ({measurePointA?.x.toFixed(1)}m, {measurePointA?.z.toFixed(1)}m)
            </text>
          </g>
        )}

        {/* End Point Marker B */}
        {screenB && measurePointB && (
          <g>
            <circle cx={screenB[0]} cy={screenB[1]} r="7" fill="#3b82f6" fillOpacity="0.3" filter="url(#glow)" />
            <circle cx={screenB[0]} cy={screenB[1]} r="4.5" fill="#3b82f6" stroke="#ffffff" strokeWidth="1.5" />
            <text
              x={screenB[0] + 8}
              y={screenB[1] - 8}
              fill="#60a5fa"
              fontSize="10"
              fontWeight="bold"
              fontFamily="monospace"
            >
              P2 ({measurePointB.x.toFixed(1)}m, {measurePointB.z.toFixed(1)}m)
            </text>
          </g>
        )}

        {/* Hover / Snap Reticle indicator */}
        {isMeasuring && screenHover && !measurePointB && (
          <g>
            <circle
              cx={screenHover[0]}
              cy={screenHover[1]}
              r={isHoverSnapped ? '9' : '5'}
              fill="none"
              stroke={isHoverSnapped ? '#10b981' : '#38bdf8'}
              strokeWidth="2"
              strokeDasharray={isHoverSnapped ? 'none' : '3,3'}
            />
            {isHoverSnapped && (
              <>
                <circle cx={screenHover[0]} cy={screenHover[1]} r="3" fill="#10b981" />
                <text
                  x={screenHover[0] + 12}
                  y={screenHover[1] + 4}
                  fill="#34d399"
                  fontSize="10"
                  fontFamily="sans-serif"
                  fontWeight="bold"
                >
                  Corner Snap
                </text>
              </>
            )}
          </g>
        )}
      </svg>

      {/* Bottom HUD: OpenGL Pipeline Diagnostics */}
      <div className="absolute bottom-3 left-3 right-3 z-10 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-800 text-xs text-slate-300 flex items-center gap-4 shadow-lg pointer-events-auto">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-semibold text-slate-200">OpenGL 3.3 Core Pipeline</span>
          </div>
          <div className="text-slate-400">
            Vertices: <span className="font-mono text-emerald-400 font-semibold">{stats.vertices}</span>
          </div>
          <div className="text-slate-400">
            Triangles: <span className="font-mono text-blue-400 font-semibold">{stats.triangles}</span>
          </div>
          <div className="text-slate-400">
            FPS: <span className="font-mono text-amber-400 font-semibold">{Number.isFinite(stats.fps) && stats.fps > 0 ? stats.fps : 60}</span>
          </div>
        </div>

        <div className="bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-800 text-[11px] text-slate-400 flex items-center gap-3 shadow-lg pointer-events-auto">
          {isMeasuring ? (
            <>
              <span className="text-emerald-400 font-medium">Click 2 floor points to measure distance</span>
              <span><kbd className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-300 border border-slate-700">Esc</kbd> Clear</span>
              <span><kbd className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-300 border border-slate-700">Right-Drag</kbd> Pan</span>
            </>
          ) : (
            <>
              <span><kbd className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-300 border border-slate-700">M</kbd> Ruler</span>
              <span><kbd className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-300 border border-slate-700">Left-Drag</kbd> Orbit</span>
              <span><kbd className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-300 border border-slate-700">Right-Drag</kbd> Pan</span>
              <span><kbd className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-300 border border-slate-700">Scroll</kbd> Zoom</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

