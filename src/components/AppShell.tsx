/**
 * The app frame (framed-sheet style). The top bar switches between the two areas of the app:
 * the Studio, where a plan is made and viewed (a sidebar lists its pages), and How it works,
 * which explains the system; its pages use the full width, with page tabs at the top of the
 * sheet. Every page is a link (see router.ts), so it can open in its own browser tab.
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
  ListChecks,
  Menu,
  Moon,
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
import { AREA_HOME, AREA_LABELS, PAGES, hrefOf, type Area, type Screen } from '../router';
import type { Theme } from '../theme';
import { Button, Segmented } from './ui';

interface NavItem {
  id: Screen | 'draw';
  label: string;
  icon: React.ReactNode;
  planned?: boolean;
}

const ICON = 'h-4 w-4 shrink-0';

/** The pages of each area, in the order a person uses them. */
const NAV: Record<Area, NavItem[]> = {
  studio: [
    { id: 'start', label: 'Start', icon: <House className={ICON} strokeWidth={1.5} /> },
    { id: 'imageLab', label: 'Image to plan', icon: <ScanLine className={ICON} strokeWidth={1.5} /> },
    { id: 'edit', label: 'Edit plan', icon: <PencilRuler className={ICON} strokeWidth={1.5} /> },
    { id: 'viewer3d', label: '3D viewer', icon: <Box className={ICON} strokeWidth={1.5} /> },
  ],
  how: [
    { id: 'pipeline', label: 'Pipeline', icon: <Workflow className={ICON} strokeWidth={1.5} /> },
    { id: 'results', label: 'Results', icon: <ChartColumn className={ICON} strokeWidth={1.5} /> },
    { id: 'graphics', label: 'Graphics', icon: <Shapes className={ICON} strokeWidth={1.5} /> },
    { id: 'status', label: 'Project status', icon: <ListChecks className={ICON} strokeWidth={1.5} /> },
    { id: 'about', label: 'About', icon: <Info className={ICON} strokeWidth={1.5} /> },
  ],
};

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

/** Studio or How it works. Each half is a link to the page last open in that area. */
const AreaSwitch: React.FC<{ area: Area; lastPage: Record<Area, Screen>; onPick?: () => void }> = ({ area, lastPage, onPick }) => (
  <nav aria-label="Area" className="inline-flex shrink-0 rounded-md border border-line bg-raised p-0.5">
    {(Object.keys(AREA_LABELS) as Area[]).map((a) => (
      <a
        key={a}
        href={hrefOf(lastPage[a])}
        onClick={onPick}
        aria-current={a === area ? 'page' : undefined}
        className={`inline-flex h-7 items-center whitespace-nowrap rounded-[5px] px-3 text-[13px] transition-colors ${
          a === area ? 'bg-surface font-medium text-ink ring-1 ring-line' : 'text-muted hover:text-ink'
        }`}
      >
        {AREA_LABELS[a]}
      </a>
    ))}
  </nav>
);

/** The Studio's pages as a vertical list (the sidebar, and the phone menu). */
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
        const row = `flex ${touch ? 'h-11' : 'h-8'} w-full items-center gap-2.5 rounded-md px-3 text-left text-[14px] transition-colors`;
        return (
          <li key={item.id}>
            {item.planned || item.id === 'draw' ? (
              <span className={`${row} cursor-default text-muted`} aria-disabled="true">
                {item.icon}
                <span className="flex-1 truncate">{item.label}</span>
                <span className="text-xs">Planned</span>
              </span>
            ) : (
              <a
                href={hrefOf(item.id)}
                onClick={onPick}
                aria-current={active ? 'page' : undefined}
                className={`${row} ${active ? 'bg-active font-medium text-ink' : 'text-muted hover:bg-active/60 hover:text-ink'}`}
              >
                {item.icon}
                <span className="flex-1 truncate">{item.label}</span>
              </a>
            )}
          </li>
        );
      })}
    </ul>
  </nav>
);

/** How it works: its pages as underline tabs across the top of the sheet. */
const PageTabs: React.FC<{ screen: Screen }> = ({ screen }) => (
  <nav aria-label="How it works" className="mb-5 flex shrink-0 gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]">
    {NAV.how.map((item) => {
      const active = item.id === screen;
      return (
        <a
          key={item.id}
          href={hrefOf(item.id as Screen)}
          aria-current={active ? 'page' : undefined}
          className={`-mb-px inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[14px] transition-colors ${
            active ? 'border-ink font-medium text-ink' : 'border-transparent text-muted hover:text-ink'
          }`}
        >
          {item.icon}
          {item.label}
        </a>
      );
    })}
  </nav>
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
  const area = PAGES[screen].area;
  const [lastPage, setLastPage] = useState<Record<Area, Screen>>(AREA_HOME);
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    setLastPage((last) => (last[area] === screen ? last : { ...last, [area]: screen }));
    main.current?.scrollTo({ top: 0 });
  }, [screen, area]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);
  const studio = area === 'studio';

  return (
    <div className="flex h-full bg-ground text-ink">
      {/* Studio sidebar: part of the tinted frame, no rule against the top bar or the sheet. */}
      {studio && (
        <aside className="hidden w-[228px] shrink-0 flex-col px-3 lg:flex">
          <div className="flex h-12 items-center px-3">
            <Brand />
          </div>
          <div className="mt-3 flex-1 overflow-y-auto">
            <NavList items={NAV.studio} screen={screen} label="Studio" />
          </div>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Desktop top bar: the area, the plan in scope and the theme. */}
        <header className={`hidden h-12 shrink-0 items-center justify-between gap-4 pr-4 lg:flex ${studio ? '' : 'pl-6'}`}>
          <div className="flex min-w-0 items-center gap-4">
            {!studio && <Brand />}
            <AreaSwitch area={area} lastPage={lastPage} />
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

        <main
          ref={main}
          className={`flex min-h-0 flex-1 flex-col overflow-y-auto border-line bg-surface p-4 sm:p-6 lg:mb-2 lg:mr-2 lg:rounded-2xl lg:border ${
            studio ? '' : 'lg:ml-2'
          }`}
        >
          {!studio && <PageTabs screen={screen} />}
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
