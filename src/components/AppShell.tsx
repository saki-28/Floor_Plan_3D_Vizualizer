/**
 * The app frame (framed-sheet style). One sidebar lists every page in two groups: the Studio,
 * where a plan is made and viewed, and How it works, which explains the system. Collapsed, it is
 * a narrow rail that still shows each page's icon and a short label (hidden navigation is used
 * about half as often on desktops, NN/g 2016); a click expands it to full names, and the choice is
 * remembered. Every page is a link (see router.ts), so it can open in its own browser tab.
 * On a phone the frame folds into a top bar and a menu sheet.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  ChartColumn,
  Download,
  FolderOpen,
  House,
  Info,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PencilRuler,
  ScanLine,
  Shapes,
  Sun,
  Workflow,
  X,
} from 'lucide-react';
import type { FloorPlanDataset } from '../types/floorplan';
import { SAMPLE_FLOORPLANS } from '../data/sampleFloorplans';
import { planLabel } from '../utils/planLabel';
import { parsePlan, planFileName, serializePlan } from '../data/planFile';
import { AREA_LABELS, PAGES, hrefOf, type Area, type Screen } from '../router';
import type { Theme } from '../theme';
import { Button, Segmented } from './ui';

interface NavItem {
  id: Screen;
  label: string;
  /** The label under the icon in the collapsed rail. */
  short: string;
  icon: React.ReactNode;
}

const ICON = 'h-[18px] w-[18px] shrink-0';

/** The pages of each area, in the order a person uses them. */
const NAV: Record<Area, NavItem[]> = {
  studio: [
    { id: 'start', label: 'Start', short: 'Start', icon: <House className={ICON} strokeWidth={1.5} /> },
    { id: 'imageLab', label: 'Image to plan', short: 'Image', icon: <ScanLine className={ICON} strokeWidth={1.5} /> },
    { id: 'edit', label: 'Edit plan', short: 'Edit', icon: <PencilRuler className={ICON} strokeWidth={1.5} /> },
    { id: 'viewer3d', label: '3D viewer', short: '3D', icon: <Box className={ICON} strokeWidth={1.5} /> },
  ],
  how: [
    { id: 'pipeline', label: 'Pipeline', short: 'Pipeline', icon: <Workflow className={ICON} strokeWidth={1.5} /> },
    { id: 'results', label: 'Results', short: 'Results', icon: <ChartColumn className={ICON} strokeWidth={1.5} /> },
    { id: 'graphics', label: 'Graphics', short: 'Graphics', icon: <Shapes className={ICON} strokeWidth={1.5} /> },
    { id: 'about', label: 'About', short: 'About', icon: <Info className={ICON} strokeWidth={1.5} /> },
  ],
};

const SIDEBAR_KEY = 'floorplan3d.sidebarExpanded';

/** Whether the sidebar is expanded, remembered in this browser (collapsed until someone expands it). */
function useSidebarExpanded(): [boolean, (next: boolean) => void] {
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1';
    } catch {
      return false;
    }
  });
  const set = (next: boolean) => {
    setExpanded(next);
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
    } catch {
      // Private windows may refuse storage; the choice then lasts until the page reloads.
    }
  };
  return [expanded, set];
}

/** The product mark: a plan outline with one interior wall and a window in the accent. */
export const ProductMark: React.FC<{ className?: string }> = ({ className = 'h-6 w-6' }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="1.5" fill="none" stroke="var(--text)" strokeWidth="2.2" />
    <path d="M12 3v7.5M12 14.5V21M12 12h9" fill="none" stroke="var(--text)" strokeWidth="2.2" />
    <path d="M6.5 3h3.5" stroke="var(--accent)" strokeWidth="2.6" />
  </svg>
);

const ThemeToggle: React.FC<{ theme: Theme; onChange: (theme: Theme) => void; compact?: boolean }> = ({
  theme,
  onChange,
  compact,
}) =>
  compact ? (
    <button
      type="button"
      onClick={() => onChange(theme === 'dark' ? 'light' : 'dark')}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className="flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-ink"
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  ) : (
    <Segmented
      label="Theme"
      value={theme}
      onChange={onChange}
      options={[
        { value: 'light', label: 'Light', icon: <Sun className="h-3.5 w-3.5" /> },
        { value: 'dark', label: 'Dark', icon: <Moon className="h-3.5 w-3.5" /> },
      ]}
    />
  );

