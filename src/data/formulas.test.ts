import assert from 'node:assert/strict';
import { test } from 'node:test';
import katex from 'katex';
import { GRAPHICS_TEX, RESULTS_TEX, depthStep, depthValue, halfDepthDistance } from './formulas';

const render = (tex: string, displayMode: boolean) => katex.renderToString(tex, { displayMode, throwOnError: true, strict: 'ignore' });

test('every Results and Graphics formula typesets, including inline maths in the explanations', () => {
  for (const [name, tex] of Object.entries({ ...RESULTS_TEX, ...GRAPHICS_TEX })) {
    const parts = tex.split('$');
    if (parts.length === 1) {
      assert.doesNotThrow(() => render(tex, true), name);
      continue;
    }
    assert.equal(parts.length % 2, 1, `${name}: unbalanced $`);
    parts.forEach((part, i) => {
      if (i % 2 === 1) assert.doesNotThrow(() => render(part, false), `${name}: ${part}`);
    });
  }
});

test('the depth buffer runs from 0 at the near plane to 1 at the far plane, half used at 2fn/(f+n)', () => {
  const [near, far] = [0.1, 100];
  assert.ok(Math.abs(depthValue(near, near, far)) < 1e-12);
  assert.ok(Math.abs(depthValue(far, near, far) - 1) < 1e-12);
  assert.ok(Math.abs(depthValue(halfDepthDistance(near, far), near, far) - 0.5) < 1e-12);
  // One 24-bit step at 10 m, checked against the depth curve itself.
  const step = depthStep(10, near, far);
  assert.ok(Math.abs((depthValue(10 + step, near, far) - depthValue(10, near, far)) * 2 ** 24 - 1) < 1e-3);
});
