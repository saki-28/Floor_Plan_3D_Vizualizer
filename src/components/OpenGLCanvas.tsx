import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  FloorPlanDataset,
  WallSegment2D,
  Point2D,
} from '../types/floorplan';
import {
  extrudeWallSegment,
  extrudeWallWithOpenings,
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
  downloadOBJ,
  Mat4,
} from '../utils/geometryEngine';
import { Check, Copy, Download, House, Maximize, Pause, Play, RotateCcw, RotateCw, Ruler, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import type { Theme } from '../theme';
import { planLabel } from '../utils/planLabel';
import { openingsOnWall, wallCuts } from '../utils/openings';
import { PlanThumbnail } from './PlanThumbnail';
import { Button, KeyValue, SectionTitle, Segmented, Slider, Switch } from './ui';

interface OpenGLCanvasProps {
  floorplan: FloorPlanDataset;
  walls: WallSegment2D[];
  wallHeight: number;
  onChangeWallHeight: (height: number) => void;
  wallThickness: number;
  onChangeWallThickness: (thickness: number) => void;
  showFurniture: boolean;
  onToggleFurniture: () => void;
  selectedWallId: string | null;
  onSelectWall: (wallId: string | null) => void;
  theme: Theme;
}

export type RenderStyle = 'architectural' | 'blueprint' | 'clay';
export type ViewPreset = 'perspective' | 'top' | 'front' | 'side' | 'isometric';

const VIEW_BUTTONS: { preset: ViewPreset; label: string }[] = [
  { preset: 'perspective', label: '3D' },
  { preset: 'top', label: 'Top' },
  { preset: 'isometric', label: 'Isometric' },
  { preset: 'front', label: 'Front' },
];

type CameraPose = { yaw: number; pitch: number; radius: number; target: [number, number, number] };

/** Camera limits and steps for the rotate and zoom controls. */
const MIN_RADIUS = 1.5;
const ZOOM_STEP = 1.25; // per click or key press
const ROTATE_STEP_DEG = 45; // per rotate button
const KEY_ROTATE_DEG = 15; // per arrow key
const KEY_TILT_DEG = 5;
const AUTO_ROTATE_DEG_PER_S = 20;

/** `to` as the equivalent angle nearest `from`, so a move turns the short way round. */
const nearestAngle = (from: number, to: number) => from + ((((to - from) % 360) + 540) % 360) - 180;

export const OpenGLCanvas: React.FC<OpenGLCanvasProps> = ({
  floorplan,
  walls,
  wallHeight,
  onChangeWallHeight,
  wallThickness,
  onChangeWallThickness,
  showFurniture,
  onToggleFurniture,
  selectedWallId,
  onSelectWall,
  theme,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isOrthographic, setIsOrthographic] = useState(false);
  const [isWireframe, setIsWireframe] = useState(false);
  const [renderMode, setRenderMode] = useState<'shaded' | 'normals' | 'depth'>('shaded');
  const [renderStyle, setRenderStyle] = useState<RenderStyle>('architectural');
  // The preset the camera is in, until the user orbits away from it.
  const [activeView, setActiveView] = useState<ViewPreset | null>('perspective');

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

    // Extrude walls with current height and thickness, with their doors and windows cut out
    const wallMeshes: Mesh3D[] = walls.map((w) =>
      extrudeWallWithOpenings({ ...w, height: wallHeight, thickness: wallThickness }, wallCuts(floorplan.openings, w, wallHeight))
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
    } else if (theme === 'dark') {
      gl.clearColor(0.106, 0.106, 0.106, 1.0); // --raised, dark
    } else {
      gl.clearColor(0.886, 0.906, 0.918, 1.0); // a step below --raised, so light walls still read
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
    let floorColor: [number, number, number] = theme === 'dark' ? [0.3, 0.31, 0.32] : [0.62, 0.65, 0.67];
    let furnColor: [number, number, number] = theme === 'dark' ? [0.42, 0.6, 0.66] : [0.33, 0.52, 0.58];

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
    theme,
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
    // The canvas also changes size without a window resize (the side panel stacking on narrow screens).
    const observer = new ResizeObserver(handleResize);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, []);

  // Camera moves: the model's frame, fitting, eased transitions, zoom and rotation steps, and
  // turning automatically. Buttons, keys, sliders, double-tap and the preset views all use these.
  const modelFrame = useMemo(() => {
    const xs = walls.flatMap((w) => [w.start.x, w.end.x]);
    const zs = walls.flatMap((w) => [w.start.z, w.end.z]);
    if (xs.length === 0) return { center: [0, 0, 0] as [number, number, number], halfDiagonal: 5 };
    const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    return {
      center: [(minX + maxX) / 2, 0, (minZ + maxZ) / 2] as [number, number, number],
      halfDiagonal: Math.hypot(maxX - minX, maxZ - minZ) / 2,
    };
  }, [walls]);

  /** The distance at which the whole model fits: the 45° perspective view, or the ±0.45·radius ortho extent. */
  const fitRadius = (ortho: boolean) => {
    const reach = Math.hypot(modelFrame.halfDiagonal, wallHeight / 2);
    return Math.max(4, (ortho ? reach / 0.45 : reach / Math.sin(Math.PI / 8)) * 1.08);
  };
  const maxRadiusRef = useRef(45);
  maxRadiusRef.current = fitRadius(false) * 3;
  const clampR = (radius: number) => Math.max(MIN_RADIUS, Math.min(maxRadiusRef.current, radius));
  const clampPitch = (pitch: number) => Math.max(5, Math.min(89, pitch));

  const poseRef = useRef<CameraPose>({ yaw: cameraYaw, pitch: cameraPitch, radius: cameraRadius, target: cameraTarget });
  poseRef.current = { yaw: cameraYaw, pitch: cameraPitch, radius: cameraRadius, target: cameraTarget };
  const goalRef = useRef<CameraPose | null>(null);
  const tweenRef = useRef<number | null>(null);
  const reducedMotion = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, []);
  const [autoRotate, setAutoRotate] = useState(false);

  const stopCameraMotion = () => {
    if (tweenRef.current !== null) cancelAnimationFrame(tweenRef.current);
    tweenRef.current = null;
    goalRef.current = null;
  };
  const setPose = (pose: CameraPose) => {
    setCameraYaw(pose.yaw);
    setCameraPitch(pose.pitch);
    setCameraRadius(pose.radius);
    setCameraTarget(pose.target);
  };
  /** Where the camera is going: the end of a running move, so quick repeated clicks add up. */
  const basePose = () => goalRef.current ?? poseRef.current;

  /** Eases the camera to a new pose (instantly when the system asks for reduced motion). */
  const animateCamera = (to: Partial<CameraPose>, duration = 350) => {
    const from = poseRef.current;
    const goal: CameraPose = { ...basePose(), ...to };
    stopCameraMotion();
    if (reducedMotion || duration <= 0) {
      setPose(goal);
      return;
    }
    goalRef.current = goal;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const mix = (a: number, b: number) => a + (b - a) * eased;
      setPose({
        yaw: mix(from.yaw, goal.yaw),
        pitch: mix(from.pitch, goal.pitch),
        radius: mix(from.radius, goal.radius),
        target: [0, 1, 2].map((i) => mix(from.target[i], goal.target[i])) as [number, number, number],
      });
      if (t < 1) {
        tweenRef.current = requestAnimationFrame(step);
      } else {
        tweenRef.current = null;
        goalRef.current = null;
      }
    };
    tweenRef.current = requestAnimationFrame(step);
  };

  const zoomBy = (factor: number) => animateCamera({ radius: clampR(basePose().radius / factor) }, 200);
  const rotateBy = (degrees: number) => {
    setActiveView(null);
    animateCamera({ yaw: basePose().yaw + degrees });
  };
  const tiltBy = (degrees: number) => {
    setActiveView(null);
    animateCamera({ pitch: clampPitch(basePose().pitch + degrees) }, 200);
  };
  const fitView = () => animateCamera({ target: modelFrame.center, radius: fitRadius(isOrthographic) });
  const toggleAutoRotate = (on = !autoRotate) => {
    stopCameraMotion();
    if (on) setActiveView(null);
    setAutoRotate(on);
  };

  // Turning automatically: a slow turntable until the user turns it off or grabs the model.
  useEffect(() => {
    if (!autoRotate) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      // Work out the step now: React runs the updater later, after `last` has moved on.
      const step = (Math.max(0, now - last) / 1000) * AUTO_ROTATE_DEG_PER_S;
      last = now;
      setCameraYaw((yaw) => yaw + step);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [autoRotate]);

  // Preset views, framed to fit the model and eased into place.
  const applyViewPreset = (preset: ViewPreset, duration = 350) => {
    setActiveView(preset);
    setAutoRotate(false);
    const ortho = preset !== 'perspective';
    setIsOrthographic(ortho);
    const radius = fitRadius(ortho);
    const [cx, , cz] = modelFrame.center;
    const floor: [number, number, number] = [cx, 0, cz];
    const midHeight: [number, number, number] = [cx, wallHeight / 2, cz];
    const poses: Record<ViewPreset, Omit<CameraPose, 'yaw'> & { yaw: number }> = {
      perspective: { yaw: -45, pitch: 35, radius, target: floor },
      top: { yaw: -90, pitch: 89, radius, target: floor },
      front: { yaw: -90, pitch: 5, radius, target: midHeight },
      side: { yaw: 0, pitch: 5, radius, target: midHeight },
      isometric: { yaw: -45, pitch: 35.264, radius, target: floor },
    };
    const pose = poses[preset];
    animateCamera({ ...pose, yaw: nearestAngle(poseRef.current.yaw, pose.yaw) }, duration);
  };

  // A new plan (a sample, or walls from an image) opens framed in the 3D view.
  useEffect(() => {
    applyViewPreset('perspective', 0);
  }, [floorplan.id]);

  // Snapping candidates from all walls and room corners
  const snappingCandidates = useMemo<Point2D[]>(() => {
    const pts: Point2D[] = [];
    for (const w of walls) {
      pts.push(w.start);
      pts.push(w.end);
      // Door centres snap too.
      for (const o of openingsOnWall(floorplan.openings, w.id)) {
        if (o.kind !== 'door') continue;
        pts.push({ x: w.start.x + (w.end.x - w.start.x) * o.position, z: w.start.z + (w.end.z - w.start.z) * o.position });
      }
    }
    for (const r of floorplan.rooms) {
      for (const c of r.corners) {
        pts.push(c);
      }
    }
    return pts;
  }, [walls, floorplan.rooms, floorplan.openings]);

  // Active measurement values
  const activeMeasureTarget = measurePointB || (measurePointA ? hoverFloorPoint : null);
  const measuredDistanceMeters =
    measurePointA && activeMeasureTarget ? distance2D(measurePointA, activeMeasureTarget) : 0;
  const measuredDistanceFeet = measuredDistanceMeters * 3.28084;
  const deltaX =
    measurePointA && activeMeasureTarget ? Math.abs(activeMeasureTarget.x - measurePointA.x) : 0;
  const deltaZ =
    measurePointA && activeMeasureTarget ? Math.abs(activeMeasureTarget.z - measurePointA.z) : 0;

  // Keyboard: M measures, Esc clears, arrows turn and tilt, + and − zoom, F fits, 0 resets.
  const handleKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  handleKeyRef.current = (e: KeyboardEvent) => {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case 'm':
      case 'M':
        setIsMeasuring((prev) => !prev);
        return;
      case 'Escape':
        if (measurePointB) setMeasurePointB(null);
        else if (measurePointA) setMeasurePointA(null);
        else if (isMeasuring) setIsMeasuring(false);
        return;
      case 'ArrowLeft':
        rotateBy(-KEY_ROTATE_DEG);
        break;
      case 'ArrowRight':
        rotateBy(KEY_ROTATE_DEG);
        break;
      case 'ArrowUp':
        tiltBy(KEY_TILT_DEG);
        break;
      case 'ArrowDown':
        tiltBy(-KEY_TILT_DEG);
        break;
      case '+':
      case '=':
        zoomBy(ZOOM_STEP);
        return;
      case '-':
      case '_':
        zoomBy(1 / ZOOM_STEP);
        return;
      case 'f':
      case 'F':
        fitView();
        return;
      case '0':
        applyViewPreset('perspective');
        return;
      default:
        return;
    }
    e.preventDefault(); // arrows turn the model instead of scrolling the page
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handleKeyRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  // Pointer input, for mouse, pen and touch alike. One pointer orbits (or pans with the right
  // button or Shift); two touch points pinch to zoom and move together to pan. A tap or click
  // that barely moves places a measurement point while measuring.
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; midX: number; midY: number } | null>(null);
  const isTouchScreen = useMemo(() => window.matchMedia?.('(pointer: coarse)').matches ?? false, []);

  const clampRadius = clampR;
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);

  /**
   * Moves the camera target in the camera's own screen plane so the model follows the pointer:
   * drag right and the model moves right, in every view including the top view. One pixel is
   * the world size of a pixel at the target's distance (the ortho extent is ±0.45·radius; the
   * perspective view is 45° tall).
   */
  const panBy = (dx: number, dy: number) => {
    const height = canvasRef.current?.clientHeight || 600;
    const worldPerPixel = ((isOrthographic ? 0.9 : 2 * Math.tan(Math.PI / 8)) * cameraRadius) / height;
    const yaw = (cameraYaw * Math.PI) / 180.0;
    const pitch = (cameraPitch * Math.PI) / 180.0;
    // Camera basis for an eye at target + radius·(cos p·cos y, sin p, cos p·sin y), world up +Y.
    const right = [Math.sin(yaw), 0, -Math.cos(yaw)];
    const up = [-Math.cos(yaw) * Math.sin(pitch), Math.cos(pitch), -Math.sin(yaw) * Math.sin(pitch)];
    setCameraTarget(
      (prev) => [0, 1, 2].map((i) => prev[i] + (-right[i] * dx + up[i] * dy) * worldPerPixel) as [number, number, number]
    );
  };

  /** The floor point under a screen position, snapped to a corner when snapping is on. */
  const floorPointAt = (clientX: number, clientY: number, snap = snapToCorners) => {
    const container = containerRef.current;
    if (!container || !cameraMatsRef.current) return null;
    const rect = container.getBoundingClientRect();
    const raw = screenToFloorRay(
      clientX - rect.left,
      clientY - rect.top,
      rect.width,
      rect.height,
      cameraMatsRef.current.viewMat,
      cameraMatsRef.current.projMat
    );
    if (!raw) return null;
    return snap ? snapToFloorGeometry(raw, snappingCandidates, 0.45) : { point: raw, snapped: false };
  };

  /** Double-click or double-tap: move the view's centre to that floor point and zoom in 2×. */
  const zoomToPoint = (clientX: number, clientY: number) => {
    const hit = floorPointAt(clientX, clientY, false);
    if (!hit) return;
    setActiveView(null);
    animateCamera({ target: [hit.point.x, 0, hit.point.z], radius: clampR(basePose().radius / 2) });
  };

  const placeMeasurePoint = (point: Point2D) => {
    setHoverFloorPoint(point);
    if (!measurePointA || measurePointB) {
      // First point, or a third click that starts a new measurement.
      setMeasurePointA(point);
      setMeasurePointB(null);
    } else {
      setMeasurePointB(point);
    }
  };

  const startPinch = () => {
    const [a, b] = [...pointersRef.current.values()];
    pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
    isDraggingRef.current = false;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    stopCameraMotion();
    setAutoRotate(false);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone (a touch the system cancelled): track it without capture.
    }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      startPinch();
      return;
    }
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    isDraggingRef.current = true;
    isPanningRef.current = e.button === 2 || e.shiftKey;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isMeasuring && e.pointerType === 'mouse') {
      const hit = floorPointAt(e.clientX, e.clientY);
      if (hit) {
        setHoverFloorPoint(hit.point);
        setIsHoverSnapped(hit.snapped);
      }
    }

    const pointers = pointersRef.current;
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const pinch = pinchRef.current;
    if (pointers.size >= 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      if (distance > 0 && pinch.distance > 0) setCameraRadius((prev) => clampRadius(prev * (pinch.distance / distance)));
      panBy(midX - pinch.midX, midY - pinch.midY);
      pinchRef.current = { distance, midX, midY };
      return;
    }

    if (!isDraggingRef.current) return;
    const dx = e.clientX - lastMousePosRef.current.x;
    const dy = e.clientY - lastMousePosRef.current.y;
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };

    if (isPanningRef.current) {
      panBy(dx, dy);
    } else if (dx !== 0 || dy !== 0) {
      setCameraYaw((prev) => prev + dx * 0.4);
      setCameraPitch((prev) => Math.max(5, Math.min(89, prev - dy * 0.4)));
      setActiveView(null); // orbiting leaves the preset view
    }
  };

  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    const pointers = pointersRef.current;
    const wasPinching = pinchRef.current !== null;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchRef.current = null;

    if (wasPinching) {
      // The finger left on the screen carries on orbiting from where it is, without a jump.
      const rest = [...pointers.values()][0];
      if (rest) {
        lastMousePosRef.current = { ...rest };
        mouseDownPosRef.current = { x: -1e6, y: -1e6 }; // never counts as a tap
        isDraggingRef.current = true;
        isPanningRef.current = false;
      }
      return;
    }

    const moveDist = Math.hypot(e.clientX - mouseDownPosRef.current.x, e.clientY - mouseDownPosRef.current.y);
    if (!cancelled && isMeasuring && moveDist < 6 && e.button === 0) {
      const hit = floorPointAt(e.clientX, e.clientY);
      if (hit) {
        setIsHoverSnapped(hit.snapped);
        placeMeasurePoint(hit.point);
      }
    }
    if (!cancelled && !isMeasuring && moveDist < 6 && e.button === 0) {
      const now = performance.now();
      const last = lastTapRef.current;
      if (last && now - last.time < 320 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) {
        lastTapRef.current = null;
        zoomToPoint(e.clientX, e.clientY);
      } else {
        lastTapRef.current = { time: now, x: e.clientX, y: e.clientY };
      }
    }
    isDraggingRef.current = false;
    isPanningRef.current = false;
  };

  // Wheel zoom needs a non-passive listener to stop the page scrolling at the same time.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopCameraMotion();
      setCameraRadius((prev) => clampRadius(prev * Math.exp(e.deltaY * 0.0015)));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // Screen coordinates for overlay
  const { screenA, screenB, screenHover } = screenOverlayCoords;
  const targetScreen = screenB || (isMeasuring && screenA ? screenHover : null);

  const planWidth = walls.length ? Math.max(...walls.flatMap((w) => [w.start.x, w.end.x])) - Math.min(...walls.flatMap((w) => [w.start.x, w.end.x])) : 0;
  const planDepth = walls.length ? Math.max(...walls.flatMap((w) => [w.start.z, w.end.z])) - Math.min(...walls.flatMap((w) => [w.start.z, w.end.z])) : 0;
  const doorCount = floorplan.openings.filter((o) => o.kind === 'door').length;
  const windowCount = floorplan.openings.filter((o) => o.kind === 'window').length;
  const floorArea = floorplan.rooms.reduce((sum, room) => sum + room.areaSqM, 0);
  const title = planLabel(floorplan);

  // Same geometry as the render: walls at the current height and thickness, plus the room floors.
  const handleExportObj = () => {
    const meshes: Mesh3D[] = walls.map((w) =>
      extrudeWallWithOpenings({ ...w, height: wallHeight, thickness: wallThickness }, wallCuts(floorplan.openings, w, wallHeight)),
    );
    meshes.push(...floorplan.rooms.map((r) => generateFloorMesh(r.corners)));
    downloadOBJ(combineMeshes(meshes), `${floorplan.id}.obj`);
  };

  const navigationHint = isTouchScreen
    ? 'Drag to orbit · Pinch to zoom · Two fingers to pan · Double-tap to zoom in'
    : 'Drag to orbit · Right-drag to pan · Scroll to zoom · Double-click to zoom in';
  const cameraButtons: { label: string; keys?: string; icon: React.ReactNode; onClick: () => void; pressed?: boolean }[][] = [
    [
      { label: 'Zoom in', keys: '+', icon: <ZoomIn className="h-4 w-4" strokeWidth={1.5} />, onClick: () => zoomBy(ZOOM_STEP) },
      { label: 'Zoom out', keys: '−', icon: <ZoomOut className="h-4 w-4" strokeWidth={1.5} />, onClick: () => zoomBy(1 / ZOOM_STEP) },
      { label: 'Fit to view', keys: 'F', icon: <Maximize className="h-4 w-4" strokeWidth={1.5} />, onClick: fitView },
    ],
    [
      { label: 'Turn left', keys: '←', icon: <RotateCcw className="h-4 w-4" strokeWidth={1.5} />, onClick: () => rotateBy(-ROTATE_STEP_DEG) },
      { label: 'Turn right', keys: '→', icon: <RotateCw className="h-4 w-4" strokeWidth={1.5} />, onClick: () => rotateBy(ROTATE_STEP_DEG) },
      {
        label: autoRotate ? 'Stop turning' : 'Turn automatically',
        icon: autoRotate ? <Pause className="h-4 w-4" strokeWidth={1.5} /> : <Play className="h-4 w-4" strokeWidth={1.5} />,
        onClick: () => toggleAutoRotate(),
        pressed: autoRotate,
      },
    ],
    [{ label: 'Reset view', keys: '0', icon: <House className="h-4 w-4" strokeWidth={1.5} />, onClick: () => applyViewPreset('perspective') }],
  ];
  const heading = ((cameraYaw % 360) + 360) % 360;
  const fitNow = fitRadius(isOrthographic);
  // The zoom slider runs on a log scale, so each step is the same factor at every distance.
  const zoomLog = Math.log2(fitNow / cameraRadius);

  return (
    <div className="flex min-h-full flex-col gap-5 lg:h-full">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-7">{title}</h1>
          <p className="num mt-1 text-muted">
            {walls.length} walls · {floorplan.rooms.length} rooms · {planWidth.toFixed(1)} × {planDepth.toFixed(1)} m · {doorCount} doors,{' '}
            {windowCount} windows
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button aria-pressed={isMeasuring} onClick={() => setIsMeasuring((prev) => !prev)} title="Measure between two floor points (M)">
            <Ruler className="h-4 w-4" strokeWidth={1.5} />
            Measure
          </Button>
          <Button variant="primary" onClick={handleExportObj}>
            <Download className="h-4 w-4" strokeWidth={1.5} />
            Export OBJ
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div
          ref={containerRef}
          className={`relative h-[60vh] min-h-[360px] select-none overflow-hidden rounded-lg border border-line bg-raised lg:h-auto ${
            isMeasuring ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
          }`}
        >
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={(e) => endPointer(e, false)}
            onPointerCancel={(e) => endPointer(e, true)}
            onContextMenu={(e) => e.preventDefault()}
            className="block h-full w-full touch-none"
            aria-label={`3D model of ${title}. ${navigationHint}.`}
          />

          {/* Measurement drawn over the scene, in the data hue. */}
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
            {screenA && targetScreen && (
              <g>
                <line x1={screenA[0]} y1={screenA[1]} x2={targetScreen[0]} y2={targetScreen[1]} stroke="var(--surface)" strokeWidth="5" strokeLinecap="round" />
                <line
                  x1={screenA[0]}
                  y1={screenA[1]}
                  x2={targetScreen[0]}
                  y2={targetScreen[1]}
                  stroke="var(--accent)"
                  strokeWidth="2"
                  strokeDasharray={measurePointB ? undefined : '6,4'}
                />
                {(() => {
                  const dx = targetScreen[0] - screenA[0];
                  const dy = targetScreen[1] - screenA[1];
                  const len = Math.hypot(dx, dy);
                  if (len <= 8) return null;
                  const nx = (-dy / len) * 7;
                  const ny = (dx / len) * 7;
                  return [screenA, targetScreen].map((p, i) => (
                    <line key={i} x1={p[0] - nx} y1={p[1] - ny} x2={p[0] + nx} y2={p[1] + ny} stroke="var(--accent)" strokeWidth="2" />
                  ));
                })()}
                <foreignObject
                  x={(screenA[0] + targetScreen[0]) / 2 - 80}
                  y={(screenA[1] + targetScreen[1]) / 2 - 18}
                  width="160"
                  height="36"
                  className="overflow-visible"
                >
                  <div className="flex justify-center">
                    <span className="num rounded-md border border-line bg-surface px-2 py-0.5 text-[13px] font-medium text-ink">
                      {measuredDistanceMeters.toFixed(2)} m
                    </span>
                  </div>
                </foreignObject>
              </g>
            )}
            {screenA && <circle cx={screenA[0]} cy={screenA[1]} r="4.5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.5" />}
            {screenB && measurePointB && (
              <circle cx={screenB[0]} cy={screenB[1]} r="4.5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.5" />
            )}
            {isMeasuring && screenHover && !measurePointB && (
              <circle
                cx={screenHover[0]}
                cy={screenHover[1]}
                r={isHoverSnapped ? 8 : 5}
                fill="none"
                stroke={isHoverSnapped ? 'var(--accent)' : 'var(--muted)'}
                strokeWidth="1.5"
                strokeDasharray={isHoverSnapped ? undefined : '3,3'}
              />
            )}
          </svg>

          {/* Small controls pinned inside the canvas corners. */}
          <div className="absolute left-3 top-3 flex rounded-md border border-line bg-surface p-0.5" role="group" aria-label="Camera views">
            {VIEW_BUTTONS.map(({ preset, label }) => (
              <button
                key={preset}
                type="button"
                aria-pressed={activeView === preset}
                onClick={() => applyViewPreset(preset)}
                className={`h-7 rounded-[5px] px-2.5 text-[13px] transition-colors ${
                  activeView === preset ? 'bg-active font-medium text-ink' : 'text-muted hover:bg-raised hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="absolute right-3 top-3 flex flex-col gap-2" role="toolbar" aria-label="Camera controls" aria-orientation="vertical">
            {cameraButtons.map((group, i) => (
              <div key={i} className="flex flex-col rounded-md border border-line bg-surface p-0.5">
                {group.map((b) => (
                  <button
                    key={b.label}
                    type="button"
                    onClick={b.onClick}
                    aria-label={b.label}
                    aria-pressed={b.pressed}
                    title={b.keys ? `${b.label} (${b.keys})` : b.label}
                    className={`flex h-8 w-8 items-center justify-center rounded-[5px] transition-colors ${
                      b.pressed ? 'bg-active text-ink' : 'text-muted hover:bg-raised hover:text-ink'
                    }`}
                  >
                    {b.icon}
                  </button>
                ))}
              </div>
            ))}
          </div>

          <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-end justify-between gap-2">
            {isMeasuring ? (
              <div className="flex items-center gap-3 rounded-md border border-line bg-surface px-3 py-2 text-[13px]">
                {measurePointA && activeMeasureTarget ? (
                  <>
                    <span className="num font-medium text-ink">{measuredDistanceMeters.toFixed(2)} m</span>
                    <span className="num text-muted">
                      {measuredDistanceFeet.toFixed(2)} ft · ΔX {deltaX.toFixed(2)} m · ΔZ {deltaZ.toFixed(2)} m
                    </span>
                    <button type="button" onClick={handleCopyDistance} aria-label="Copy distance" className="text-muted hover:text-ink">
                      {copiedDistance ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" strokeWidth={1.5} />}
                    </button>
                    <button type="button" onClick={handleClearMeasurement} aria-label="Clear measurement" className="text-muted hover:text-ink">
                      <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                  </>
                ) : (
                  <span className="text-muted">{isTouchScreen ? 'Tap' : 'Click'} a point on the floor, then a second one.</span>
                )}
                <label className="flex items-center gap-1.5 border-l border-line pl-3 text-muted">
                  <input type="checkbox" checked={snapToCorners} onChange={() => setSnapToCorners(!snapToCorners)} className="accent-[var(--text)]" />
                  Snap to corners
                </label>
              </div>
            ) : (
              <span className="rounded-md bg-surface/80 px-2 py-1 text-xs text-muted">{navigationHint}</span>
            )}
          </div>
        </div>

        <aside className="flex flex-col gap-6 lg:overflow-y-auto" aria-label="Model settings">
          <section>
            <SectionTitle>Plan</SectionTitle>
            <div className="rounded-md bg-raised p-3">
              <PlanThumbnail walls={walls} openings={floorplan.openings} wallThickness={wallThickness} className="h-36 w-full" title={`Top-down drawing of ${title}`} />
            </div>
            <div className="mt-1">
              <KeyValue label="Floor area">
                {floorArea.toFixed(1)} <span className="text-muted">m²</span>
              </KeyValue>
            </div>
          </section>

          <section>
            <SectionTitle>Camera</SectionTitle>
            <Slider
              label="Turn"
              value={heading}
              display={`${Math.round(heading)}°`}
              min={0}
              max={359}
              step={1}
              onChange={(v) => {
                toggleAutoRotate(false);
                setActiveView(null);
                setCameraYaw(v);
              }}
            />
            <Slider
              label="Tilt"
              value={cameraPitch}
              display={`${Math.round(cameraPitch)}°`}
              min={5}
              max={89}
              step={1}
              onChange={(v) => {
                stopCameraMotion();
                setActiveView(null);
                setCameraPitch(v);
              }}
            />
            <Slider
              label="Zoom"
              value={zoomLog}
              display={`${Math.round(2 ** zoomLog * 100)}%`}
              min={Math.ceil(Math.log2(fitNow / maxRadiusRef.current) * 20) / 20}
              max={Math.floor(Math.log2(fitNow / MIN_RADIUS) * 20) / 20}
              step={0.05}
              onChange={(v) => {
                stopCameraMotion();
                setCameraRadius(clampR(fitNow / 2 ** v));
              }}
            />
            <Switch label="Turn automatically" checked={autoRotate} onChange={(on) => toggleAutoRotate(on)} />
            <p className="mt-1 text-xs text-muted">Keys: ← → turn · ↑ ↓ tilt · + − zoom · F fit · 0 reset</p>
          </section>

          <section>
            <SectionTitle>View</SectionTitle>
            <div className="flex flex-col gap-2">
              <Segmented
                label="Projection"
                value={isOrthographic ? 'ortho' : 'perspective'}
                onChange={(v) => setIsOrthographic(v === 'ortho')}
                options={[
                  { value: 'perspective', label: 'Perspective' },
                  { value: 'ortho', label: 'Orthographic' },
                ]}
              />
              <Segmented
                label="Shading"
                value={renderMode}
                onChange={setRenderMode}
                options={[
                  { value: 'shaded', label: 'Shaded' },
                  { value: 'normals', label: 'Normals' },
                  { value: 'depth', label: 'Depth' },
                ]}
              />
              <label className="flex h-8 items-center justify-between gap-3 text-[13px]">
                Material
                <select
                  value={renderStyle}
                  onChange={(e) => setRenderStyle(e.target.value as RenderStyle)}
                  className="h-8 rounded-md border border-control bg-surface px-2 text-[13px] text-ink"
                >
                  <option value="architectural">Plaster</option>
                  <option value="blueprint">Blueprint</option>
                  <option value="clay">Clay</option>
                </select>
              </label>
              <Switch label="Wireframe" checked={isWireframe} onChange={setIsWireframe} />
            </div>
          </section>

          <section>
            <SectionTitle>Walls</SectionTitle>
            <Slider
              label="Height"
              value={wallHeight}
              display={`${wallHeight.toFixed(1)} m`}
              min={1.5}
              max={4.5}
              step={0.1}
              onChange={onChangeWallHeight}
            />
            <Slider
              label="Thickness"
              value={wallThickness}
              display={`${wallThickness.toFixed(2)} m`}
              min={0.1}
              max={0.4}
              step={0.02}
              onChange={onChangeWallThickness}
            />
            <Switch label="Furniture" checked={showFurniture} onChange={onToggleFurniture} />
          </section>

          <section>
            <SectionTitle>Model</SectionTitle>
            <KeyValue label="Vertices">{stats.vertices.toLocaleString()}</KeyValue>
            <KeyValue label="Triangles">{stats.triangles.toLocaleString()}</KeyValue>
            <KeyValue label="Frame rate">
              {Number.isFinite(stats.fps) && stats.fps > 0 ? stats.fps : 60} <span className="text-muted">fps</span>
            </KeyValue>
          </section>
        </aside>
      </div>
    </div>
  );
};
