/**
 * Small shared controls, so every screen uses the same buttons, toggles and labels.
 * Styling comes from the theme tokens in index.css (framed-sheet style: 32px
 * controls, 6px control radius, near-black primary, no shadows at rest).
 */

import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary hover:opacity-90',
  secondary: 'border border-control bg-surface text-ink hover:bg-raised aria-pressed:bg-active',
  ghost: 'text-muted hover:text-ink hover:bg-raised aria-pressed:bg-active aria-pressed:text-ink',
};

export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }> = ({
  variant = 'secondary',
  className = '',
  ...props
}) => (
  <button
    type="button"
    {...props}
    className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_STYLES[variant]} ${className}`}
  />
);

/** A link that looks like a Button: for moving to another page, so it can also open in a new tab. */
export const LinkButton: React.FC<React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant }> = ({
  variant = 'secondary',
  className = '',
  ...props
}) => (
  <a
    {...props}
    className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors ${BUTTON_STYLES[variant]} ${className}`}
  />
);

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className = '',
}: {
  label: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex rounded-md border border-line bg-raised p-0.5 ${className}`}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`inline-flex h-7 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] px-2.5 text-[13px] transition-colors ${
              selected ? 'bg-surface font-medium text-ink ring-1 ring-line' : 'text-muted hover:text-ink'
            }`}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export const Switch: React.FC<{ label: string; checked: boolean; onChange: (checked: boolean) => void }> = ({
  label,
  checked,
  onChange,
}) => (
  <label className="flex h-8 cursor-pointer items-center justify-between gap-3 text-[13px] text-ink">
    {label}
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-control'}`}
    >
      <span
        className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-surface transition-transform ${
          checked ? 'translate-x-[16px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  </label>
);

export type PillTone = 'positive' | 'warning' | 'negative' | 'neutral' | 'accent';

const PILL_STYLES: Record<PillTone, string> = {
  positive: 'bg-positive-soft text-positive-ink',
  warning: 'bg-warning-soft text-warning-ink',
  negative: 'bg-negative-soft text-negative-ink',
  neutral: 'bg-neutral-soft text-neutral-ink',
  accent: 'bg-accent-soft text-accent',
};

export const Pill: React.FC<{ tone?: PillTone; children: React.ReactNode }> = ({ tone = 'neutral', children }) => (
  <span className={`inline-flex h-5 flex-none items-center whitespace-nowrap rounded-full px-2 text-xs font-medium ${PILL_STYLES[tone]}`}>
    {children}
  </span>
);

/** A screen's title row: the h1, one sentence about what is on the screen, and its actions. */
export const PageHeader: React.FC<{ title: string; description?: React.ReactNode; actions?: React.ReactNode }> = ({
  title,
  description,
  actions,
}) => (
  <header className="flex flex-wrap items-start justify-between gap-4">
    <div className="min-w-0 max-w-3xl">
      <h1 className="text-[22px] font-semibold leading-7">{title}</h1>
      {description && <p className="mt-1 text-[15px] leading-6 text-muted">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>
);

export interface TabOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

/** Underline tabs on one full-width rule (framed-sheet: the active tab is a 2px underline in ink). */
export function Tabs<T extends string>({
  label,
  value,
  tabs,
  onChange,
  trailing,
}: {
  label: string;
  value: T | null;
  tabs: TabOption<T>[];
  onChange: (value: T) => void;
  /** Controls at the right end of the tab row, such as paging buttons. */
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line">
      <div role="tablist" aria-label={label} className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]">
        {tabs.map((tab) => {
          const selected = tab.value === value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(tab.value)}
              className={`-mb-px inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[14px] transition-colors ${
                selected ? 'border-ink font-medium text-ink' : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-1 pb-1">{trailing}</div>}
    </div>
  );
}

export const SectionTitle: React.FC<{ children: React.ReactNode; aside?: React.ReactNode }> = ({ children, aside }) => (
  <div className="mb-3 flex items-center justify-between gap-3">
    <h2 className="text-[14px] font-semibold text-ink">{children}</h2>
    {aside}
  </div>
);

/** Label on the left, figure on the right, on one row. */
export const KeyValue: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex h-8 items-center justify-between gap-3 text-[13px]">
    <span className="text-muted">{label}</span>
    <span className="num text-right text-ink">{children}</span>
  </div>
);

/** A labelled range slider with its value shown on the right. */
export const Slider: React.FC<{
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  hint?: string;
}> = ({ label, value, display, min, max, step, onChange, disabled, hint }) => (
  <label className="block py-1">
    <div className="flex items-center justify-between text-[13px]">
      <span className="text-ink">{label}</span>
      <span className="num text-muted">{display}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className="mt-1 w-full accent-[var(--text)]"
    />
    {hint && <p className="text-xs text-muted">{hint}</p>}
  </label>
);
