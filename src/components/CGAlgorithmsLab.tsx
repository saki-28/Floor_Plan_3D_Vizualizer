import { PageHeader, Tabs } from './ui';
import React, { useState } from 'react';
import { GRAPHICS_TEX, depthStep, depthValue, halfDepthDistance } from '../data/formulas';
import { Formula, MathText, Tex } from './Formula';

/** A length in metres, in the unit that reads best. */
const formatLength = (m: number) => (m >= 1 ? `${m.toFixed(1)} m` : m >= 0.01 ? `${(m * 100).toFixed(1)} cm` : `${(m * 1000).toPrecision(2)} mm`);
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
    <div className="flex min-h-full flex-col gap-5 lg:h-full">
      <PageHeader
        title="Graphics"
        description="The graphics algorithms behind the 3D viewer, to try out: line drawing, the camera matrices, depth precision and shading."
      />
      <Tabs
        label="Demonstrations"
        value={activeTab}
        onChange={setActiveTab}
        tabs={[
          { value: 'rasterization', label: 'Line rasterization' },
          { value: 'mvp', label: 'MVP pipeline' },
          { value: 'depth', label: 'Depth buffer precision' },
          { value: 'shading', label: 'Normals and shading' },
        ]}
      />

      {/* Lab Body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === 'rasterization' && (
          <div className="space-y-6 max-w-5xl mx-auto">
            <div className="border-b border-line pb-3">
              <h2 className="text-lg font-bold text-ink flex items-center gap-2">
                <Binary className="w-5 h-5 text-accent" /> Bresenham's Integer Line Drawing Algorithm
              </h2>
              <p className="text-[13px] text-muted mt-1">
                Demonstrates how continuous 2D floor-plan line vectors are mapped to discrete frame-buffer pixels using pure integer addition and subtraction, avoiding expensive floating-point arithmetic.
              </p>
            </div>

            {/* Grid & Controls */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-raised p-4 rounded-lg border border-line flex flex-col items-center">
                <div className="text-xs font-semibold text-ink mb-3 flex items-center justify-between w-full">
                  <span>Raster Pixel Grid (18 x 12)</span>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 bg-primary rounded-sm inline-block" /> Bresenham Pixels
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 border border-line rounded-sm inline-block" /> Line Trajectory
                    </span>
                  </div>
                </div>

                {/* Pixel Grid Display */}
                <div className="inline-grid grid-cols-18 gap-1 bg-surface p-3 rounded-lg border border-line">
                  {Array.from({ length: gridHeight }).map((_, r) => {
                    const y = gridHeight - 1 - r; // Invert y for standard Cartesian display
                    return Array.from({ length: gridWidth }).map((_, x) => {
                      const isHit = isBresenhamPixel(x, y);
                      const isEndpoint = (x === lineP0[0] && y === lineP0[1]) || (x === lineP1[0] && y === lineP1[1]);
                      return (
                        <div
                          key={`${x}-${y}`}
                          className={`w-6 h-6 rounded-sm text-xs num flex items-center justify-center transition-colors ${
                            isEndpoint
                              ? 'bg-positive text-on-primary font-bold ring-2 ring-positive'
                              : isHit
                              ? 'bg-primary text-on-primary '
                              : 'bg-raised text-muted hover:bg-active'
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
                <div className="bg-raised p-4 rounded-lg border border-line space-y-3">
                  <h3 className="text-xs font-bold text-ink  ">
                    Interactive Endpoints
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="text-muted block mb-1">Start P0 (X, Y)</label>
                      <div className="flex gap-1.5">
                        <input
                          type="number"
                          min="0"
                          max={gridWidth - 1}
                          value={lineP0[0]}
                          onChange={(e) => setLineP0([+e.target.value, lineP0[1]])}
                          className="w-16 bg-surface border border-line px-2 py-1 rounded text-center"
                        />
                        <input
                          type="number"
                          min="0"
                          max={gridHeight - 1}
                          value={lineP0[1]}
                          onChange={(e) => setLineP0([lineP0[0], +e.target.value])}
                          className="w-16 bg-surface border border-line px-2 py-1 rounded text-center"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-muted block mb-1">End P1 (X, Y)</label>
                      <div className="flex gap-1.5">
                        <input
                          type="number"
                          min="0"
                          max={gridWidth - 1}
                          value={lineP1[0]}
                          onChange={(e) => setLineP1([+e.target.value, lineP1[1]])}
                          className="w-16 bg-surface border border-line px-2 py-1 rounded text-center"
                        />
                        <input
                          type="number"
                          min="0"
                          max={gridHeight - 1}
                          value={lineP1[1]}
                          onChange={(e) => setLineP1([lineP1[0], +e.target.value])}
                          className="w-16 bg-surface border border-line px-2 py-1 rounded text-center"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-raised p-4 rounded-lg border border-line space-y-2 text-xs">
                  <h3 className="font-bold text-accent">Mathematical Derivation</h3>
                  <Formula tex={GRAPHICS_TEX.bresenhamStart} />
                  <Formula tex={GRAPHICS_TEX.bresenhamStep} />
                  <p className="text-[13px] leading-relaxed text-muted">
                    <MathText>{GRAPHICS_TEX.bresenhamSymbols}</MathText>
                  </p>
                  <div className="pt-1 text-xs text-muted">
                    Total rasterized points: <span className="text-accent font-bold">{bresenhamPixels.length} pixels</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'mvp' && (
          <div className="space-y-6 max-w-5xl mx-auto">
            <div className="border-b border-line pb-3">
              <h2 className="text-lg font-bold text-ink flex items-center gap-2">
                <Cpu className="w-5 h-5 text-positive" /> Model-View-Projection (MVP) Pipeline
              </h2>
              <p className="text-[13px] text-muted mt-1">
                Visualizes the complete vertex transformation from local architectural object coordinates to 2D screen viewport pixels.
              </p>
            </div>

            {/* Test Vertex input */}
            <div className="bg-raised p-4 rounded-lg border border-line flex flex-wrap items-center justify-between gap-4">
              <div>
                <label className="text-xs text-muted block mb-1">Select 3D Vertex in Object Space [X, Y, Z]</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.1"
                    value={testVertex[0]}
                    onChange={(e) => setTestVertex([+e.target.value, testVertex[1], testVertex[2]])}
                    className="w-20 bg-surface border border-line px-2 py-1 rounded text-xs num"
                  />
                  <input
                    type="number"
                    step="0.1"
                    value={testVertex[1]}
                    onChange={(e) => setTestVertex([testVertex[0], +e.target.value, testVertex[2]])}
                    className="w-20 bg-surface border border-line px-2 py-1 rounded text-xs num"
                  />
                  <input
                    type="number"
                    step="0.1"
                    value={testVertex[2]}
                    onChange={(e) => setTestVertex([testVertex[0], testVertex[1], +e.target.value])}
                    className="w-20 bg-surface border border-line px-2 py-1 rounded text-xs num"
                  />
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs">
                <div>
                  <span className="text-muted block mb-1">Camera Distance: {camDistance.toFixed(1)}m</span>
                  <input
                    type="range"
                    min="5"
                    max="30"
                    value={camDistance}
                    onChange={(e) => setCamDistance(+e.target.value)}
                    className="w-32 accent-[var(--text)]"
                  />
                </div>
                <div>
                  <span className="text-muted block mb-1">FOV: {fovDegrees}°</span>
                  <input
                    type="range"
                    min="30"
                    max="90"
                    value={fovDegrees}
                    onChange={(e) => setFovDegrees(+e.target.value)}
                    className="w-32 accent-[var(--text)]"
                  />
                </div>
              </div>
            </div>

            {/* Pipeline Stage Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-raised p-3.5 rounded-lg border border-line">
                <div className="text-xs font-bold text-muted   mb-2">
                  1. Model Space
                </div>
                <div className="num text-xs text-ink bg-surface p-2 rounded">
                  [{testVertex[0].toFixed(2)}, {testVertex[1].toFixed(2)}, {testVertex[2].toFixed(2)}, 1.0]
                </div>
                <p className="text-[13px] text-muted mt-2">
                  Raw extruded wall vertex geometry generated at y=0 to y=h.
                </p>
              </div>

              <div className="bg-raised p-3.5 rounded-lg border border-line">
                <div className="text-xs font-bold text-muted   mb-2">
                  2. View (Camera) Space
                </div>
                <div className="rounded bg-surface p-2 text-[13px]">
                  <Tex>{GRAPHICS_TEX.view}</Tex>
                </div>
                <p className="text-[13px] text-muted mt-2">
                  Transforms world coords into eye coordinates relative to camera orientation.
                </p>
              </div>

              <div className="bg-raised p-3.5 rounded-lg border border-line">
                <div className="text-xs font-bold text-muted   mb-2">
                  3. Clip Space (p_clip)
                </div>
                <div className="num text-xs text-positive bg-surface p-2 rounded">
                  [{clipCoords[0].toFixed(2)}, {clipCoords[1].toFixed(2)}, {clipCoords[2].toFixed(2)}, {clipCoords[3].toFixed(2)}]
                </div>
                <p className="text-[13px] text-muted mt-2">
                  Multiplied by the projection matrix: <Tex>{GRAPHICS_TEX.clip}</Tex>.
                </p>
              </div>

              <div className="bg-raised p-3.5 rounded-lg border border-line">
                <div className="text-xs font-bold text-muted   mb-2">
                  4. NDC Space (Perspective Division)
                </div>
                <div className="num text-xs text-accent bg-surface p-2 rounded">
                  [{ndc[0].toFixed(3)}, {ndc[1].toFixed(3)}, {ndc[2].toFixed(3)}]
                </div>
                <p className="text-[13px] text-muted mt-2">
                  Divided by <Tex>{'w_{\\text{clip}}'}</Tex>: <Tex>{GRAPHICS_TEX.ndc}</Tex>, the cube the rasterizer draws.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'depth' && (
          <div className="space-y-6 max-w-5xl mx-auto">
            <div className="border-b border-line pb-3">
              <h2 className="text-lg font-bold text-ink flex items-center gap-2">
                <Layers className="w-5 h-5 text-ink" /> Z-Buffer Depth Buffer Precision & Z-Fighting Analysis
              </h2>
              <p className="text-[13px] text-muted mt-1">
                Explains how non-linear perspective depth precision is distributed and why choosing an appropriate near clipping plane is critical to prevent Z-fighting in architectural models.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-raised p-4 rounded-lg border border-line space-y-4">
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs text-ink mb-1">
                      <span>Near Clipping Plane (zNear): {zNear.toFixed(2)}m</span>
                      <span className="text-ink font-semibold">{zNear < 0.05 ? 'Risk of z-fighting' : 'Safe'}</span>
                    </div>
                    <input
                      type="range"
                      min="0.01"
                      max="2.0"
                      step="0.01"
                      value={zNear}
                      onChange={(e) => setZNear(+e.target.value)}
                      className="w-full accent-[var(--text)]"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-ink mb-1">
                      <span>Far Clipping Plane (zFar): {zFar.toFixed(0)}m</span>
                    </div>
                    <input
                      type="range"
                      min="20"
                      max="300"
                      step="5"
                      value={zFar}
                      onChange={(e) => setZFar(+e.target.value)}
                      className="w-full accent-[var(--text)]"
                    />
                  </div>
                </div>

                <div className="space-y-1 rounded-lg border border-line bg-surface p-3">
                  <div className="text-xs font-semibold text-ink">Depth is not linear in distance</div>
                  <Formula tex={GRAPHICS_TEX.depth} />
                  <p className="text-[13px] leading-relaxed text-muted">
                    <MathText>{GRAPHICS_TEX.depthSymbols}</MathText>
                  </p>
                </div>
              </div>

              <div className="bg-raised p-4 rounded-lg border border-line space-y-3">
                <h3 className="text-xs font-bold text-ink">A 24-bit depth buffer with these planes</h3>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between gap-3 rounded bg-surface p-2">
                    <span className="text-muted">Depth values available</span>
                    <span className="num text-ink">2²⁴ = 16,777,216</span>
                  </div>
                  <div className="flex justify-between gap-3 rounded bg-surface p-2">
                    <span className="text-muted">Half of them are used within</span>
                    <span className="num font-semibold text-ink">{formatLength(halfDepthDistance(zNear, zFar))} of the camera</span>
                  </div>
                  <div className="flex justify-between gap-3 rounded bg-surface p-2">
                    <span className="text-muted">Share used by the nearest 10% of the range</span>
                    <span className="num text-ink">{(depthValue(zNear + 0.1 * (zFar - zNear), zNear, zFar) * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between gap-3 rounded bg-surface p-2">
                    <span className="text-muted">Smallest depth step at 10 m</span>
                    <span className="num text-ink">{formatLength(depthStep(10, zNear, zFar))}</span>
                  </div>
                </div>
                <p className="text-[13px] text-muted leading-relaxed pt-2">
                  Moving the near plane closer spends even more of the values right in front of the camera, and the steps far away grow. When the step at a
                  wall's distance is larger than the gap between the wall and the floor or a door frame, the two flicker through each other (z-fighting).
                  For rooms viewed from a few metres, a near plane of about 0.1 m keeps the steps far below a millimetre.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'shading' && (
          <div className="space-y-6 max-w-5xl mx-auto">
            <div className="border-b border-line pb-3">
              <h2 className="text-lg font-bold text-ink flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-ink" /> Directional Lighting & Blinn-Phong Shading Decomposition
              </h2>
              <p className="text-[13px] text-muted mt-1">
                Decomposes the fragment shader equations into Ambient, Diffuse (Lambertian cosine law), and Specular (Halfway vector) components.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-raised p-4 rounded-lg border border-line space-y-4">
                <div>
                  <div className="flex justify-between text-xs text-ink mb-1">
                    <span>Sunlight Incidence Azimuth: {lightAngle}°</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="180"
                    value={lightAngle}
                    onChange={(e) => setLightAngle(+e.target.value)}
                    className="w-full accent-[var(--text)]"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs text-ink mb-1">
                    <span>Material Shininess Specular Power (α): {shininess}</span>
                  </div>
                  <input
                    type="range"
                    min="4"
                    max="128"
                    step="4"
                    value={shininess}
                    onChange={(e) => setShininess(+e.target.value)}
                    className="w-full accent-[var(--text)]"
                  />
                </div>

                {/* Live intensity preview */}
                <div className="p-4 rounded-lg bg-surface flex items-center justify-between border border-line">
                  <span className="text-xs font-semibold text-ink">Resulting Surface Color Intensity:</span>
                  <div
                    className="w-20 h-10 rounded border border-line "
                    style={{
                      backgroundColor: `rgb(${Math.round(totalIntensity * 220)}, ${Math.round(totalIntensity * 230)}, ${Math.round(totalIntensity * 245)})`,
                    }}
                  />
                </div>
              </div>

              {/* Shading Terms Breakdown */}
              <div className="bg-raised p-4 rounded-lg border border-line space-y-3">
                <h3 className="text-xs font-bold text-ink">Fragment Shader Equation Breakdown</h3>
                <div className="space-y-2.5 text-xs">
                  <div>
                    <div className="flex justify-between text-ink mb-1">
                      <span>1. Ambient Term: I_a = k_a * L_a</span>
                      <span className="num text-positive">{(ambient * 100).toFixed(0)}%</span>
                    </div>
                    <div className="w-full h-2 bg-surface rounded-full overflow-hidden">
                      <div className="h-full bg-positive" style={{ width: `${ambient * 100}%` }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-ink mb-1">
                      <span>2. Diffuse Term: I_d = k_d * max(N · L, 0)</span>
                      <span className="num text-accent">{(diffuse * 100).toFixed(0)}%</span>
                    </div>
                    <div className="w-full h-2 bg-surface rounded-full overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${diffuse * 100}%` }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-ink mb-1">
                      <span>3. Specular Term: I_s = k_s * max(N · H, 0)^α</span>
                      <span className="num text-ink">{(specular * 100).toFixed(0)}%</span>
                    </div>
                    <div className="w-full h-2 bg-surface rounded-full overflow-hidden">
                      <div className="h-full bg-warning" style={{ width: `${specular * 100}%` }} />
                    </div>
                  </div>
                </div>

                <div className="mt-4 p-2.5 rounded bg-surface num text-xs text-ink">
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
