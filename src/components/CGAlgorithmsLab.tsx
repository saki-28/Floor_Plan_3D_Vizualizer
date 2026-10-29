import React, { useState } from 'react';
import {
  bresenhamLine,
  ddaLine,
  mat4Identity,
  mat4Multiply,
  mat4Perspective,
  mat4LookAt,
  transformVertexMVP,
} from '../utils/geometryEngine';
import {
  Binary,
  Cpu,
  Layers,
  Sliders,
  CheckCircle2,
  HelpCircle,
  Lightbulb,
} from 'lucide-react';

export const CGAlgorithmsLab: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'rasterization' | 'mvp' | 'depth' | 'shading'>('rasterization');

  // Rasterization State
  const [lineP0, setLineP0] = useState<[number, number]>([2, 3]);
  const [lineP1, setLineP1] = useState<[number, number]>([14, 9]);

  // MVP State
  const [testVertex, setTestVertex] = useState<[number, number, number]>([3.0, 2.8, -2.5]);
  const [camDistance, setCamDistance] = useState(15.0);
  const [fovDegrees, setFovDegrees] = useState(45.0);

  // Depth buffer State
  const [zNear, setZNear] = useState(0.1);
  const [zFar, setZFar] = useState(100.0);

  // Shading State
  const [lightAngle, setLightAngle] = useState(45);
  const [shininess, setShininess] = useState(32);

  // Run Bresenham and DDA
  const bresenhamPixels = bresenhamLine(lineP0[0], lineP0[1], lineP1[0], lineP1[1]);
  const ddaPixels = ddaLine(lineP0[0], lineP0[1], lineP1[0], lineP1[1]);

  // Calculate MVP for test vertex
  const model = mat4Identity();
  const view = mat4LookAt(0, 8, camDistance, 0, 0, 0, 0, 1, 0);
  const proj = mat4Perspective((fovDegrees * Math.PI) / 180, 16 / 9, zNear, zFar);
  const mv = mat4Multiply(view, model);
  const mvp = mat4Multiply(proj, mv);
  const clipCoords = transformVertexMVP(mvp, testVertex);
  const ndc: [number, number, number] = [
    clipCoords[0] / clipCoords[3],
    clipCoords[1] / clipCoords[3],
    clipCoords[2] / clipCoords[3],
  ];

  // Grid for rasterization demo (16x12)
  const gridWidth = 18;
  const gridHeight = 12;

  const isBresenhamPixel = (x: number, y: number) =>
    bresenhamPixels.some(([px, py]) => px === x && py === y);

  const isDdaPixel = (x: number, y: number) =>
    ddaPixels.some(([px, py]) => px === x && py === y);

  // Shading math
  const lightRad = (lightAngle * Math.PI) / 180;
  const L = [Math.sin(lightRad), Math.cos(lightRad), 0.2]; // Light vector
  const N = [0, 1, 0]; // Surface normal pointing up
  const V = [0, 0.707, 0.707]; // View vector
  const H = [
    (L[0] + V[0]) / 2,
    (L[1] + V[1]) / 2,
    (L[2] + V[2]) / 2,
  ];
  const lenH = Math.hypot(H[0], H[1], H[2]);
  const Hnorm = [H[0] / lenH, H[1] / lenH, H[2] / lenH];

  const ambient = 0.2;
  const NdotL = Math.max(0, N[0] * L[0] + N[1] * L[1] + N[2] * L[2]);
  const diffuse = 0.6 * NdotL;
  const NdotH = Math.max(0, N[0] * Hnorm[0] + N[1] * Hnorm[1] + N[2] * Hnorm[2]);
  const specular = 0.4 * Math.pow(NdotH, shininess);
  const totalIntensity = Math.min(1.0, ambient + diffuse + specular);

  return (
    <div className="w-full h-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden rounded-xl border border-slate-800">
      {/* Sub-nav Tabs */}
      <div className="bg-slate-900 border-b border-slate-800 p-2.5 flex items-center gap-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('rasterization')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            activeTab === 'rasterization'
              ? 'bg-blue-600 text-white font-semibold'
              : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          1. Bresenham vs DDA Line Rasterization
        </button>
        <button
          onClick={() => setActiveTab('mvp')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            activeTab === 'mvp'
              ? 'bg-blue-600 text-white font-semibold'
              : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          2. MVP Homogeneous Coordinates Pipeline
        </button>
        <button
          onClick={() => setActiveTab('depth')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            activeTab === 'depth'
              ? 'bg-blue-600 text-white font-semibold'
              : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          3. Z-Buffer Depth Buffer Precision
        </button>
        <button
          onClick={() => setActiveTab('shading')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            activeTab === 'shading'
              ? 'bg-blue-600 text-white font-semibold'
              : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          4. Surface Normals & Blinn-Phong Shading
        </button>
      </div>

      {/* Lab Body */}
      <div className="flex-1 p-5 overflow-y-auto">
        {activeTab === 'rasterization' && (
          <div className="space-y-6 max-w-5xl mx-auto">
            <div className="border-b border-slate-800 pb-3">
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <Binary className="w-5 h-5 text-blue-400" /> Bresenham's Integer Line Drawing Algorithm
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Demonstrates how continuous 2D floor-plan line vectors are mapped to discrete frame-buffer pixels using pure integer addition and subtraction, avoiding expensive floating-point arithmetic.
              </p>
            </div>

            {/* Grid & Controls */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-slate-900 p-4 rounded-xl border border-slate-800 flex flex-col items-center">
                <div className="text-xs font-semibold text-slate-300 mb-3 flex items-center justify-between w-full">
                  <span>Raster Pixel Grid (18 x 12)</span>
                  <div className="flex items-center gap-4 text-[11px]">
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 bg-blue-500 rounded-sm inline-block" /> Bresenham Pixels
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 border border-amber-400 rounded-sm inline-block" /> Line Trajectory
                    </span>
                  </div>
                </div>

                {/* Pixel Grid Display */}
                <div className="inline-grid grid-cols-18 gap-1 bg-slate-950 p-3 rounded-lg border border-slate-800">
                  {Array.from({ length: gridHeight }).map((_, r) => {
                    const y = gridHeight - 1 - r; // Invert y for standard Cartesian display
                    return Array.from({ length: gridWidth }).map((_, x) => {
                      const isHit = isBresenhamPixel(x, y);
                      const isEndpoint = (x === lineP0[0] && y === lineP0[1]) || (x === lineP1[0] && y === lineP1[1]);
                      return (
                        <div
                          key={`${x}-${y}`}
                          className={`w-6 h-6 rounded-sm text-[9px] font-mono flex items-center justify-center transition-all ${
                            isEndpoint
                              ? 'bg-emerald-500 text-slate-950 font-bold ring-2 ring-emerald-300'
                              : isHit
                              ? 'bg-blue-600 text-white shadow'
                              : 'bg-slate-900 text-slate-600 hover:bg-slate-800'
                          }`}
                          title={`(${x}, ${y})`}
                        >
                          {isHit ? `${x},${y}` : ''}
                        </div>
                      );
                    });
                  })}
                </div>
              </div>

              {/* Endpoint Controls & Mathematical Theory */}
              <div className="space-y-4">
                <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-3">
                  <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                    Interactive Endpoints
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="text-slate-400 block mb-1">Start P0 (X, Y)</label>
                      <div className="flex gap-1.5">
                        <input
                          type="number"
                          min="0"
                          max={gridWidth - 1}
                          value={lineP0[0]}
                          onChange={(e) => setLineP0([+e.target.value, lineP0[1]])}
                          className="w-16 bg-slate-950 border border-slate-700 px-2 py-1 rounded text-center"
                        />
                        <input
                          type="number"
                          min="0"
                          max={gridHeight - 1}
                          value={lineP0[1]}
                          onChange={(e) => setLineP0([lineP0[0], +e.target.value])}
                          className="w-16 bg-slate-950 border border-slate-700 px-2 py-1 rounded text-center"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-slate-400 block mb-1">End P1 (X, Y)</label>
                      <div className="flex gap-1.5">
                        <input
                          type="number"
                          min="0"
                          max={gridWidth - 1}
                          value={lineP1[0]}
                          onChange={(e) => setLineP1([+e.target.value, lineP1[1]])}
                          className="w-16 bg-slate-950 border border-slate-700 px-2 py-1 rounded text-center"
                        />
                        <input
                          type="number"
                          min="0"
                          max={gridHeight - 1}
                          value={lineP1[1]}
                          onChange={(e) => setLineP1([lineP1[0], +e.target.value])}
                          className="w-16 bg-slate-950 border border-slate-700 px-2 py-1 rounded text-center"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2 text-xs">
                  <h3 className="font-bold text-blue-400">Mathematical Derivation</h3>
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    Given slope <code className="text-amber-300">m = dy / dx &lt; 1</code>, the initial decision parameter is:
                  </p>
                  <div className="bg-slate-950 p-2 rounded font-mono text-[11px] text-emerald-400">
                    d_0 = 2 \Delta y - \Delta x
                  </div>
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    At each step <code className="text-amber-300">x_{'{k+1}'} = x_k + 1</code>:
                    <br />
                    - If <code className="text-cyan-300">d_k &lt; 0</code>: choose lower pixel <code className="text-slate-200">y_{'{k+1}'} = y_k</code>, update <code className="text-emerald-400">d_{'{k+1}'} = d_k + 2\Delta y</code>.
                    <br />
                    - If <code className="text-cyan-300">d_k \ge 0</code>: choose diagonal pixel <code className="text-slate-200">y_{'{k+1}'} = y_k + 1</code>, update <code className="text-emerald-400">d_{'{k+1}'} = d_k + 2\Delta y - 2\Delta x</code>.
                  </p>
                  <div className="pt-1 text-[11px] text-slate-400">
                    Total rasterized points: <span className="text-blue-400 font-bold">{bresenhamPixels.length} pixels</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'mvp' && (
          <div className="space-y-6 max-w-5xl mx-auto">
            <div className="border-b border-slate-800 pb-3">
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <Cpu className="w-5 h-5 text-emerald-400" /> Model-View-Projection (MVP) Pipeline
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Visualizes the complete vertex transformation from local architectural object coordinates to 2D screen viewport pixels.
              </p>
            </div>

            {/* Test Vertex input */}
            <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Select 3D Vertex in Object Space [X, Y, Z]</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.1"
                    value={testVertex[0]}
                    onChange={(e) => setTestVertex([+e.target.value, testVertex[1], testVertex[2]])}
                    className="w-20 bg-slate-950 border border-slate-700 px-2 py-1 rounded text-xs font-mono"
                  />
                  <input
                    type="number"
                    step="0.1"
                    value={testVertex[1]}
                    onChange={(e) => setTestVertex([testVertex[0], +e.target.value, testVertex[2]])}
                    className="w-20 bg-slate-950 border border-slate-700 px-2 py-1 rounded text-xs font-mono"
                  />
                  <input
                    type="number"
                    step="0.1"
                    value={testVertex[2]}
                    onChange={(e) => setTestVertex([testVertex[0], testVertex[1], +e.target.value])}
                    className="w-20 bg-slate-950 border border-slate-700 px-2 py-1 rounded text-xs font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs">
                <div>
                  <span className="text-slate-400 block mb-1">Camera Distance: {camDistance.toFixed(1)}m</span>
                  <input
                    type="range"
                    min="5"
                    max="30"
                    value={camDistance}
                    onChange={(e) => setCamDistance(+e.target.value)}
                    className="w-32 accent-blue-500"
                  />
                </div>
                <div>
                  <span className="text-slate-400 block mb-1">FOV: {fovDegrees}°</span>
                  <input
                    type="range"
                    min="30"
                    max="90"
                    value={fovDegrees}
                    onChange={(e) => setFovDegrees(+e.target.value)}
                    className="w-32 accent-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Pipeline Stage Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-slate-900 p-3.5 rounded-xl border border-slate-800">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  1. Model Space
                </div>
                <div className="font-mono text-xs text-amber-300 bg-slate-950 p-2 rounded">
                  [{testVertex[0].toFixed(2)}, {testVertex[1].toFixed(2)}, {testVertex[2].toFixed(2)}, 1.0]
                </div>
                <p className="text-[11px] text-slate-400 mt-2">
                  Raw extruded wall vertex geometry generated at y=0 to y=h.
                </p>
              </div>

              <div className="bg-slate-900 p-3.5 rounded-xl border border-slate-800">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  2. View (Camera) Space
                </div>
                <div className="font-mono text-xs text-blue-300 bg-slate-950 p-2 rounded">
                  V = glm::lookAt(eye, target, up)
                </div>
                <p className="text-[11px] text-slate-400 mt-2">
                  Transforms world coords into eye coordinates relative to camera orientation.
                </p>
              </div>

              <div className="bg-slate-900 p-3.5 rounded-xl border border-slate-800">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  3. Clip Space (p_clip)
                </div>
                <div className="font-mono text-xs text-emerald-300 bg-slate-950 p-2 rounded">
                  [{clipCoords[0].toFixed(2)}, {clipCoords[1].toFixed(2)}, {clipCoords[2].toFixed(2)}, {clipCoords[3].toFixed(2)}]
                </div>
                <p className="text-[11px] text-slate-400 mt-2">
                  Multiplied by Projection Matrix: p_clip = P * V * M * p.
                </p>
              </div>

              <div className="bg-slate-900 p-3.5 rounded-xl border border-slate-800">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  4. NDC Space (Perspective Division)
                </div>
                <div className="font-mono text-xs text-cyan-300 bg-slate-950 p-2 rounded">
                  [{ndc[0].toFixed(3)}, {ndc[1].toFixed(3)}, {ndc[2].toFixed(3)}]
                </div>
                <p className="text-[11px] text-slate-400 mt-2">
                  Divided by w_clip: normalized to [-1, +1] cube for OpenGL rasterizer.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'depth' && (
          <div className="space-y-6 max-w-5xl mx-auto">
            <div className="border-b border-slate-800 pb-3">
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <Layers className="w-5 h-5 text-amber-400" /> Z-Buffer Depth Buffer Precision & Z-Fighting Analysis
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Explains how non-linear perspective depth precision is distributed and why choosing an appropriate near clipping plane is critical to prevent Z-fighting in architectural models.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-4">
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs text-slate-300 mb-1">
                      <span>Near Clipping Plane (zNear): {zNear.toFixed(2)}m</span>
                      <span className="text-amber-400 font-semibold">{zNear < 0.05 ? '⚠️ Risk of Z-Fighting' : '✓ Safe'}</span>
                    </div>
                    <input
                      type="range"
                      min="0.01"
                      max="2.0"
                      step="0.01"
                      value={zNear}
                      onChange={(e) => setZNear(+e.target.value)}
                      className="w-full accent-amber-500"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-slate-300 mb-1">
                      <span>Far Clipping Plane (zFar): {zFar.toFixed(0)}m</span>
                    </div>
                    <input
                      type="range"
                      min="20"
                      max="300"
                      step="5"
                      value={zFar}
                      onChange={(e) => setZFar(+e.target.value)}
                      className="w-full accent-blue-500"
                    />
                  </div>
                </div>

                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono text-xs text-slate-300 space-y-2">
                  <div className="text-amber-300 font-semibold">Non-Linear Depth Transformation:</div>
                  <div className="text-emerald-400">
                    z_ndc = (far + near)/(near - far) + (2 * far * near) / ((near - far) * z_eye)
                  </div>
                </div>
              </div>

              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-3">
                <h3 className="text-xs font-bold text-slate-200">24-Bit Depth Distribution Metrics</h3>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between p-2 rounded bg-slate-950">
                    <span className="text-slate-400">Total Available 24-bit Values:</span>
                    <span className="font-mono text-blue-400">2^{'{24}'} = 16,777,216</span>
                  </div>
                  <div className="flex justify-between p-2 rounded bg-slate-950">
                    <span className="text-slate-400">Precision clustered in first 10% of view range:</span>
                    <span className="font-mono text-amber-400 font-bold">~89.4%</span>
                  </div>
                  <div className="flex justify-between p-2 rounded bg-slate-950">
                    <span className="text-slate-400">Precision in remaining 90% of view range:</span>
                    <span className="font-mono text-cyan-400">~10.6%</span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed pt-2">
                  In architectural rendering, setting <code className="text-amber-300">zNear = 0.001</code> compresses all depth resolution into the first 2 centimeters, causing walls and coplanar floors to flicker (Z-fighting). For rooms, <code className="text-emerald-400">zNear = 0.1</code> is mathematically optimal.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'shading' && (
          <div className="space-y-6 max-w-5xl mx-auto">
            <div className="border-b border-slate-800 pb-3">
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-amber-400" /> Directional Lighting & Blinn-Phong Shading Decomposition
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Decomposes the fragment shader equations into Ambient, Diffuse (Lambertian cosine law), and Specular (Halfway vector) components.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-4">
                <div>
                  <div className="flex justify-between text-xs text-slate-300 mb-1">
                    <span>Sunlight Incidence Azimuth: {lightAngle}°</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="180"
                    value={lightAngle}
                    onChange={(e) => setLightAngle(+e.target.value)}
                    className="w-full accent-amber-500"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs text-slate-300 mb-1">
                    <span>Material Shininess Specular Power (α): {shininess}</span>
                  </div>
                  <input
                    type="range"
                    min="4"
                    max="128"
                    step="4"
                    value={shininess}
                    onChange={(e) => setShininess(+e.target.value)}
                    className="w-full accent-blue-500"
                  />
                </div>

                {/* Live intensity preview */}
                <div className="p-4 rounded-lg bg-slate-950 flex items-center justify-between border border-slate-800">
                  <span className="text-xs font-semibold text-slate-300">Resulting Surface Color Intensity:</span>
                  <div
                    className="w-20 h-10 rounded border border-slate-700 shadow"
                    style={{
                      backgroundColor: `rgb(${Math.round(totalIntensity * 220)}, ${Math.round(totalIntensity * 230)}, ${Math.round(totalIntensity * 245)})`,
                    }}
                  />
                </div>
              </div>

              {/* Shading Terms Breakdown */}
              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-3">
                <h3 className="text-xs font-bold text-slate-200">Fragment Shader Equation Breakdown</h3>
                <div className="space-y-2.5 text-xs">
                  <div>
                    <div className="flex justify-between text-slate-300 mb-1">
                      <span>1. Ambient Term: I_a = k_a * L_a</span>
                      <span className="font-mono text-emerald-400">{(ambient * 100).toFixed(0)}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500" style={{ width: `${ambient * 100}%` }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-slate-300 mb-1">
                      <span>2. Diffuse Term: I_d = k_d * max(N · L, 0)</span>
                      <span className="font-mono text-blue-400">{(diffuse * 100).toFixed(0)}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500" style={{ width: `${diffuse * 100}%` }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-slate-300 mb-1">
                      <span>3. Specular Term: I_s = k_s * max(N · H, 0)^α</span>
                      <span className="font-mono text-amber-400">{(specular * 100).toFixed(0)}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-500" style={{ width: `${specular * 100}%` }} />
                    </div>
                  </div>
                </div>

                <div className="mt-4 p-2.5 rounded bg-slate-950 font-mono text-[11px] text-slate-300">
                  Total I = {(totalIntensity * 100).toFixed(1)}% | Halfway Vector H = normalize(L + V)
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
