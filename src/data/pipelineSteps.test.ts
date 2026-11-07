import assert from 'node:assert/strict';
import { test } from 'node:test';
import katex from 'katex';
import { PIPELINE_STEPS } from './pipelineSteps';

const render = (tex: string, displayMode: boolean) => katex.renderToString(tex, { displayMode, throwOnError: true, strict: 'ignore' });

test('the Pipeline page explains steps 1 to 8 in order', () => {
  assert.deepEqual(
    PIPELINE_STEPS.map((step) => step.id),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
});

test('every formula and every bit of inline maths on the Pipeline page typesets', () => {
  for (const step of PIPELINE_STEPS) {
    assert.doesNotThrow(() => render(step.tex, true), `step ${step.id} formula`);
    const parts = step.symbols.split('$');
    assert.equal(parts.length % 2, 1, `step ${step.id}: unbalanced $ in the symbols text`);
    parts.forEach((part, i) => {
      if (i % 2 === 1) assert.doesNotThrow(() => render(part, false), `step ${step.id} inline maths: ${part}`);
    });
  }
});
