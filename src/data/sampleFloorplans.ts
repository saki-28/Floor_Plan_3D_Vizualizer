import { FloorPlanDataset } from '../types/floorplan';

export const SAMPLE_FLOORPLANS: FloorPlanDataset[] = [
  {
    id: 'apt-2bed',
    name: 'Sample 1: Two-Bedroom Urban Suite (P0 Benchmark)',
    description: 'Clean orthogonal floor plan with master bedroom, second bedroom, living room, and kitchen. Features interior doors and windows.',
    difficulty: 'Clean Orthogonal',
    widthPx: 800,
    heightPx: 600,
    scale: 0.015, // 1 pixel = 1.5 cm => 800px = 12m, 600px = 9m
    u0: 400,
    v0: 300,
    walls: [
      // Outer boundary (12m x 9m)
      { id: 'w_ext_n', name: 'North Exterior Wall', start: { x: -6.0, z: -4.5 }, end: { x: 6.0, z: -4.5 }, thickness: 0.3, height: 2.8},
      { id: 'w_ext_e', name: 'East Exterior Wall', start: { x: 6.0, z: -4.5 }, end: { x: 6.0, z: 4.5 }, thickness: 0.3, height: 2.8},
      { id: 'w_ext_s', name: 'South Exterior Wall', start: { x: 6.0, z: 4.5 }, end: { x: -6.0, z: 4.5 }, thickness: 0.3, height: 2.8},
      { id: 'w_ext_w', name: 'West Exterior Wall', start: { x: -6.0, z: 4.5 }, end: { x: -6.0, z: -4.5 }, thickness: 0.3, height: 2.8},

      // Interior dividing walls
      // Vertical divider separating living (west) from bedrooms (east)
      { id: 'w_int_v1', name: 'Living/Bedrooms Divider', start: { x: 0.5, z: -4.5 }, end: { x: 0.5, z: 1.5 }, thickness: 0.15, height: 2.8},
      // Horizontal divider separating Master Bed (north) from Bedroom 2 (south)
      { id: 'w_int_h1', name: 'Bedrooms Divider', start: { x: 0.5, z: 0.0 }, end: { x: 6.0, z: 0.0 }, thickness: 0.15, height: 2.8 },
      // Kitchen enclosure in south-west
      { id: 'w_int_k1', name: 'Kitchen Wall', start: { x: -6.0, z: 1.2 }, end: { x: -2.0, z: 1.2 }, thickness: 0.15, height: 2.8},
      { id: 'w_int_k2', name: 'Kitchen East Wall', start: { x: -2.0, z: 1.2 }, end: { x: -2.0, z: 4.5 }, thickness: 0.15, height: 2.8 },
      // Bathroom enclosure
      { id: 'w_int_b1', name: 'Bathroom North Wall', start: { x: 0.5, z: 2.2 }, end: { x: 3.5, z: 2.2 }, thickness: 0.15, height: 2.8},
      { id: 'w_int_b2', name: 'Bathroom West Wall', start: { x: 3.5, z: 2.2 }, end: { x: 3.5, z: 4.5 }, thickness: 0.15, height: 2.8 },
    ],
    openings: [
      { id: 'window-1', kind: 'window', wallId: 'w_ext_n', position: 0.3, width: 1.8, sill: 0.9, height: 1.4 },
      { id: 'window-2', kind: 'window', wallId: 'w_ext_e', position: 0.5, width: 2.0, sill: 0.9, height: 1.4 },
      { id: 'door-1', kind: 'door', wallId: 'w_ext_s', position: 0.8, width: 1.0, sill: 0, height: 2.1 },
      { id: 'window-3', kind: 'window', wallId: 'w_ext_w', position: 0.6, width: 1.5, sill: 0.9, height: 1.4 },
      { id: 'door-2', kind: 'door', wallId: 'w_int_v1', position: 0.75, width: 0.9, sill: 0, height: 2.1 },
      { id: 'door-3', kind: 'door', wallId: 'w_int_k1', position: 0.6, width: 0.9, sill: 0, height: 2.1 },
      { id: 'door-4', kind: 'door', wallId: 'w_int_b1', position: 0.5, width: 0.8, sill: 0, height: 2.1 },
    ],
    rooms: [
      {
        id: 'r_living',
        name: 'Living & Dining Room',
        color: '#3b82f6',
        corners: [{ x: -6.0, z: -4.5 }, { x: 0.5, z: -4.5 }, { x: 0.5, z: 1.2 }, { x: -2.0, z: 1.2 }, { x: -2.0, z: 4.5 }, { x: -6.0, z: 4.5 }],
        areaSqM: 32.5,
        type: 'living',
      },
      {
        id: 'r_master',
        name: 'Master Bedroom',
        color: '#10b981',
        corners: [{ x: 0.5, z: -4.5 }, { x: 6.0, z: -4.5 }, { x: 6.0, z: 0.0 }, { x: 0.5, z: 0.0 }],
        areaSqM: 24.75,
        type: 'bedroom',
      },
      {
        id: 'r_bed2',
        name: 'Guest Bedroom',
        color: '#b0788e',
        corners: [{ x: 0.5, z: 0.0 }, { x: 6.0, z: 0.0 }, { x: 6.0, z: 4.5 }, { x: 3.5, z: 4.5 }, { x: 3.5, z: 2.2 }, { x: 0.5, z: 2.2 }],
        areaSqM: 18.2,
        type: 'bedroom',
      },
      {
        id: 'r_kitchen',
        name: 'Kitchen',
        color: '#f59e0b',
        corners: [{ x: -6.0, z: 1.2 }, { x: -2.0, z: 1.2 }, { x: -2.0, z: 4.5 }, { x: -6.0, z: 4.5 }],
        areaSqM: 13.2,
        type: 'kitchen',
      },
      {
        id: 'r_bath',
        name: 'Bathroom',
        color: '#06b6d4',
        corners: [{ x: 0.5, z: 2.2 }, { x: 3.5, z: 2.2 }, { x: 3.5, z: 4.5 }, { x: 0.5, z: 4.5 }],
        areaSqM: 6.9,
        type: 'bathroom',
      },
    ],
    furniture: [
      { id: 'f_bed_master', name: 'King Bed', type: 'bed', position: [3.3, 0, -2.5], size: [2.0, 0.6, 2.1], rotationY: 0, color: '#64748b' },
      { id: 'f_bed_guest', name: 'Queen Bed', type: 'bed', position: [4.8, 0, 1.8], size: [1.6, 0.55, 2.0], rotationY: 90, color: '#64748b' },
      { id: 'f_sofa', name: 'Living Room Sofa', type: 'sofa', position: [-3.2, 0, -3.2], size: [2.6, 0.8, 0.95], rotationY: 0, color: '#475569' },
      { id: 'f_table', name: 'Dining Table', type: 'table', position: [-3.0, 0, -0.5], size: [1.8, 0.75, 1.0], rotationY: 0, color: '#94a3b8' },
    ],
  },
  {
    id: 'studio-loft',
    name: 'Sample 2: Open-Concept Studio Loft',
    description: 'Single-volume open space with partitioned washroom and balcony partition. Ideal for testing baseline extrusion and coordinate mapping.',
    difficulty: 'Clean Orthogonal',
    widthPx: 600,
    heightPx: 600,
    scale: 0.015,
    u0: 300,
    v0: 300,
    walls: [
      { id: 'w1', name: 'North Wall', start: { x: -4.0, z: -4.0 }, end: { x: 4.0, z: -4.0 }, thickness: 0.25, height: 2.7},
      { id: 'w2', name: 'East Wall', start: { x: 4.0, z: -4.0 }, end: { x: 4.0, z: 4.0 }, thickness: 0.25, height: 2.7 },
      { id: 'w3', name: 'South Wall', start: { x: 4.0, z: 4.0 }, end: { x: -4.0, z: 4.0 }, thickness: 0.25, height: 2.7},
      { id: 'w4', name: 'West Wall', start: { x: -4.0, z: 4.0 }, end: { x: -4.0, z: -4.0 }, thickness: 0.25, height: 2.7},
      // Enclosed bathroom corner
      { id: 'w5', name: 'Bathroom Partition 1', start: { x: 1.5, z: 4.0 }, end: { x: 1.5, z: 1.8 }, thickness: 0.15, height: 2.7},
      { id: 'w6', name: 'Bathroom Partition 2', start: { x: 1.5, z: 1.8 }, end: { x: 4.0, z: 1.8 }, thickness: 0.15, height: 2.7 },
    ],
    openings: [
      { id: 'window-1', kind: 'window', wallId: 'w1', position: 0.5, width: 2.4, sill: 0.8, height: 1.5 },
      { id: 'door-1', kind: 'door', wallId: 'w3', position: 0.3, width: 1.0, sill: 0, height: 2.1 },
      { id: 'window-2', kind: 'window', wallId: 'w4', position: 0.7, width: 1.6, sill: 0.8, height: 1.5 },
      { id: 'door-2', kind: 'door', wallId: 'w5', position: 0.5, width: 0.8, sill: 0, height: 2.1 },
    ],
    rooms: [
      {
        id: 'r_main',
        name: 'Studio Living & Bedroom',
        color: '#10b981',
        corners: [{ x: -4.0, z: -4.0 }, { x: 4.0, z: -4.0 }, { x: 4.0, z: 1.8 }, { x: 1.5, z: 1.8 }, { x: 1.5, z: 4.0 }, { x: -4.0, z: 4.0 }],
        areaSqM: 58.5,
        type: 'living',
      },
      {
        id: 'r_studio_bath',
        name: 'Bathroom',
        color: '#06b6d4',
        corners: [{ x: 1.5, z: 1.8 }, { x: 4.0, z: 1.8 }, { x: 4.0, z: 4.0 }, { x: 1.5, z: 4.0 }],
        areaSqM: 5.5,
        type: 'bathroom',
      },
    ],
    furniture: [
      { id: 'f_sbed', name: 'Queen Bed', type: 'bed', position: [-2.2, 0, -2.4], size: [1.7, 0.55, 2.1], rotationY: 0, color: '#64748b' },
      { id: 'f_sofa', name: 'Modular Sofa', type: 'sofa', position: [1.8, 0, -1.5], size: [2.2, 0.75, 0.9], rotationY: -90, color: '#475569' },
    ],
  },
  {
    id: 'bungalow-l',
    name: 'Sample 3: L-Shaped Residential Bungalow',
    description: 'Non-convex L-shaped floor plan. Tests non-trivial polygon triangulation, inner wall junctions, and exterior corner normal orientation.',
    difficulty: 'Moderate (Doors/Text)',
    widthPx: 800,
    heightPx: 700,
    scale: 0.018,
    u0: 400,
    v0: 350,
    walls: [
      { id: 'wl1', start: { x: -6.0, z: -5.0 }, end: { x: 1.0, z: -5.0 }, thickness: 0.3, height: 3.0},
      { id: 'wl2', start: { x: 1.0, z: -5.0 }, end: { x: 1.0, z: 0.0 }, thickness: 0.3, height: 3.0 },
      { id: 'wl3', start: { x: 1.0, z: 0.0 }, end: { x: 6.0, z: 0.0 }, thickness: 0.3, height: 3.0},
      { id: 'wl4', start: { x: 6.0, z: 0.0 }, end: { x: 6.0, z: 5.0 }, thickness: 0.3, height: 3.0},
      { id: 'wl5', start: { x: 6.0, z: 5.0 }, end: { x: -1.0, z: 5.0 }, thickness: 0.3, height: 3.0},
      { id: 'wl6', start: { x: -1.0, z: 5.0 }, end: { x: -1.0, z: 1.0 }, thickness: 0.3, height: 3.0 },
      { id: 'wl7', start: { x: -1.0, z: 1.0 }, end: { x: -6.0, z: 1.0 }, thickness: 0.3, height: 3.0 },
      { id: 'wl8', start: { x: -6.0, z: 1.0 }, end: { x: -6.0, z: -5.0 }, thickness: 0.3, height: 3.0},
    ],
    openings: [
      { id: 'window-1', kind: 'window', wallId: 'wl1', position: 0.5, width: 2.0, sill: 1.0, height: 1.5 },
      { id: 'window-2', kind: 'window', wallId: 'wl3', position: 0.5, width: 1.8, sill: 1.0, height: 1.5 },
      { id: 'window-3', kind: 'window', wallId: 'wl4', position: 0.5, width: 2.2, sill: 1.0, height: 1.5 },
      { id: 'door-1', kind: 'door', wallId: 'wl5', position: 0.5, width: 1.1, sill: 0, height: 2.1 },
      { id: 'window-4', kind: 'window', wallId: 'wl8', position: 0.4, width: 1.6, sill: 1.0, height: 1.5 },
    ],
    rooms: [
      {
        id: 'r_bungalow_main',
        name: 'Great Hall & Lounge',
        color: '#ec4899',
        corners: [
          { x: -6.0, z: -5.0 }, { x: 1.0, z: -5.0 }, { x: 1.0, z: 0.0 },
          { x: 6.0, z: 0.0 }, { x: 6.0, z: 5.0 }, { x: -1.0, z: 5.0 },
          { x: -1.0, z: 1.0 }, { x: -6.0, z: 1.0 }
        ],
        areaSqM: 67.0,
        type: 'living',
      },
    ],
    furniture: [
      { id: 'f_l_table', name: 'Banquet Table', type: 'table', position: [-2.5, 0, -2.0], size: [2.4, 0.78, 1.1], rotationY: 0, color: '#94a3b8' },
      { id: 'f_l_sofa', name: 'Curved Lounge', type: 'sofa', position: [2.5, 0, 2.5], size: [3.0, 0.82, 1.2], rotationY: 45, color: '#475569' },
    ],
  },
  {
    id: 'noisy-scan',
    name: 'Sample 4: Noisy Architectural Blueprint Scan',
    description: 'Realistic scanned floor plan with door swings, dimension lines (e.g. "3.50m"), and room labels. Shows how noise filtering isolates true wall lines.',
    difficulty: 'Complex (Noisy Scan)',
    widthPx: 800,
    heightPx: 600,
    scale: 0.015,
    u0: 400,
    v0: 300,
    walls: [
      { id: 'wn1', name: 'Exterior North', start: { x: -5.5, z: -4.0 }, end: { x: 5.5, z: -4.0 }, thickness: 0.3, height: 2.8},
      { id: 'wn2', name: 'Exterior East', start: { x: 5.5, z: -4.0 }, end: { x: 5.5, z: 4.0 }, thickness: 0.3, height: 2.8 },
      { id: 'wn3', name: 'Exterior South', start: { x: 5.5, z: 4.0 }, end: { x: -5.5, z: 4.0 }, thickness: 0.3, height: 2.8},
      { id: 'wn4', name: 'Exterior West', start: { x: -5.5, z: 4.0 }, end: { x: -5.5, z: -4.0 }, thickness: 0.3, height: 2.8},
      { id: 'wn5', name: 'Partition Wall', start: { x: 0.0, z: -4.0 }, end: { x: 0.0, z: 2.0 }, thickness: 0.15, height: 2.8},
    ],
    openings: [
      { id: 'window-1', kind: 'window', wallId: 'wn1', position: 0.4, width: 2.0, sill: 0.9, height: 1.4 },
      { id: 'door-1', kind: 'door', wallId: 'wn3', position: 0.25, width: 1.0, sill: 0, height: 2.1 },
      { id: 'window-2', kind: 'window', wallId: 'wn4', position: 0.5, width: 1.6, sill: 0.9, height: 1.4 },
      { id: 'door-2', kind: 'door', wallId: 'wn5', position: 0.8, width: 0.9, sill: 0, height: 2.1 },
    ],
    rooms: [
      { id: 'rn1', name: 'East Wing', color: '#5b8fb9', corners: [{ x: 0, z: -4.0 }, { x: 5.5, z: -4.0 }, { x: 5.5, z: 4.0 }, { x: 0, z: 4.0 }], areaSqM: 44.0, type: 'living' },
      { id: 'rn2', name: 'West Wing', color: '#14b8a6', corners: [{ x: -5.5, z: -4.0 }, { x: 0, z: -4.0 }, { x: 0, z: 4.0 }, { x: -5.5, z: 4.0 }], areaSqM: 44.0, type: 'bedroom' },
    ],
    furniture: [
      { id: 'fn1', name: 'Conference Desk', type: 'table', position: [2.5, 0, 0], size: [2.2, 0.75, 1.2], rotationY: 0, color: '#94a3b8' },
    ],
  },
];
