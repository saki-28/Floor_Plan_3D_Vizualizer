/**
 * Project status (How it works): how much of the planned web app works today, by phase and work
 * item, from src/data/projectStatus.ts. This is for the team and examiners, so it lives apart
 * from the Studio, where people make plans.
 */

import React, { useState } from 'react';
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
import { PageHeader, Pill, type PillTone } from './ui';

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

export const ProjectStatus: React.FC = () => {
  const gapPhase = PHASES.find((phase) => phase.items.includes(BIGGEST_GAP)) ?? PHASES[0];
  const [phaseId, setPhaseId] = useState(gapPhase.id);
  const phase = PHASES.find((p) => p.id === phaseId) ?? PHASES[0];
  const percent = Math.round((MVP_DONE / MVP_WEIGHT) * 100);
  const gapShare = BIGGEST_GAP.weight * (1 - BIGGEST_GAP.done);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Project status"
        description={
          <>
            About {percent}% of the planned web app works today, estimated on {STATUS_DATE}. The biggest gap is{' '}
            {BIGGEST_GAP.name.toLowerCase()}, worth {Math.round(gapShare)}% of the plan.
          </>
        }
      />

      <section aria-labelledby="mvp-heading">
        <h2 id="mvp-heading" className="sr-only">
          Progress by phase
        </h2>
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

      <p className="text-[13px] text-muted">
        The original C++ desktop plan, its milestones and its never-compiled code are kept in the repository under{' '}
        <code className="text-ink">docs/</code>.
      </p>
    </div>
  );
};