const PlanSwitcher: React.FC<{ plan: FloorPlanDataset; onSelect: (plan: FloorPlanDataset) => void; className?: string }> = ({
  plan,
  onSelect,
  className = '',
}) => {
  // A plan detected from an image is listed alongside the samples while it is the current one.
  const plans = SAMPLE_FLOORPLANS.some((p) => p.id === plan.id) ? SAMPLE_FLOORPLANS : [...SAMPLE_FLOORPLANS, plan];
  return (
    <label className={`flex items-center gap-2 text-[13px] ${className}`}>
      <span className="text-muted">Plan</span>
      <select
        value={plan.id}
        onChange={(e) => {
          const next = plans.find((p) => p.id === e.target.value);
          if (next) onSelect(next);
        }}
        className="h-8 min-w-0 rounded-md border border-control bg-surface px-2 text-[13px] text-ink"
      >
        {plans.map((p) => (
          <option key={p.id} value={p.id}>
            {planLabel(p)}
          </option>
        ))}
      </select>
    </label>
  );
};

/** Open a plan file, or save the current plan (with its edits) as one. */
const PlanFileActions: React.FC<{ plan: FloorPlanDataset; onOpen: (plan: FloorPlanDataset) => void; className?: string }> = ({
  plan,
  onOpen,
  className = '',
}) => {
  const input = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.error ? 9000 : 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const open = async (file: File) => {
    try {
      onOpen(parsePlan(await file.text()));
      setNotice({ text: `Opened ${file.name}`, error: false });
    } catch (e) {
      setNotice({ text: `Couldn't open ${file.name}: ${e instanceof Error ? e.message : String(e)}`, error: true });
    }
  };

  const save = () => {
    const url = URL.createObjectURL(new Blob([serializePlan(plan)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = planFileName(plan);
    link.click();
    URL.revokeObjectURL(url);
    setNotice({ text: `Saved ${link.download}`, error: false });
  };

  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`}>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void open(file);
        }}
      />
      <Button onClick={() => input.current?.click()} title="Open a FloorPlan3D plan file (.json)">
        <FolderOpen className="h-3.5 w-3.5" />
        Open
      </Button>
      <Button onClick={save} title="Download this plan, with your edits, as a .json file. Edits are also kept in this browser.">
        <Download className="h-3.5 w-3.5" />
        Save
      </Button>
      {notice && (
        <span role="status" className={`min-w-0 truncate text-[13px] ${notice.error ? 'text-negative' : 'text-muted'}`} title={notice.text}>
          {notice.text}
        </span>
      )}
    </div>
  );
};

/** A group of pages as a vertical list (the expanded sidebar, and the phone menu). */
const NavList: React.FC<{ items: NavItem[]; screen: Screen; label: string; touch?: boolean; onPick?: () => void }> = ({
  items,
  screen,
  label,
  touch,
  onPick,
}) => (
  <nav aria-label={label}>
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = item.id === screen;
        return (
          <li key={item.id}>
            <a
              href={hrefOf(item.id)}
              onClick={onPick}
              aria-current={active ? 'page' : undefined}
              className={`flex ${touch ? 'h-11' : 'h-9'} w-full items-center gap-3 rounded-md px-3 text-left text-[14px] transition-colors ${
                active ? 'bg-active font-medium text-ink' : 'text-muted hover:bg-active/60 hover:text-ink'
              }`}
            >
              {item.icon}
              <span className="flex-1 truncate">{item.label}</span>
            </a>
          </li>
        );
      })}
    </ul>
  </nav>
);

/** A group of pages as the collapsed rail: each an icon with its short label under it, the full name on hover. */
const NavRail: React.FC<{ items: NavItem[]; screen: Screen; label: string }> = ({ items, screen, label }) => (
  <nav aria-label={label}>
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const active = item.id === screen;
        return (
          <li key={item.id}>
            <a
              href={hrefOf(item.id)}
              title={item.label}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              className={`flex h-14 w-full flex-col items-center justify-center gap-1 rounded-lg text-[12px] leading-none transition-colors ${
                active ? 'bg-active font-medium text-ink' : 'text-muted hover:bg-active/60 hover:text-ink'
              }`}
            >
              {item.icon}
              <span aria-hidden="true">{item.short}</span>
            </a>
          </li>
        );
      })}
    </ul>
  </nav>
);

/** The sidebar: every page in two groups, as a rail or expanded, with the button that switches between them. */
const Sidebar: React.FC<{ screen: Screen; expanded: boolean; onToggle: () => void }> = ({ screen, expanded, onToggle }) => (
  <aside className={`hidden shrink-0 flex-col pb-3 transition-[width] duration-200 lg:flex ${expanded ? 'w-[232px] px-3' : 'w-[84px] px-2'}`} aria-label="Pages">
    <div className={`flex h-12 items-center ${expanded ? 'px-3' : 'justify-center'}`}>
      {expanded ? <Brand /> : (
        <a href={hrefOf('start')} aria-label="FloorPlan3D, go to Start" className="rounded-md p-1">
          <ProductMark className="h-6 w-6" />
        </a>
      )}
    </div>
    <div className="mt-2 flex-1 overflow-y-auto">
      {(Object.keys(AREA_LABELS) as Area[]).map((a, i) => (
        <div key={a} className={i ? (expanded ? 'mt-5' : 'mt-3 border-t border-line pt-3') : ''}>
          {expanded ? (
            <>
              <p className="mb-1 px-3 text-[12px] font-medium text-muted">{AREA_LABELS[a]}</p>
              <NavList items={NAV[a]} screen={screen} label={AREA_LABELS[a]} />
            </>
          ) : (
            <NavRail items={NAV[a]} screen={screen} label={AREA_LABELS[a]} />
          )}
        </div>
      ))}
    </div>
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      title={expanded ? 'Collapse the sidebar' : 'Expand the sidebar'}
      className={`mt-2 flex h-9 items-center gap-2 rounded-md text-[13px] text-muted transition-colors hover:bg-active/60 hover:text-ink ${
        expanded ? 'px-3' : 'justify-center'
      }`}
    >
      {expanded ? <PanelLeftClose className="h-[18px] w-[18px]" strokeWidth={1.5} /> : <PanelLeftOpen className="h-[18px] w-[18px]" strokeWidth={1.5} />}
      {expanded ? 'Collapse' : <span className="sr-only">Expand the sidebar</span>}
    </button>
  </aside>
);

const Brand: React.FC<{ small?: boolean }> = ({ small }) => (
  <a href={hrefOf('start')} className="flex shrink-0 items-center gap-2.5 rounded-md" aria-label="FloorPlan3D, go to Start">
    <ProductMark className={small ? 'h-5 w-5' : 'h-6 w-6'} />
    <span className="text-[15px] font-semibold">FloorPlan3D</span>
  </a>
);

export const AppShell: React.FC<{
  screen: Screen;
  plan: FloorPlanDataset;
  onSelectPlan: (plan: FloorPlanDataset) => void;
  theme: Theme;
  onChangeTheme: (theme: Theme) => void;
  children: React.ReactNode;
}> = ({ screen, plan, onSelectPlan, theme, onChangeTheme, children }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useSidebarExpanded();
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
  }, [screen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);
  const area = PAGES[screen].area;

  return (
    <div className="flex h-full bg-ground text-ink">
      <Sidebar screen={screen} expanded={expanded} onToggle={() => setExpanded(!expanded)} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Desktop top bar: where you are, the plan in scope and the theme. */}
        <header className="hidden h-12 shrink-0 items-center justify-between gap-4 pr-4 lg:flex">
          <div className="flex min-w-0 items-center gap-4">
            <span className="whitespace-nowrap text-[13px] text-muted">
              {AREA_LABELS[area]} <span aria-hidden="true">/</span> <span className="font-medium text-ink">{PAGES[screen].label}</span>
            </span>
            <PlanSwitcher plan={plan} onSelect={onSelectPlan} />
            <PlanFileActions plan={plan} onOpen={onSelectPlan} />
          </div>
          <ThemeToggle theme={theme} onChange={onChangeTheme} />
        </header>

        {/* Phone top bar: menu, page name, theme. */}
        <header className="flex h-12 shrink-0 items-center gap-1 px-1 lg:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            className="flex h-11 w-11 items-center justify-center rounded-md text-ink hover:bg-raised"
          >
            <Menu className="h-5 w-5" />
          </button>
          <ProductMark className="h-5 w-5" />
          <span className="ml-1.5 flex-1 truncate text-[15px] font-semibold">{PAGES[screen].label}</span>
          <ThemeToggle theme={theme} onChange={onChangeTheme} compact />
        </header>

        <main ref={main} className="flex min-h-0 flex-1 flex-col overflow-y-auto border-line bg-surface p-4 sm:p-6 lg:mb-2 lg:mr-2 lg:rounded-2xl lg:border">
          <div className="min-h-0 flex-1">{children}</div>
        </main>
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-surface lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="flex h-12 items-center gap-2.5 px-4">
            <ProductMark className="h-5 w-5" />
            <span className="flex-1 text-[15px] font-semibold">FloorPlan3D</span>
            <button
              type="button"
              onClick={closeMenu}
              aria-label="Close menu"
              className="flex h-11 w-11 items-center justify-center rounded-md hover:bg-raised"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-2 pb-6">
            {(Object.keys(AREA_LABELS) as Area[]).map((a) => (
              <div key={a}>
                <p className="mb-1 px-3 text-xs text-muted">{AREA_LABELS[a]}</p>
                <NavList items={NAV[a]} screen={screen} label={AREA_LABELS[a]} touch onPick={closeMenu} />
              </div>
            ))}
            <div className="flex flex-col gap-3 px-3">
              <PlanSwitcher plan={plan} onSelect={onSelectPlan} />
              <PlanFileActions plan={plan} onOpen={onSelectPlan} className="flex-wrap" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
