/**
 * Start (the Studio's first page): the three ways to get a plan into 3D, and the plan currently
 * open, shown as a live 3D model so the first screen shows what the app makes. How the system
 * works lives in the How it works area.
 */

import React from 'react';
import { Box, PencilRuler, ScanLine } from 'lucide-react';
import type { FloorPlanDataset } from '../types/floorplan';
import { PAGES, hrefOf, type Screen } from '../router';
import { planLabel } from '../utils/planLabel';
import { LinkButton, PageHeader } from './ui';

const WAYS_IN: { screen: Screen; title: string; text: string; action: string; icon: React.ReactNode }[] = [
  {
    screen: 'viewer3d',
    title: 'View a plan in 3D',
    text: 'Pick a sample or open a saved plan, then walk around it, measure it and export it as OBJ.',
    action: 'Open 3D viewer',
    icon: <Box className="h-4 w-4" strokeWidth={1.5} />,
  },
  {
    screen: 'imageLab',
    title: 'Turn an image into a plan',
    text: 'Upload a picture of a floor plan and the walls are found for you, step by step. Check them against the drawing, then fix anything in Edit plan.',
    action: 'Upload an image',
    icon: <ScanLine className="h-4 w-4" strokeWidth={1.5} />,
  },
  {
    screen: 'edit',
    title: 'Draw or edit a plan',
    text: 'Draw rooms and walls, add doors and windows, or fix any plan, with the 3D model updating beside it. Every step can be undone.',
    action: 'Edit plan',
    icon: <PencilRuler className="h-4 w-4" strokeWidth={1.5} />,
  },
];

const HOW_LINKS: [Screen, string][] = [
  ['pipeline', 'The steps that turn a plan image into walls, run on your image, with the maths behind each.'],
  ['results', 'How well walls are found on 400 real plans: hand-written rules against a trained network.'],
  ['graphics', 'Line drawing, the camera matrices, depth and shading behind the 3D viewer, to try out.'],
  ['about', 'What is new here and what is not, the limits, and the papers it builds on.'],
];

export const Start: React.FC<{ plan: FloorPlanDataset; preview: React.ReactNode }> = ({ plan, preview }) => {
  const floorArea = plan.rooms.reduce((sum, room) => sum + room.areaSqM, 0);
  const doors = plan.openings.filter((o) => o.kind === 'door').length;
  const windows = plan.openings.filter((o) => o.kind === 'window').length;
  const facts: [string, React.ReactNode][] = [
    ['Walls', plan.walls.length],
    ['Rooms', plan.rooms.length],
    ['Floor area', `${floorArea.toFixed(1)} m²`],
    ['Doors', doors],
    ['Windows', windows],
  ];

  return (
    <div className="flex flex-col gap-5 lg:h-full">
      <PageHeader
        title="Start"
        description="Turn a floor plan into a 3D model you can walk around: open a sample or a saved plan, upload an image of a plan, or draw your own."
      />

      <section aria-labelledby="ways-heading">
        <h2 id="ways-heading" className="sr-only">
          Ways in
        </h2>
        <ul className="grid gap-5 md:grid-cols-3">
          {WAYS_IN.map((way) => (
            <li key={way.title} className="flex flex-col gap-3 rounded-xl border border-line p-5">
              <span className="flex items-center gap-2.5 text-[16px] font-semibold">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-raised text-ink">{way.icon}</span>
                {way.title}
              </span>
              <p className="flex-1 text-[14px] leading-6 text-muted">{way.text}</p>
              <div>
                <LinkButton href={hrefOf(way.screen)} variant={way.screen === 'viewer3d' ? 'primary' : 'secondary'}>
                  {way.action}
                </LinkButton>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
        <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-line p-5 lg:min-h-0" aria-labelledby="plan-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="plan-heading" className="text-[16px] font-semibold">
              Open plan: {planLabel(plan)}
            </h2>
            <div className="flex flex-wrap gap-2">
              <LinkButton href={hrefOf('edit')}>Edit plan</LinkButton>
              <LinkButton href={hrefOf('viewer3d')} variant="primary">
                View in 3D
              </LinkButton>
            </div>
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[14px]">
            {facts.map(([label, value]) => (
              <div key={label} className="flex items-baseline gap-1.5">
                <dt className="text-muted">{label}</dt>
                <dd className="num font-medium text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="h-72 min-h-0 overflow-hidden rounded-lg lg:h-auto lg:flex-1">{preview}</div>
          <p className="text-[13px] text-muted">Drag to turn the model. Change the plan with the picker or Open at the top; edits are kept in this browser.</p>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-line p-5" aria-labelledby="how-heading">
          <h2 id="how-heading" className="text-[16px] font-semibold">
            How it works
          </h2>
          <ul className="flex flex-col gap-4 text-[14px]">
            {HOW_LINKS.map(([screen, text]) => (
              <li key={screen}>
                <a href={hrefOf(screen)} className="font-medium text-ink underline-offset-2 hover:underline">
                  {PAGES[screen].label}
                </a>
                <span className="mt-0.5 block leading-5 text-muted">{text}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
};
