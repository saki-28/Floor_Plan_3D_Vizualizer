/**
 * Start (the Studio's first page): the ways to get a plan into 3D, and the plan currently open.
 * How the system works, and how far along the project is, live in the How it works area.
 */

import React from 'react';
import type { FloorPlanDataset } from '../types/floorplan';
import { PAGES, hrefOf, type Screen } from '../router';
import { planLabel } from '../utils/planLabel';
import { PlanThumbnail } from './PlanThumbnail';
import { KeyValue, LinkButton, PageHeader, Pill, SectionTitle, type PillTone } from './ui';

const WAYS_IN: { screen: Screen | null; title: string; text: string; tone: PillTone; status: string; action: string }[] = [
  {
    screen: 'viewer3d',
    title: 'View a plan in 3D',
    text: 'Pick a sample or open a saved plan, then orbit it, measure it and export it as OBJ.',
    tone: 'positive',
    status: 'Works',
    action: 'Open 3D viewer',
  },
  {
    screen: 'imageLab',
    title: 'Image to plan',
    text: 'Upload an image of a floor plan and see each step find its walls. Works best on clean drawings with solid walls.',
    tone: 'warning',
    status: 'Partly',
    action: 'Upload an image',
  },
  {
    screen: 'edit',
    title: 'Draw or edit a plan',
    text: 'Draw walls, add doors and windows, or fix any plan, with the 3D model updating beside it. Every step can be undone.',
    tone: 'positive',
    status: 'Works',
    action: 'Edit plan',
  },
];

const HOW_LINKS: [Screen, string][] = [
  ['pipeline', 'The steps that turn a plan image into walls, run on your image, with the maths behind each.'],
  ['results', 'How well walls are found on 400 real plans: hand-written rules against a trained network.'],
  ['graphics', 'Line drawing, the camera matrices, depth and shading behind the 3D viewer, to try out.'],
  ['about', 'What is new here and what is not, the limits, and the papers it builds on.'],
];

export const Start: React.FC<{ plan: FloorPlanDataset }> = ({ plan }) => {
  const floorArea = plan.rooms.reduce((sum, room) => sum + room.areaSqM, 0);
  const doors = plan.openings.filter((o) => o.kind === 'door').length;
  const windows = plan.openings.filter((o) => o.kind === 'window').length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Start"
        description="Turn a floor plan into a 3D model you can walk around: open a sample or a saved plan, upload an image of a plan, or draw your own."
      />

      <section aria-labelledby="ways-heading">
        <h2 id="ways-heading" className="sr-only">
          Ways in
        </h2>
        <ul className="grid gap-6 md:grid-cols-3">
          {WAYS_IN.map((way) => (
            <li key={way.title} className="flex flex-col gap-3 rounded-lg border border-line p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-semibold">{way.title}</span>
                <Pill tone={way.tone}>{way.status}</Pill>
              </div>
              <p className="flex-1 text-[13px] text-muted">{way.text}</p>
              <div>
                {way.screen ? (
                  <LinkButton href={hrefOf(way.screen)} variant={way.screen === 'viewer3d' ? 'primary' : 'secondary'}>
                    {way.action}
                  </LinkButton>
                ) : (
                  <span className="inline-flex h-8 items-center rounded-md border border-line px-3 text-[13px] text-muted">{way.action}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="flex flex-col rounded-lg border border-line p-5" aria-labelledby="plan-heading">
          <SectionTitle aside={<LinkButton href={hrefOf('viewer3d')}>View in 3D</LinkButton>}>
            <span id="plan-heading">Open plan: {planLabel(plan)}</span>
          </SectionTitle>
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_200px]">
            <div className="flex min-h-48 rounded-md bg-raised p-3">
              <PlanThumbnail walls={plan.walls} openings={plan.openings} className="h-full min-h-40 w-full" title={`Top-down drawing of ${planLabel(plan)}`} />
            </div>
            <div>
              <KeyValue label="Walls">{plan.walls.length}</KeyValue>
              <KeyValue label="Rooms">{plan.rooms.length}</KeyValue>
              <KeyValue label="Floor area">
                {floorArea.toFixed(1)} <span className="text-muted">m²</span>
              </KeyValue>
              <KeyValue label="Doors">{doors}</KeyValue>
              <KeyValue label="Windows">{windows}</KeyValue>
              <p className="mt-2 text-xs text-muted">Change it with the plan picker or Open at the top. Edits are kept in this browser.</p>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-line p-5" aria-labelledby="how-heading">
          <SectionTitle>
            <span id="how-heading">How it works</span>
          </SectionTitle>
          <ul className="flex flex-col gap-3 text-[13px]">
            {HOW_LINKS.map(([screen, text]) => (
              <li key={screen}>
                <a href={hrefOf(screen)} className="font-medium text-ink underline-offset-2 hover:underline">
                  {PAGES[screen].label}
                </a>
                <span className="block text-muted">{text}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
};
