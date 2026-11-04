/**
 * The current floor plan drawn from its own wall data, top-down, as the
 * product's signature: walls in ink at their real thickness, door openings cut
 * out, windows in the accent. Same orientation as the 3D top view (+x right, +z down).
 */

import React from 'react';
import type { Opening2D, WallSegment2D } from '../types/floorplan';
import { openingSpan, openingsOnWall } from '../utils/openings';

export const PlanThumbnail: React.FC<{
  walls: WallSegment2D[];
  openings?: Opening2D[];
  wallThickness?: number;
  className?: string;
  title: string;
}> = ({
  walls,
  openings = [],
  wallThickness,
  className = '',
  title,
}) => {
  if (walls.length === 0) {
    return <div className={`flex items-center justify-center text-xs text-muted ${className}`}>No walls</div>;
  }
  const xs = walls.flatMap((w) => [w.start.x, w.end.x]);
  const zs = walls.flatMap((w) => [w.start.z, w.end.z]);
  const pad = 0.6;
  const minX = Math.min(...xs) - pad;
  const minZ = Math.min(...zs) - pad;
  const width = Math.max(...xs) - Math.min(...xs) + 2 * pad;
  const height = Math.max(...zs) - Math.min(...zs) + 2 * pad;

  return (
    <svg viewBox={`${minX} ${minZ} ${width} ${height}`} className={className} role="img" aria-label={title}>
      {walls.map((wall) => {
        const dx = wall.end.x - wall.start.x;
        const dz = wall.end.z - wall.start.z;
        const length = Math.hypot(dx, dz);
        if (length < 1e-6) return null;
        const at = (s: number) => ({ x: wall.start.x + (dx * s) / length, z: wall.start.z + (dz * s) / length });
        const thickness = wallThickness ?? wall.thickness;
        const cut = (opening: Opening2D) => {
          const span = openingSpan(opening, length);
          const a = at(span.from);
          const b = at(span.to);
          const door = opening.kind === 'door';
          return (
            <line
              key={opening.id}
              x1={a.x}
              y1={a.z}
              x2={b.x}
              y2={b.z}
              stroke={door ? 'var(--raised)' : 'var(--accent)'}
              strokeWidth={thickness * (door ? 1.6 : 0.55)}
            />
          );
        };
        // Doors first, so a window beside a door stays visible.
        const wallOpenings = openingsOnWall(openings, wall.id).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'door' ? -1 : 1));
        return (
          <g key={wall.id}>
            <line
              x1={wall.start.x}
              y1={wall.start.z}
              x2={wall.end.x}
              y2={wall.end.z}
              stroke="var(--text)"
              strokeWidth={thickness}
              strokeLinecap="square"
            />
            {wallOpenings.map(cut)}
          </g>
        );
      })}
    </svg>
  );
};
