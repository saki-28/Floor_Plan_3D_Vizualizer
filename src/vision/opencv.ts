/**
 * Lazy OpenCV.js loader.
 * The library is ~11 MB (WASM embedded in JS), so it is imported dynamically
 * the first time a page needs it, and shared after that. Works in the browser
 * and in Node (tests, scripts).
 */

export type CV = typeof import('@techstark/opencv-js');

// The cv object is thenable, so it must never be awaited or returned bare from
// an async function: resolving a promise with it loops forever. It always
// travels inside a wrapper object (see also opencvModule.ts).
let loading: Promise<{ cv: CV }> | null = null;

export function loadOpenCv(): Promise<{ cv: CV }> {
  loading ??= (async () => {
    const { opencv } = await import('./opencvModule');
    const cvModule = opencv.module as CV & { onRuntimeInitialized?: () => void };
    if (cvModule instanceof Promise) {
      return { cv: (await cvModule) as CV };
    }
    // Embind classes such as Mat only exist once the WASM runtime has started.
    if (typeof cvModule.Mat !== 'function') {
      await new Promise<void>((resolve) => {
        cvModule.onRuntimeInitialized = () => resolve();
      });
    }
    return { cv: cvModule };
  })().catch((err) => {
    loading = null; // allow a retry
    throw err;
  });
  return loading;
}

/** OpenCV.js throws raw exception pointers (numbers); turn them into readable text. */
export function describeCvError(cv: CV | null, err: unknown): string {
  if (typeof err === 'number' && cv) {
    try {
      return (cv as unknown as { exceptionFromPtr(p: number): { msg: string } }).exceptionFromPtr(err).msg;
    } catch {
      return `OpenCV exception ${err}`;
    }
  }
  return err instanceof Error ? err.message : String(err);
}
