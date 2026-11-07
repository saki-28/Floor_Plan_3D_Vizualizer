import assert from 'node:assert/strict';
import { test } from 'node:test';
import results from './evaluationResults.json';

type Row = [string, number, number, number | null];
const rows = results.rows as Row[];
const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

test('the Results numbers cover every test plan once, for both methods', () => {
  assert.equal(rows.length, results.plans);
  assert.equal(new Set(rows.map((r) => r[0])).size, rows.length);
  for (const [, rules, model, openings] of rows) {
    for (const value of [rules, model, openings ?? 0]) assert.ok(value >= 0 && value <= 1);
  }
});

test('the per-plan rows agree with the summary figures shown at the top of Results', () => {
  assert.ok(Math.abs(mean(rows.map((r) => r[1])) - results.rules.meanIoU) < 1e-3);
  assert.ok(Math.abs(mean(rows.map((r) => r[2])) - results.model.meanIoU) < 1e-3);
  const openings = rows.flatMap((r) => (r[3] === null ? [] : [r[3]]));
  assert.ok(Math.abs(mean(openings) - (results.model.openingsIoU ?? 0)) < 1e-3);
});

test('the kept checkpoint is one of the validation points on the training curve', () => {
  assert.ok(results.training.curve.some((point) => point.step === results.model.checkpointStep));
});
