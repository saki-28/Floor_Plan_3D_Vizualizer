/**
 * Edit plan (Studio): draw and change walls, doors and windows on the 2D plan, with a live 3D
 * preview beside it and undo/redo. The drawing is an SVG in metres (x right, z down, as the 3D
 * top view), so walls are drawn at their real thickness and every click is snapped in metres:
 * to another wall's end, onto a wall (for a T junction), or to a 10 cm grid. Joined walls move
 * together (see utils/planEditing.ts).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppWindow,
  Box,
  DoorOpen,
  FilePlus2,
  Grid3x3,
  Maximize,
  MousePointer2,
  PenLine,
  Redo2,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { FloorPlanDataset, Opening2D, OpeningKind, Point2D, WallSegment2D } from '../types/floorplan';
import type { PlanContent } from '../data/planHistory';
import { hrefOf } from '../router';
import { distance2D } from '../utils/geometryEngine';
import { openingSpan, openingsOnWall } from '../utils/openings';
import {
  addWall,
  closestOnSegment,
  endsAt,
  fitPosition,
  moveWall,
  moveWallEnd,
  nearestWall,
  placeOpening,
  setWallLength,
  snapPoint,
  updateOpening,
  wallLength,
  type SnapKind,
  type WallEnd,
} from '../utils/planEditing';
import { Button, KeyValue, LinkButton, PageHeader, SectionTitle } from './ui';

type Tool = 'select' | 'wall' | 'door' | 'window';
type Selection = { kind: 'wall'; id: string } | { kind: 'opening'; id: string } | null;
interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

const GRID = 0.1; // metres
const SNAP_PX = 10; // how close (screen pixels) a wall end or wall catches the pointer
const DRAG_PX = 3; // movement before a press becomes a drag

const TOOLS: { id: Tool; label: string; key: string; icon: React.ReactNode }[] = [
  { id: 'select', label: 'Select', key: '1', icon: <MousePointer2 className="h-4 w-4" strokeWidth={1.5} /> },
  { id: 'wall', label: 'Wall', key: '2', icon: <PenLine className="h-4 w-4" strokeWidth={1.5} /> },
  { id: 'door', label: 'Door', key: '3', icon: <DoorOpen className="h-4 w-4" strokeWidth={1.5} /> },
  { id: 'window', label: 'Window', key: '4', icon: <AppWindow className="h-4 w-4" strokeWidth={1.5} /> },
];

const fmtM = (v: number) => `${v.toFixed(2)} m`;

/** The plan's extent with a margin, or a 10 × 8 m sheet around the origin for an empty plan. */
function fitView(walls: WallSegment2D[]): View {
  if (walls.length === 0) return { x: -5, y: -4, w: 10, h: 8 };
  const xs = walls.flatMap((w) => [w.start.x, w.end.x]);
  const zs = walls.flatMap((w) => [w.start.z, w.end.z]);
  const pad = 1.2;
  const x0 = Math.min(...xs) - pad;
  const z0 = Math.min(...zs) - pad;
  return { x: x0, y: z0, w: Math.max(...xs) - Math.min(...xs) + 2 * pad, h: Math.max(...zs) - Math.min(...zs) + 2 * pad };
}

type Drag =
  | { type: 'pan'; client: [number, number]; view: View; moved: boolean }
  | { type: 'end'; client: [number, number]; wallId: string; end: WallEnd; walls: WallSegment2D[]; key: string; moved: boolean }
  | { type: 'wall'; client: [number, number]; wallId: string; walls: WallSegment2D[]; from: Point2D; key: string; moved: boolean }
  | { type: 'opening'; client: [number, number]; id: string; offset: number; key: string; moved: boolean }
  | { type: 'click'; client: [number, number]; moved: boolean };

