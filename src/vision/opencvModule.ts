/**
 * Static import of OpenCV.js, loaded lazily through opencv.ts.
 *
 * The OpenCV.js module object has a `then` method. Importing it dynamically
 * directly is unsafe: bundlers copy every property, `then` included, onto the
 * namespace that `import()` resolves to, and resolving a promise with that
 * thenable loops forever once the runtime is ready (the page freezes). Here
 * it is imported synchronously and exported inside a plain object.
 */

import * as opencvNamespace from '@techstark/opencv-js';

export const opencv = {
  module: ((opencvNamespace as unknown as { default?: unknown }).default ?? opencvNamespace) as unknown,
};
