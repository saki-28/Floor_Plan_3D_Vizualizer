/**
 * The plan file: samples survive a save and an open unchanged; bare plans and the older per-wall
 * format open; broken or foreign files are refused with a reason a person can act on.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_FLOORPLANS } from './sampleFloorplans.ts';
import { PLAN_VERSION, PlanFileError, parsePlan, planFileName, samePlan, serializePlan } from './planFile.ts';

const sample = SAMPLE_FLOORPLANS[0];

test('[PlanFile] every sample saves and opens unchanged', () => {
  for (const plan of SAMPLE_FLOORPLANS) {
    const text = serializePlan(plan, new Date('2026-11-04T12:00:00Z'));
    const file = JSON.parse(text);
    assert.equal(file.format, 'floorplan3d-plan');
    assert.equal(file.version, PLAN_VERSION);
    assert.equal(file.savedAt, '2026-11-04T12:00:00.000Z');
    assert.deepStrictEqual(parsePlan(text), plan, plan.name);
    assert.ok(samePlan(parsePlan(text), plan));
  }
  assert.ok(SAMPLE_FLOORPLANS.every((p) => p.openings.length > 0), 'every sample has doors or windows');
});

test('[PlanFile] a bare plan and a plan in the older per-wall format both open', () => {
  assert.deepStrictEqual(parsePlan(JSON.stringify(sample)), sample);

  const legacy = {
    name: 'Old plan',
    walls: [
      { id: 'a', start: { x: 0, z: 0 }, end: { x: 5, z: 0 }, thickness: 0.2, height: 2.8, hasDoor: true, doorPosition: 0.3, doorWidth: 0.9 },
      { id: 'b', start: { x: 5, z: 0 }, end: { x: 5, z: 4 }, hasWindow: true },
    ],
  };
  const plan = parsePlan(JSON.stringify(legacy));
  assert.equal(plan.name, 'Old plan');
  assert.deepEqual(plan.walls[1], { id: 'b', start: { x: 5, z: 0 }, end: { x: 5, z: 4 }, thickness: 0.2, height: 2.8 }, 'defaults filled in');
  assert.deepEqual(
    plan.openings.map((o) => [o.kind, o.wallId, o.position]),
    [
      ['door', 'a', 0.3],
      ['window', 'b', 0.5],
    ],
  );
  assert.ok(plan.walls.every((w) => !('hasDoor' in w)));
  assert.deepEqual([plan.rooms, plan.furniture], [[], []]);
});

test('[PlanFile] broken and foreign files are refused with a reason', () => {
  const refused = (text: string, reason: RegExp) =>
    assert.throws(() => parsePlan(text), (e: unknown) => e instanceof PlanFileError && reason.test(e.message), String(reason));
  const file = (plan: unknown, extra: object = {}) => JSON.stringify({ format: 'floorplan3d-plan', version: 1, savedAt: '', plan, ...extra });

  refused('{ not json', /not valid JSON/);
  refused(JSON.stringify([1, 2]), /does not hold a plan/);
  refused(JSON.stringify({ format: 'something-else', plan: sample }), /not a FloorPlan3D plan file/);
  refused(file(sample, { version: PLAN_VERSION + 1 }), /version 2.*newer FloorPlan3D/);
  refused(file({ ...sample, walls: undefined }), /no list of walls/);
  refused(file({ ...sample, walls: [{ ...sample.walls[0], end: { x: 1 } }] }), /Wall 1 \("w_ext_n"\): its end point needs x and z/);
  refused(file({ ...sample, walls: [sample.walls[0], sample.walls[0]] }), /Two walls share the id "w_ext_n"/);
  refused(file({ ...sample, walls: [{ ...sample.walls[0], thickness: -1 }] }), /thickness must be a number above 0/);
  refused(file({ ...sample, openings: [{ ...sample.openings[0], wallId: 'nope' }] }), /on wall "nope", which the plan does not have/);
  refused(file({ ...sample, openings: [{ ...sample.openings[0], position: 1.5 }] }), /position must be a number from 0/);
  refused(file({ ...sample, openings: [{ ...sample.openings[0], kind: 'skylight' }] }), /kind must be "door" or "window"/);
  refused(file({ ...sample, rooms: [{ corners: [{ x: 0, z: 0 }] }] }), /Room 1 needs at least three corners/);
});

test('[PlanFile] file names come from the plan name', () => {
  assert.equal(planFileName(sample), 'two-bedroom-urban-suite.json');
  assert.equal(planFileName({ ...sample, name: '  ' }), 'plan.json');
});