export const PlanEditor: React.FC<{
  plan: FloorPlanDataset;
  onEdit: (content: PlanContent, mergeKey?: string) => void;
  onSettle: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onRename: (name: string) => void;
  onNewPlan: () => void;
  /** The live 3D view shown beside the drawing. */
  preview: React.ReactNode;
}> = ({ plan, onEdit, onSettle, onUndo, onRedo, canUndo, canRedo, onRename, onNewPlan, preview }) => {
  const { walls, openings } = plan;
  const [tool, setTool] = useState<Tool>('select');
  const [selection, setSelection] = useState<Selection>(null);
  const [view, setView] = useState<View>(() => fitView(walls));
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [pointer, setPointer] = useState<{ point: Point2D; kind: SnapKind; raw: Point2D } | null>(null);
  const [chain, setChain] = useState<Point2D | null>(null); // the Wall tool's next start corner
  const [size, setSize] = useState({ w: 800, h: 600 });
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const dragSerial = useRef(0);
  const spaceHeld = useRef(false);

  // World units per screen pixel (the SVG keeps its aspect, so the larger ratio applies).
  const px = Math.max(view.w / size.w, view.h / size.h);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => setSize({ w: Math.max(1, entry.contentRect.width), h: Math.max(1, entry.contentRect.height) }));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  // Another plan opened: frame it and start clean.
  useEffect(() => {
    setView(fitView(plan.walls));
    setSelection(null);
    setChain(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id]);

  // A selection that no longer exists (after undo, say) is dropped.
  useEffect(() => {
    if (selection?.kind === 'wall' && !walls.some((w) => w.id === selection.id)) setSelection(null);
    if (selection?.kind === 'opening' && !openings.some((o) => o.id === selection.id)) setSelection(null);
  }, [walls, openings, selection]);

  const selectedWall = selection?.kind === 'wall' ? walls.find((w) => w.id === selection.id) ?? null : null;
  const selectedOpening = selection?.kind === 'opening' ? openings.find((o) => o.id === selection.id) ?? null : null;
  const openingWall = selectedOpening ? walls.find((w) => w.id === selectedOpening.wallId) ?? null : null;

  const toWorld = (clientX: number, clientY: number): Point2D => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return { x: 0, z: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, z: p.y };
  };

  const snapFor = (raw: Point2D, opts: { anchor?: Point2D | null; ortho?: boolean; skipEndsAt?: Point2D; skipWall?: string } = {}) => {
    const skip = opts.skipEndsAt ? new Set(endsAt(walls, opts.skipEndsAt).map((e) => `${e.wallId}:${e.end}`)) : new Set<string>();
    const ends: Point2D[] = [];
    for (const w of walls) {
      if (!skip.has(`${w.id}:start`)) ends.push(w.start);
      if (!skip.has(`${w.id}:end`)) ends.push(w.end);
    }
    const lines = walls
      .filter((w) => w.id !== opts.skipWall && !(opts.skipEndsAt && endsAt([w], opts.skipEndsAt).length))
      .map((w) => [w.start, w.end] as [Point2D, Point2D]);
    return snapPoint(raw, { grid: snapToGrid ? GRID : 0, ends, lines, radius: SNAP_PX * px, anchor: opts.anchor, ortho: opts.ortho });
  };

  const edit = (next: Partial<PlanContent>, mergeKey?: string) => onEdit({ walls: next.walls ?? walls, openings: next.openings ?? openings }, mergeKey);

  const deleteSelection = () => {
    if (selectedWall) edit({ walls: walls.filter((w) => w.id !== selectedWall.id) });
    else if (selectedOpening) edit({ openings: openings.filter((o) => o.id !== selectedOpening.id) });
    setSelection(null);
  };

  const zoomAt = (factor: number, centre?: Point2D) => {
    setView((v) => {
      const c = centre ?? { x: v.x + v.w / 2, z: v.y + v.h / 2 };
      const w = Math.min(200, Math.max(1, v.w * factor));
      const k = w / v.w;
      return { x: c.x - (c.x - v.x) * k, y: c.z - (c.z - v.y) * k, w, h: v.h * k };
    });
  };

  // Wheel zooms around the pointer (a native listener, so the page does not scroll).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(Math.exp(e.deltaY * 0.0015), toWorld(e.clientX, e.clientY));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  });

  // Keyboard: 1–4 tools, Esc stops or deselects, Delete removes, Cmd/Ctrl+Z undoes, F fits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) onRedo();
        else onUndo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        onRedo();
        return;
      }
      if (mod || e.altKey) return;
      const toolKey = TOOLS.find((tool) => tool.key === e.key);
      if (toolKey) {
        setTool(toolKey.id);
        setChain(null);
        return;
      }
      switch (e.key) {
        case 'Escape':
          if (chain) setChain(null);
          else if (tool !== 'select') setTool('select');
          else setSelection(null);
          return;
        case 'Delete':
        case 'Backspace':
          if (selection) {
            e.preventDefault();
            deleteSelection();
          }
          return;
        case 'f':
        case 'F':
          setView(fitView(walls));
          return;
        case '+':
        case '=':
          zoomAt(1 / 1.25);
          return;
        case '-':
          zoomAt(1.25);
          return;
        case ' ':
          spaceHeld.current = true;
          e.preventDefault();
          return;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') spaceHeld.current = false;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  });

  const nextKey = (what: string) => `${what}-${++dragSerial.current}`;

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button === 2) {
      setChain(null);
      return;
    }
    const client: [number, number] = [e.clientX, e.clientY];
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Not a live pointer (some pens and synthetic events): the drag still works while over the drawing.
    }
    if (e.button === 1 || spaceHeld.current) {
      drag.current = { type: 'pan', client, view, moved: false };
      return;
    }
    if (tool !== 'select') {
      drag.current = { type: 'click', client, moved: false };
      return;
    }
    const hit = (e.target as Element).closest<SVGElement>('[data-hit]');
    const world = toWorld(e.clientX, e.clientY);
    const kind = hit?.dataset.hit;
    if (kind === 'end' && hit?.dataset.wall) {
      setSelection({ kind: 'wall', id: hit.dataset.wall });
      drag.current = { type: 'end', client, wallId: hit.dataset.wall, end: hit.dataset.end as WallEnd, walls, key: nextKey('end'), moved: false };
    } else if (kind === 'opening' && hit?.dataset.opening) {
      const opening = openings.find((o) => o.id === hit.dataset.opening);
      const wall = opening && walls.find((w) => w.id === opening.wallId);
      setSelection({ kind: 'opening', id: hit.dataset.opening });
      if (opening && wall) {
        const t = closestOnSegment(wall.start, wall.end, world).t;
        drag.current = { type: 'opening', client, id: opening.id, offset: t - opening.position, key: nextKey('opening'), moved: false };
      }
    } else if (kind === 'wall' && hit?.dataset.wall) {
      setSelection({ kind: 'wall', id: hit.dataset.wall });
      drag.current = { type: 'wall', client, wallId: hit.dataset.wall, walls, from: world, key: nextKey('wall'), moved: false };
    } else {
      setSelection(null);
      drag.current = { type: 'pan', client, view, moved: false };
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const raw = toWorld(e.clientX, e.clientY);
    const d = drag.current;
    if (tool === 'wall') {
      const s = snapFor(raw, { anchor: chain, ortho: e.shiftKey });
      setPointer({ point: s.point, kind: s.kind, raw });
    } else if (tool === 'door' || tool === 'window') {
      setPointer({ point: raw, kind: 'free', raw });
    } else if (!d) {
      setPointer(null);
    }
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.client[0], e.clientY - d.client[1]) < DRAG_PX) return;
    d.moved = true;

    switch (d.type) {
      case 'pan': {
        const k = Math.max(d.view.w / size.w, d.view.h / size.h);
        setView({ ...d.view, x: d.view.x - (e.clientX - d.client[0]) * k, y: d.view.y - (e.clientY - d.client[1]) * k });
        return;
      }
      case 'end': {
        const wall = d.walls.find((w) => w.id === d.wallId);
        if (!wall) return;
        const other = d.end === 'start' ? wall.end : wall.start;
        const s = snapFor(raw, { anchor: other, ortho: e.shiftKey, skipEndsAt: wall[d.end] });
        setPointer({ point: s.point, kind: s.kind, raw });
        if (distance2D(s.point, other) > 0.05) edit({ walls: moveWallEnd(d.walls, d.wallId, d.end, s.point) }, d.key);
        return;
      }
      case 'wall': {
        let dx = raw.x - d.from.x;
        let dz = raw.z - d.from.z;
        if (e.shiftKey) {
          if (Math.abs(dx) >= Math.abs(dz)) dz = 0;
          else dx = 0;
        }
        if (snapToGrid) {
          dx = Math.round(dx / GRID) * GRID;
          dz = Math.round(dz / GRID) * GRID;
        }
        edit({ walls: moveWall(d.walls, d.wallId, { x: dx, z: dz }) }, d.key);
        return;
      }
      case 'opening': {
        const opening = openings.find((o) => o.id === d.id);
        const wall = opening && walls.find((w) => w.id === opening.wallId);
        if (!opening || !wall) return;
        const t = closestOnSegment(wall.start, wall.end, raw).t - d.offset;
        edit({ openings: updateOpening(openings, d.id, { position: fitPosition(t, opening.width, wallLength(wall)) }) }, d.key);
        return;
      }
      default:
        return;
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.moved) {
      if (d.type !== 'pan') onSettle();
      return;
    }
    if (d.type !== 'click') return;
    const raw = toWorld(e.clientX, e.clientY);
    if (tool === 'wall') {
      const s = snapFor(raw, { anchor: chain, ortho: e.shiftKey });
      if (!chain) setChain(s.point);
      else if (distance2D(chain, s.point) > 0.05) {
        const added = addWall(walls, chain, s.point);
        edit({ walls: added.walls });
        setSelection({ kind: 'wall', id: added.id });
        setChain(s.point);
      }
    } else if (tool === 'door' || tool === 'window') {
      const hit = nearestWall(walls, raw, Math.max(0.3, 14 * px));
      if (hit) {
        const placed = placeOpening(openings, hit.wall, tool, hit.t);
        edit({ openings: placed.openings });
        setSelection({ kind: 'opening', id: placed.id });
      }
    }
  };

  // The door or window the Door and Window tools would add where the pointer is.
  const ghost = useMemo(() => {
    if ((tool !== 'door' && tool !== 'window') || !pointer) return null;
    const hit = nearestWall(walls, pointer.raw, Math.max(0.3, 14 * px));
    if (!hit) return null;
    const placed = placeOpening(openings, hit.wall, tool, hit.t);
    return { wall: hit.wall, opening: placed.openings[placed.openings.length - 1] };
  }, [tool, pointer, walls, openings, px]);

  const help =
    tool === 'wall'
      ? chain
        ? 'Click to place the next corner. Double-click, right-click or Esc to stop. Hold Shift for a straight wall.'
        : 'Click where the wall starts. Corners snap to other walls’ ends, and to a wall’s side for a T junction.'
      : tool === 'door' || tool === 'window'
        ? `Click on a wall to add a ${tool} there. Drag it along the wall afterwards with Select.`
        : 'Click a wall, door or window to select it. Drag a wall’s round ends to reshape it, or the wall itself to move it. Drag empty space to pan; scroll to zoom.';

  const cursor = tool === 'select' ? (drag.current?.type === 'pan' ? 'grabbing' : 'default') : 'crosshair';
  const label = (p: Point2D, text: string, key: string) => (
    <text
      key={key}
      x={p.x}
      y={p.z}
      fontSize={12 * px}
      textAnchor="middle"
      dominantBaseline="middle"
      fill="var(--text)"
      stroke="var(--surface)"
      strokeWidth={3 * px}
      paintOrder="stroke"
      className="num pointer-events-none select-none"
    >
      {text}
    </text>
  );
  const along = (w: WallSegment2D, s: number): Point2D => {
    const L = wallLength(w) || 1;
    return { x: w.start.x + ((w.end.x - w.start.x) * s) / L, z: w.start.z + ((w.end.z - w.start.z) * s) / L };
  };
  const normalOf = (w: WallSegment2D): Point2D => {
    const L = wallLength(w) || 1;
    return { x: -(w.end.z - w.start.z) / L, z: (w.end.x - w.start.x) / L };
  };

  const drawOpening = (o: Opening2D, w: WallSegment2D, ghostly = false) => {
    const L = wallLength(w);
    const { from, to } = openingSpan(o, L);
    const a = along(w, from);
    const b = along(w, to);
    const n = normalOf(w);
    const stroke = ghostly ? 'var(--accent)' : 'var(--muted)';
    return (
      <g key={`${o.id}${ghostly ? '-ghost' : ''}`} opacity={ghostly ? 0.7 : 1} className="pointer-events-none">
        <line x1={a.x} y1={a.z} x2={b.x} y2={b.z} stroke="var(--surface)" strokeWidth={w.thickness * 1.04} />
        {o.kind === 'door' ? (
          <path
            d={`M ${a.x} ${a.z} L ${a.x + n.x * (to - from)} ${a.z + n.z * (to - from)} A ${to - from} ${to - from} 0 0 0 ${b.x} ${b.z}`}
            fill="none"
            stroke={stroke}
            strokeWidth={1.25 * px}
            strokeDasharray={ghostly ? `${4 * px} ${3 * px}` : undefined}
          />
        ) : (
          <>
            <line x1={a.x} y1={a.z} x2={b.x} y2={b.z} stroke="var(--accent)" strokeWidth={w.thickness * 0.45} />
            {[a, b].map((p, i) => (
              <line key={i} x1={p.x - (n.x * w.thickness) / 2} y1={p.z - (n.z * w.thickness) / 2} x2={p.x + (n.x * w.thickness) / 2} y2={p.z + (n.z * w.thickness) / 2} stroke="var(--text)" strokeWidth={1.25 * px} />
            ))}
          </>
        )}
      </g>
    );
  };

  const doors = openings.filter((o) => o.kind === 'door').length;
  const windows = openings.length - doors;

  return (
    <div className="flex min-h-full flex-col gap-4 lg:h-full">
      <PageHeader
        title="Edit plan"
        description="Draw and change walls, doors and windows. The 3D view beside the drawing updates as you go; Cmd or Ctrl + Z undoes."
        actions={
          <>
            <Button
              onClick={() => {
                if (walls.length === 0 || window.confirm('Start a new, empty plan? The current plan is replaced; save it first if you want to keep it.')) onNewPlan();
              }}
            >
              <FilePlus2 className="h-4 w-4" strokeWidth={1.5} />
              New plan
            </Button>
            <LinkButton href={hrefOf('viewer3d')} variant="primary">
              <Box className="h-4 w-4" strokeWidth={1.5} />
              View in 3D
            </LinkButton>
          </>
        }
      />

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="flex min-h-[520px] flex-col overflow-hidden rounded-lg border border-line lg:min-h-0" aria-label="Plan drawing">
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-2" role="toolbar" aria-label="Drawing tools">
            <div role="radiogroup" aria-label="Tool" className="inline-flex rounded-md border border-line bg-raised p-0.5">
              {TOOLS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={tool === t.id}
                  title={`${t.label} (${t.key})`}
                  onClick={() => {
                    setTool(t.id);
                    setChain(null);
                  }}
                  className={`inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[13px] transition-colors ${
                    tool === t.id ? 'bg-surface font-medium text-ink ring-1 ring-line' : 'text-muted hover:text-ink'
                  }`}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>
            <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
            <Button variant="ghost" onClick={onUndo} disabled={!canUndo} title="Undo (Cmd/Ctrl + Z)" aria-label="Undo">
              <Undo2 className="h-4 w-4" strokeWidth={1.5} />
            </Button>
            <Button variant="ghost" onClick={onRedo} disabled={!canRedo} title="Redo (Shift + Cmd/Ctrl + Z)" aria-label="Redo">
              <Redo2 className="h-4 w-4" strokeWidth={1.5} />
            </Button>
            <Button variant="ghost" onClick={deleteSelection} disabled={!selection} title="Delete the selection (Delete)" aria-label="Delete the selection">
              <Trash2 className="h-4 w-4" strokeWidth={1.5} />
            </Button>
            <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
            <Button variant="ghost" aria-pressed={snapToGrid} onClick={() => setSnapToGrid((v) => !v)} title="Snap corners to a 10 cm grid">
              <Grid3x3 className="h-4 w-4" strokeWidth={1.5} />
              Grid
            </Button>
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" onClick={() => zoomAt(1.25)} title="Zoom out (−)" aria-label="Zoom out">
                <ZoomOut className="h-4 w-4" strokeWidth={1.5} />
              </Button>
              <Button variant="ghost" onClick={() => zoomAt(1 / 1.25)} title="Zoom in (+)" aria-label="Zoom in">
                <ZoomIn className="h-4 w-4" strokeWidth={1.5} />
              </Button>
              <Button variant="ghost" onClick={() => setView(fitView(walls))} title="Fit the plan (F)" aria-label="Fit the plan">
                <Maximize className="h-4 w-4" strokeWidth={1.5} />
              </Button>
            </div>
          </div>

          <div ref={boxRef} className="relative min-h-0 flex-1 bg-surface">
            <svg
              ref={svgRef}
              viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
              className="absolute inset-0 h-full w-full touch-none select-none"
              style={{ cursor }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onPointerLeave={() => !drag.current && setPointer(null)}
              onDoubleClick={() => setChain(null)}
              onContextMenu={(e) => e.preventDefault()}
              role="application"
              aria-label={`Plan drawing of ${plan.name}: ${walls.length} walls, ${doors} doors, ${windows} windows`}
            >
              <defs>
                <pattern id="edit-grid-minor" width={0.5} height={0.5} patternUnits="userSpaceOnUse">
                  <path d="M 0.5 0 L 0 0 0 0.5" fill="none" stroke="var(--rule)" strokeWidth={px} />
                </pattern>
                <pattern id="edit-grid" width={1} height={1} patternUnits="userSpaceOnUse">
                  <rect width={1} height={1} fill="url(#edit-grid-minor)" />
                  <path d="M 1 0 L 0 0 0 1" fill="none" stroke="var(--border)" strokeWidth={px} />
                </pattern>
              </defs>
              <rect x={view.x - view.w} y={view.y - view.h} width={view.w * 3} height={view.h * 3} fill="url(#edit-grid)" />

              {plan.rooms.map((r) => (
                <polygon key={r.id} points={r.corners.map((c) => `${c.x},${c.z}`).join(' ')} fill="var(--raised)" className="pointer-events-none" />
              ))}

              {walls.map((w) => (
                <line key={w.id} x1={w.start.x} y1={w.start.z} x2={w.end.x} y2={w.end.z} stroke="var(--text)" strokeWidth={w.thickness} strokeLinecap="square" className="pointer-events-none" />
              ))}
              {walls.map((w) => openingsOnWall(openings, w.id).map((o) => drawOpening(o, w)))}

              {/* Hit areas, wider than thin walls so they are easy to catch. */}
              {tool === 'select' &&
                walls.map((w) => (
                  <line
                    key={`hit-${w.id}`}
                    data-hit="wall"
                    data-wall={w.id}
                    x1={w.start.x}
                    y1={w.start.z}
                    x2={w.end.x}
                    y2={w.end.z}
                    stroke="transparent"
                    strokeWidth={Math.max(w.thickness, 14 * px)}
                    style={{ cursor: 'move' }}
                  />
                ))}
              {tool === 'select' &&
                openings.map((o) => {
                  const w = walls.find((x) => x.id === o.wallId);
                  if (!w) return null;
                  const { from, to } = openingSpan(o, wallLength(w));
                  const a = along(w, from);
                  const b = along(w, to);
                  return (
                    <line
                      key={`hit-${o.id}`}
                      data-hit="opening"
                      data-opening={o.id}
                      x1={a.x}
                      y1={a.z}
                      x2={b.x}
                      y2={b.z}
                      stroke="transparent"
                      strokeWidth={Math.max(w.thickness, 16 * px)}
                      style={{ cursor: 'ew-resize' }}
                    />
                  );
                })}

              {selectedWall && (
                <g>
                  <line
                    x1={selectedWall.start.x}
                    y1={selectedWall.start.z}
                    x2={selectedWall.end.x}
                    y2={selectedWall.end.z}
                    stroke="var(--accent)"
                    strokeWidth={selectedWall.thickness}
                    strokeLinecap="square"
                    opacity={0.85}
                    className="pointer-events-none"
                  />
                  {label(
                    {
                      x: (selectedWall.start.x + selectedWall.end.x) / 2 + normalOf(selectedWall).x * (selectedWall.thickness / 2 + 14 * px),
                      z: (selectedWall.start.z + selectedWall.end.z) / 2 + normalOf(selectedWall).z * (selectedWall.thickness / 2 + 14 * px),
                    },
                    fmtM(wallLength(selectedWall)),
                    'len',
                  )}
                  {tool === 'select' &&
                    (['start', 'end'] as const).map((end) => (
                      <circle
                        key={end}
                        data-hit="end"
                        data-wall={selectedWall.id}
                        data-end={end}
                        cx={selectedWall[end].x}
                        cy={selectedWall[end].z}
                        r={6 * px}
                        fill="var(--surface)"
                        stroke="var(--accent)"
                        strokeWidth={2 * px}
                        style={{ cursor: 'grab' }}
                      />
                    ))}
                </g>
              )}

              {selectedOpening && openingWall && (() => {
                const { from, to } = openingSpan(selectedOpening, wallLength(openingWall));
                const a = along(openingWall, from);
                const b = along(openingWall, to);
                const n = normalOf(openingWall);
                return (
                  <g className="pointer-events-none">
                    <line x1={a.x} y1={a.z} x2={b.x} y2={b.z} stroke="var(--accent)" strokeWidth={openingWall.thickness * 1.5} opacity={0.6} />
                    {label(
                      { x: (a.x + b.x) / 2 + n.x * (openingWall.thickness / 2 + 14 * px), z: (a.z + b.z) / 2 + n.z * (openingWall.thickness / 2 + 14 * px) },
                      fmtM(selectedOpening.width),
                      'opening-width',
                    )}
                  </g>
                );
              })()}

              {ghost && drawOpening(ghost.opening, ghost.wall, true)}

              {tool === 'wall' && pointer && (
                <g className="pointer-events-none">
                  {chain && (
                    <>
                      <line
                        x1={chain.x}
                        y1={chain.z}
                        x2={pointer.point.x}
                        y2={pointer.point.z}
                        stroke="var(--accent)"
                        strokeWidth={Math.max(2 * px, walls.length ? addWall(walls, chain, pointer.point).walls.at(-1)!.thickness : 0.2)}
                        strokeLinecap="square"
                        opacity={0.5}
                      />
                      {distance2D(chain, pointer.point) > 0.05 &&
                        label({ x: (chain.x + pointer.point.x) / 2, z: (chain.z + pointer.point.z) / 2 - 16 * px }, fmtM(distance2D(chain, pointer.point)), 'draw-len')}
                      <circle cx={chain.x} cy={chain.z} r={4 * px} fill="var(--accent)" />
                    </>
                  )}
                  <circle cx={pointer.point.x} cy={pointer.point.z} r={4 * px} fill="var(--accent)" />
                  {pointer.kind !== 'grid' && pointer.kind !== 'free' && (
                    <circle cx={pointer.point.x} cy={pointer.point.z} r={9 * px} fill="none" stroke="var(--accent)" strokeWidth={1.5 * px} />
                  )}
                </g>
              )}
            </svg>

            {walls.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-[14px] text-muted">
                <p className="max-w-sm">An empty plan. Pick the Wall tool (2) and click to place the first corner; each click adds the next wall.</p>
              </div>
            )}
          </div>
          <p className="border-t border-line px-3 py-2 text-xs text-muted" aria-live="polite">
            {help}
          </p>
        </section>

        <aside className="flex min-h-0 flex-col gap-4 lg:overflow-y-auto" aria-label="Selection and 3D preview">
          <section className="rounded-lg border border-line p-4">
            {selectedWall ? (
              <WallPanel
                wall={selectedWall}
                openings={openingsOnWall(openings, selectedWall.id)}
                onLength={(length) => edit({ walls: setWallLength(walls, selectedWall.id, length) }, `length-${selectedWall.id}`)}
                onAdd={(kind) => {
                  const placed = placeOpening(openings, selectedWall, kind, 0.5);
                  edit({ openings: placed.openings });
                  setSelection({ kind: 'opening', id: placed.id });
                }}
                onPick={(id) => setSelection({ kind: 'opening', id })}
                onDelete={deleteSelection}
                onSettle={onSettle}
              />
            ) : selectedOpening && openingWall ? (
              <OpeningPanel
                opening={selectedOpening}
                wall={openingWall}
                onChange={(fields) => edit({ openings: updateOpening(openings, selectedOpening.id, fields, openingWall) }, `opening-${selectedOpening.id}-${Object.keys(fields).join()}`)}
                onWall={() => setSelection({ kind: 'wall', id: openingWall.id })}
                onDelete={deleteSelection}
                onSettle={onSettle}
              />
            ) : (
              <>
                <SectionTitle>Plan</SectionTitle>
                <label className="block text-[13px]">
                  <span className="text-muted">Name</span>
                  <input
                    value={plan.name}
                    onChange={(e) => onRename(e.target.value)}
                    className="mt-1 h-8 w-full rounded-md border border-control bg-surface px-2 text-[13px] text-ink"
                  />
                </label>
                <div className="mt-2">
                  <KeyValue label="Walls">{walls.length}</KeyValue>
                  <KeyValue label="Doors">{doors}</KeyValue>
                  <KeyValue label="Windows">{windows}</KeyValue>
                </div>
                <p className="mt-2 text-xs text-muted">Select a wall, door or window to change it. Keys: 1 Select · 2 Wall · 3 Door · 4 Window · Delete · F fit.</p>
              </>
            )}
          </section>

          <section className="flex flex-col rounded-lg border border-line p-4">
            <SectionTitle>3D preview</SectionTitle>
            <div className="h-64">{preview}</div>
          </section>
        </aside>
      </div>
    </div>
  );
};

