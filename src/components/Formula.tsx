/**
 * Mathematics typeset with KaTeX, so a formula reads as a formula instead of LaTeX source.
 * The output carries MathML as well, which screen readers read out. Only the How it works pages
 * use this, and they load on demand, so KaTeX stays out of the Studio's bundle.
 */

import katex from 'katex';
import 'katex/dist/katex.min.css';
import React, { useMemo } from 'react';

export function renderTex(tex: string, display: boolean): string {
  return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'htmlAndMathml', strict: 'ignore' });
}

/** Inline maths inside a sentence. */
export const Tex: React.FC<{ children: string }> = ({ children }) => {
  const html = useMemo(() => renderTex(children, false), [children]);
  // The TeX comes from this codebase's own constants, never from user input.
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
};

/** A sentence whose $…$ parts are maths. */
export const MathText: React.FC<{ children: string }> = ({ children }) => (
  <>{children.split('$').map((part, i) => (i % 2 === 1 ? <Tex key={i}>{part}</Tex> : part))}</>
);

/** A displayed formula on its own line; wide ones scroll sideways instead of overflowing the page. */
export const Formula: React.FC<{ tex: string; className?: string }> = ({ tex, className = '' }) => {
  const html = useMemo(() => renderTex(tex, true), [tex]);
  return <div className={`overflow-x-auto overflow-y-hidden text-ink [&_.katex-display]:my-2 ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
};
