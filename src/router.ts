/**
 * Page addresses. Every screen has its own hash URL, so the browser's back button works, a reload
 * stays on the same page, and a page (the pipeline, say) can be opened in its own browser tab or
 * sent as a link. Pages fall into two areas: the Studio, where a plan is made and viewed, and
 * How it works, which explains the system for curious users and examiners.
 */

import { useEffect, useState } from 'react';

export type Screen = 'start' | 'imageLab' | 'edit' | 'viewer3d' | 'pipeline' | 'results' | 'graphics' | 'about';
export type Area = 'studio' | 'how';

export interface PageInfo {
  area: Area;
  path: string;
  label: string;
}

export const PAGES: Record<Screen, PageInfo> = {
  start: { area: 'studio', path: '/', label: 'Start' },
  imageLab: { area: 'studio', path: '/image', label: 'Image to plan' },
  edit: { area: 'studio', path: '/edit', label: 'Edit plan' },
  viewer3d: { area: 'studio', path: '/3d', label: '3D viewer' },
  pipeline: { area: 'how', path: '/how/pipeline', label: 'Pipeline' },
  results: { area: 'how', path: '/how/results', label: 'Results' },
  graphics: { area: 'how', path: '/how/graphics', label: 'Graphics' },
  about: { area: 'how', path: '/how/about', label: 'About' },
};

export const AREA_LABELS: Record<Area, string> = { studio: 'Studio', how: 'How it works' };


export const hrefOf = (screen: Screen) => `#${PAGES[screen].path}`;

export function screenFromHash(hash: string): Screen {
  const path = hash.replace(/^#/, '') || '/';
  const match = (Object.keys(PAGES) as Screen[]).find((s) => PAGES[s].path === path);
  return match ?? 'start';
}

/** The current page, following the URL; navigate() changes the URL like a link would. */
export function useScreen(): [Screen, (screen: Screen) => void] {
  const [screen, setScreen] = useState<Screen>(() => screenFromHash(window.location.hash));

  useEffect(() => {
    const onHash = () => setScreen(screenFromHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.title = screen === 'start' ? 'FloorPlan3D' : `${PAGES[screen].label} – FloorPlan3D`;
  }, [screen]);

  const navigate = (next: Screen) => {
    if (hrefOf(next) !== window.location.hash) window.location.hash = PAGES[next].path;
    else setScreen(next);
  };
  return [screen, navigate];
}