/** A number field in metres that edits as you type, with the edit ending (one undo step) on blur. */
const MetreField: React.FC<{ label: string; value: number; min: number; max?: number; step?: number; onChange: (v: number) => void; onSettle: () => void }> = ({
  label,
  value,
  min,
  max,
  step = 0.05,
  onChange,
  onSettle,
}) => {
  const [text, setText] = useState(value.toFixed(2));
  const focused = useRef(false);
  // Follow outside changes (a drag, undo), but never rewrite what is being typed.
  useEffect(() => {
    if (!focused.current) setText(value.toFixed(2));
  }, [value]);
  return (
    <label className="flex h-9 items-center justify-between gap-3 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= min && (max === undefined || v <= max)) onChange(v);
          }}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            setText(value.toFixed(2));
            onSettle();
          }}
          className="num h-8 w-24 rounded-md border border-control bg-surface px-2 text-right text-[13px] text-ink"
        />
        <span className="text-muted">m</span>
      </span>
    </label>
  );
};

const WallPanel: React.FC<{
  wall: WallSegment2D;
  openings: Opening2D[];
  onLength: (length: number) => void;
  onAdd: (kind: OpeningKind) => void;
  onPick: (id: string) => void;
  onDelete: () => void;
  onSettle: () => void;
}> = ({ wall, openings, onLength, onAdd, onPick, onDelete, onSettle }) => (
  <>
    <SectionTitle aside={<span className="text-xs text-muted">{wall.name ?? wall.id}</span>}>Wall</SectionTitle>
    <MetreField label="Length" value={wallLength(wall)} min={0.1} max={100} onChange={onLength} onSettle={onSettle} />
    <KeyValue label="Thickness">{fmtM(wall.thickness)}</KeyValue>
    <div className="mt-3">
      <p className="text-[13px] text-muted">Doors and windows</p>
      {openings.length === 0 ? (
        <p className="mt-1 text-[13px] text-muted">None on this wall.</p>
      ) : (
        <ul className="mt-1 flex flex-col">
          {openings.map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => onPick(o.id)} className="flex h-8 w-full items-center justify-between rounded-md px-2 text-[13px] text-ink hover:bg-raised">
                <span className="capitalize">{o.kind}</span>
                <span className="num text-muted">{fmtM(o.width)} wide</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      <Button onClick={() => onAdd('door')}>
        <DoorOpen className="h-4 w-4" strokeWidth={1.5} />
        Add door
      </Button>
      <Button onClick={() => onAdd('window')}>
        <AppWindow className="h-4 w-4" strokeWidth={1.5} />
        Add window
      </Button>
      <Button variant="ghost" onClick={onDelete}>
        <Trash2 className="h-4 w-4" strokeWidth={1.5} />
        Delete wall
      </Button>
    </div>
  </>
);

const OpeningPanel: React.FC<{
  opening: Opening2D;
  wall: WallSegment2D;
  onChange: (fields: Partial<Omit<Opening2D, 'id' | 'wallId'>>) => void;
  onWall: () => void;
  onDelete: () => void;
  onSettle: () => void;
}> = ({ opening, wall, onChange, onWall, onDelete, onSettle }) => {
  const L = wallLength(wall);
  const { from } = openingSpan(opening, L);
  return (
    <>
      <SectionTitle
        aside={
          <button type="button" onClick={onWall} className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
            On {wall.name ?? wall.id}
          </button>
        }
      >
        {opening.kind === 'door' ? 'Door' : 'Window'}
      </SectionTitle>
      <div role="radiogroup" aria-label="Kind" className="mb-2 inline-flex rounded-md border border-line bg-raised p-0.5">
        {(['door', 'window'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={opening.kind === kind}
            onClick={() => kind !== opening.kind && onChange({ kind })}
            className={`inline-flex h-7 items-center rounded-[5px] px-3 text-[13px] capitalize ${
              opening.kind === kind ? 'bg-surface font-medium text-ink ring-1 ring-line' : 'text-muted hover:text-ink'
            }`}
          >
            {kind}
          </button>
        ))}
      </div>
      <MetreField label="Width" value={opening.width} min={0.3} max={Math.max(0.3, L)} onChange={(width) => onChange({ width })} onSettle={onSettle} />
      <MetreField
        label="From the wall start"
        value={from}
        min={0}
        max={Math.max(0, L - opening.width)}
        onChange={(start) => onChange({ position: (start + Math.min(opening.width, L) / 2) / L })}
        onSettle={onSettle}
      />
      {opening.kind === 'window' && <MetreField label="Sill height" value={opening.sill} min={0} max={wall.height} onChange={(sill) => onChange({ sill })} onSettle={onSettle} />}
      <MetreField label="Height" value={opening.height} min={0.3} max={wall.height} onChange={(height) => onChange({ height })} onSettle={onSettle} />
      <div className="mt-3">
        <Button variant="ghost" onClick={onDelete}>
          <Trash2 className="h-4 w-4" strokeWidth={1.5} />
          Delete {opening.kind}
        </Button>
      </div>
    </>
  );
};
