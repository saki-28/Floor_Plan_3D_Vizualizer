/**
 * Overview: answers "how far is FloorPlan3D from its MVP, and what can I use
 * right now?". The biggest block is the MVP progress by phase; beside it, the
 * three ways into the product and the plan currently in scope.
 */

import React, { useState } from 'react';
import type { FloorPlanDataset } from '../types/floorplan';
import {
  BIGGEST_GAP,
  itemState,
  MVP_DONE,
  MVP_WEIGHT,
  PHASES,
  phaseDone,
  phaseWeight,
  STATUS_DATE,
  type ItemState,
} from '../data/projectStatus';
import { planLabel } from '../utils/planLabel';
import { PlanThumbnail } from './PlanThumbnail';
import type { Screen } from './AppShell';
import { Button, KeyValue, Pill, SectionTitle, type PillTone } from './ui';

const STATE_PILL: Record<ItemState, { tone: PillTone; label: string }> = {
  done: { tone: 'positive', label: 'Works' },
  'in-progress': { tone: 'warning', label: 'Partly' },
  'not-started': { tone: 'neutral', label: 'Not started' },
};

const fmt1 = (value: number) => value.toFixed(1);

/** A track as long as the whole, filled to the true ratio. */
const Track: React.FC<{ ratio: number; height?: string }> = ({ ratio, height = 'h-2' }) => (
  <div className={`w-full overflow-hidden rounded-full bg-raised ${height}`}>
    <div className={`${height} rounded-full bg-accent`} style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }} />
  </div>
);

const WAYS_IN: { screen: Screen | null; title: string; text: string; tone: PillTone; status: string }[] = [
  {
    screen: 'viewer3d',
    title: 'View a plan in 3D',
    text: 'Pick a plan, orbit it, measure it, export it as OBJ.',
    tone: 'positive',
    status: 'Works',
  },
  {
    screen: 'imageLab',
    title: 'Image to plan',
    text: 'Upload a floor plan image and see each processing step. Walls come next.',
    tone: 'warning',
    status: 'Steps 1–6',
  },
  {
    screen: null,
    title: 'Draw a plan',
    text: 'Draw walls on a grid with the 3D model updating beside them.',
    tone: 'neutral',
    status: 'Planned',
  },
];

export const Overview: React.FC<{ plan: FloorPlanDataset; onNavigate: (screen: Screen) => void }> = ({ plan, onNavigate }) => {
  const gapPhase = PHASES.find((phase) => phase.items.includes(BIGGEST_GAP)) ?? PHASES[0];
  const [phaseId, setPhaseId] = useState(gapPhase.id);
  const phase = PHASES.find((p) => p.id === phaseId) ?? PHASES[0];
  const percent = Math.round((MVP_DONE / MVP_WEIGHT) * 100);
  const gapShare = BIGGEST_GAP.weight * (1 - BIGGEST_GAP.done);

  const floorArea = plan.rooms.reduce((sum, room) => sum + room.areaSqM, 0);
  const doors = plan.openings.filter((o) => o.kind === 'door').length;
  const windows = plan.openings.filter((o) => o.kind === 'window').length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-7">Overview</h1>
          <p className="mt-1 text-muted">
            About {percent}% of the MVP works today. The biggest gap is {BIGGEST_GAP.name.toLowerCase()}, worth{' '}
            {Math.round(gapShare)}% of the MVP.
          </p>
        </div>
        <Button variant="primary" onClick={() => onNavigate('viewer3d')}>
          Open 3D viewer
        </Button>
      </header>

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
                <Button disabled={!way.screen} onClick={() => way.screen && onNavigate(way.screen)} aria-label={`Open ${way.title}`}>
                  {way.screen ? 'Open' : 'Not built yet'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-lg border border-line p-5" aria-labelledby="mvp-heading">
          <SectionTitle aside={<span className="text-xs text-muted">Estimated {STATUS_DATE}</span>}>
            <span id="mvp-heading">MVP progress</span>
          </SectionTitle>
          <div className="flex items-baseline gap-2">
            <span className="num text-[28px] leading-8">{percent}%</span>
            <span className="text-muted">
              of the MVP · <span className="num">{fmt1(MVP_DONE)}</span> of {MVP_WEIGHT} points
            </span>
          </div>
          <div className="mt-3">
            <Track ratio={MVP_DONE / MVP_WEIGHT} />
          </div>

          <div role="tablist" aria-label="Phases" className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
            {PHASES.map((p) => {
              const selected = p.id === phase.id;
              const done = phaseDone(p);
              const weight = phaseWeight(p);
              return (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setPhaseId(p.id)}
                  className={`rounded-md border px-3 py-2.5 text-left transition-colors ${
                    selected ? 'border-ink bg-raised' : 'border-line hover:bg-raised'
                  }`}
                >
                  <span className={`block text-[13px] ${selected ? 'font-medium text-ink' : 'text-muted'}`}>{p.name}</span>
                  <span className="num mt-0.5 block text-[16px] text-ink">
                    {fmt1(done)} <span className="text-[13px] text-muted">of {weight}</span>
                  </span>
                  <span className="mt-2 block">
                    <Track ratio={done / weight} height="h-1" />
                  </span>
                </button>
              );
            })}
          </div>

          <table className="mt-4 w-full text-[13px]">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-2 font-normal">Work item</th>
                <th className="hidden py-2 font-normal sm:table-cell">Status</th>
                <th className="py-2 text-right font-normal">MVP points</th>
              </tr>
            </thead>
            <tbody>
              {phase.items.map((item) => {
                const pill = STATE_PILL[itemState(item)];
                return (
                  <tr key={item.name} className="border-t border-rule align-top">
                    <td className="py-2.5 pr-4">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-ink">
                        {item.name}
                        <span className="sm:hidden">
                          <Pill tone={pill.tone}>{pill.label}</Pill>
                        </span>
                      </span>
                      <span className="block text-muted">{item.note}</span>
                    </td>
                    <td className="hidden py-2.5 pr-4 sm:table-cell">
                      <Pill tone={pill.tone}>{pill.label}</Pill>
                    </td>
                    <td className="num whitespace-nowrap py-2.5 text-right text-ink">
                      {fmt1(item.weight * item.done)} <span className="text-muted">of {item.weight}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="flex flex-col rounded-lg border border-line p-5" aria-labelledby="plan-heading">
            <SectionTitle>
              <span id="plan-heading">Current plan</span>
            </SectionTitle>
            <div className="flex min-h-48 flex-1 rounded-md bg-raised p-3">
              <PlanThumbnail walls={plan.walls} openings={plan.openings} className="h-full min-h-40 w-full" title={`Top-down drawing of ${planLabel(plan)}`} />
            </div>
            <p className="mt-3 text-[14px] font-medium">{planLabel(plan)}</p>
            <div className="mt-1">
              <KeyValue label="Walls">{plan.walls.length}</KeyValue>
              <KeyValue label="Rooms">{plan.rooms.length}</KeyValue>
              <KeyValue label="Floor area">
                {fmt1(floorArea)} <span className="text-muted">m²</span>
              </KeyValue>
              <KeyValue label="Doors / windows">
                {doors} / {windows}
              </KeyValue>
            </div>
        </section>
      </div>
    </div>
  );
};
