/**
 * The app frame (framed-sheet style): one tinted L made of the sidebar and the
 * 48px top bar, with each screen on a white sheet inset 8px from the window's
 * right and bottom edges. On a phone the frame folds into a top bar and a menu sheet.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Code2,
  Cpu,
  Download,
  FolderOpen,
  LayoutDashboard,
  ListChecks,
  Menu,
  Moon,
  PencilRuler,
  ScanLine,
  Sun,
  Workflow,
  X,
} from 'lucide-react';
import type { FloorPlanDataset } from '../types/floorplan';
import { SAMPLE_FLOORPLANS } from '../data/sampleFloorplans';
import { planLabel } from '../utils/planLabel';
import { parsePlan, planFileName, serializePlan } from '../data/planFile';
import type { Theme } from '../theme';
import { Button, Segmented } from './ui';

export type Screen = 'overview' | 'viewer3d' | 'imageLab' | 'cvPipeline' | 'cgLab' | 'cppRepo' | 'milestones';

interface NavItem {
  id: Screen | 'draw';
  label: string;
  icon: React.ReactNode;
  planned?: boolean;
}

const ICON = 'h-4 w-4 shrink-0';

const NAV: { group: string | null; items: NavItem[] }[] = [
  { group: null, items: [{ id: 'overview', label: 'Overview', icon: <LayoutDashboard className={ICON} strokeWidth={1.5} /> }] },
  {
    group: 'Build',
    items: [
      { id: 'viewer3d', label: '3D viewer', icon: <Box className={ICON} strokeWidth={1.5} /> },
      { id: 'imageLab', label: 'Image to plan', icon: <ScanLine className={ICON} strokeWidth={1.5} /> },
      { id: 'draw', label: 'Draw a plan', icon: <PencilRuler className={ICON} strokeWidth={1.5} />, planned: true },
    ],
  },
  {
    group: 'Project',
    items: [
      { id: 'cvPipeline', label: 'Pipeline explainer', icon: <Workflow className={ICON} strokeWidth={1.5} /> },
      { id: 'cgLab', label: 'Graphics lab', icon: <Cpu className={ICON} strokeWidth={1.5} /> },
      { id: 'cppRepo', label: 'C++ reference', icon: <Code2 className={ICON} strokeWidth={1.5} /> },
      { id: 'milestones', label: 'Milestones', icon: <ListChecks className={ICON} strokeWidth={1.5} /> },
    ],
  },
];

export const SCREEN_LABELS: Record<Screen, string> = {
  overview: 'Overview',
  viewer3d: '3D viewer',
  imageLab: 'Image to plan',
  cvPipeline: 'Pipeline explainer',
  cgLab: 'Graphics lab',
  cppRepo: 'C++ reference',
  milestones: 'Milestones',
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

const NavList: React.FC<{ screen: Screen; onNavigate: (screen: Screen) => void; touch?: boolean }> = ({ screen, onNavigate, touch }) => (
  <nav aria-label="Main" className="flex flex-col gap-5">
    {NAV.map((section, i) => (
      <div key={section.group ?? i}>
        {section.group && <p className="mb-1 px-3 text-xs text-muted">{section.group}</p>}
        <ul className="flex flex-col gap-0.5">
          {section.items.map((item) => {
            const active = item.id === screen;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={item.planned}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => item.id !== 'draw' && onNavigate(item.id)}
                  className={`flex ${touch ? 'h-11' : 'h-8'} w-full items-center gap-2.5 rounded-md px-3 text-left text-[14px] transition-colors ${
                    active
                      ? 'bg-active font-medium text-ink'
                      : item.planned
                        ? 'cursor-default text-muted'
                        : 'text-muted hover:bg-active/60 hover:text-ink'
                  }`}
                >
                  {item.icon}
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.planned && <span className="text-xs">Planned</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    ))}
  </nav>
);

export const AppShell: React.FC<{
  screen: Screen;
  onNavigate: (screen: Screen) => void;
  plan: FloorPlanDataset;
  onSelectPlan: (plan: FloorPlanDataset) => void;
  theme: Theme;
  onChangeTheme: (theme: Theme) => void;
  children: React.ReactNode;
}> = ({ screen, onNavigate, plan, onSelectPlan, theme, onChangeTheme, children }) => {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const navigate = (next: Screen) => {
    onNavigate(next);
    setMenuOpen(false);
  };

  return (
    <div className="flex h-full bg-ground text-ink">
      {/* Sidebar: part of the tinted frame, no rule against the top bar or the sheet. */}
      <aside className="hidden w-[228px] shrink-0 flex-col px-3 lg:flex">
        <div className="flex h-12 items-center gap-2.5 px-3">
          <ProductMark />
          <span className="text-[15px] font-semibold">FloorPlan3D</span>
        </div>
        <div className="mt-3 flex-1 overflow-y-auto">
          <NavList screen={screen} onNavigate={navigate} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Desktop top bar: the plan in scope and the theme. */}
        <header className="hidden h-12 shrink-0 items-center justify-between gap-4 pr-4 lg:flex">
          <div className="flex min-w-0 items-center gap-3">
            <PlanSwitcher plan={plan} onSelect={onSelectPlan} />
            <PlanFileActions plan={plan} onOpen={onSelectPlan} />
          </div>
          <ThemeToggle theme={theme} onChange={onChangeTheme} />
        </header>

        {/* Phone top bar: menu, screen name, theme. */}
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
          <span className="ml-1.5 flex-1 truncate text-[15px] font-semibold">{SCREEN_LABELS[screen]}</span>
          <ThemeToggle theme={theme} onChange={onChangeTheme} compact />
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto border-line bg-surface p-4 sm:p-6 lg:mb-2 lg:mr-2 lg:rounded-2xl lg:border">
          {children}
        </main>
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-surface lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="flex h-12 items-center gap-2.5 px-4">
            <ProductMark className="h-5 w-5" />
            <span className="flex-1 text-[15px] font-semibold">FloorPlan3D</span>
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
              className="flex h-11 w-11 items-center justify-center rounded-md hover:bg-raised"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-6">
            <NavList screen={screen} onNavigate={navigate} touch />
            <div className="mt-6 flex flex-col gap-3 px-3">
              <PlanSwitcher plan={plan} onSelect={onSelectPlan} />
              <PlanFileActions plan={plan} onOpen={onSelectPlan} className="flex-wrap" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
