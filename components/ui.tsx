import React from 'react';

export const cx = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(' ');

/** Hover label that never leaves the viewport edge it's anchored to. */
export const Tip = ({
  label, keys, side = 'right', children,
}: { label: string; keys?: string; side?: 'right' | 'bottom' | 'left'; children: React.ReactNode }) => (
  <span className="relative inline-flex group/tip">
    {children}
    <span
      role="tooltip"
      className={cx(
        'pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-raised border border-line px-2 py-1 text-xs text-ink shadow-lg',
        'opacity-0 scale-95 transition-all duration-100 group-hover/tip:opacity-100 group-hover/tip:scale-100 group-hover/tip:delay-300',
        side === 'right' && 'left-full top-1/2 -translate-y-1/2 ml-2',
        side === 'left' && 'right-full top-1/2 -translate-y-1/2 mr-2',
        side === 'bottom' && 'top-full left-1/2 -translate-x-1/2 mt-2',
      )}
    >
      {label}
      {keys && <kbd className="ml-2 font-mono text-2xs text-muted">{keys}</kbd>}
    </span>
  </span>
);

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
};

export const Btn = ({ variant = 'default', size = 'md', className, ...p }: BtnProps) => (
  <button
    {...p}
    className={cx(
      'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap select-none',
      'transition-colors disabled:opacity-35 disabled:pointer-events-none',
      size === 'md' ? 'h-7 px-2.5 text-sm' : 'h-6 px-2 text-xs',
      variant === 'default' && 'bg-raised border border-line text-ink hover:bg-hover',
      variant === 'primary' && 'bg-accent text-bg hover:brightness-110',
      variant === 'ghost' && 'text-muted hover:text-ink hover:bg-hover',
      variant === 'danger' && 'text-danger hover:bg-danger/10',
      className,
    )}
  />
);

export const IconBtn = ({
  active, className, ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) => (
  <button
    {...p}
    className={cx(
      'inline-flex items-center justify-center rounded-md h-7 w-7 transition-colors',
      'disabled:opacity-30 disabled:pointer-events-none',
      active ? 'bg-accent/15 text-accent' : 'text-muted hover:text-ink hover:bg-hover',
      className,
    )}
  />
);

export function Seg<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string; icon?: React.ReactNode }> }) {
  return (
    <div className="inline-flex rounded-md bg-bg border border-line p-0.5 gap-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'inline-flex items-center gap-1.5 h-6 px-2.5 rounded-[4px] text-sm font-medium transition-colors',
            value === o.value ? 'bg-raised text-ink shadow-[0_0_0_1px_rgb(var(--line))]' : 'text-muted hover:text-ink',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Inside a floating panel, sections drop their own header chrome (the panel supplies the title). */
export const PanelContext = React.createContext(false);

export const Section = ({
  title, aside, children, className,
}: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) => {
  const inPanel = React.useContext(PanelContext);
  if (inPanel) {
    return (
      <section className={className}>
        {aside && <div className="flex justify-end mb-2">{aside}</div>}
        {children}
      </section>
    );
  }
  return (
    <section className={cx('px-4 py-3.5 border-b border-line', className)}>
      <header className="flex items-center justify-between mb-2.5">
        <h2 className="text-xs font-medium text-muted">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
};

export const Field = ({
  label, value, children,
}: { label: string; value?: React.ReactNode; children: React.ReactNode }) => (
  <label className="block">
    <span className="flex justify-between text-xs text-muted mb-1">
      <span>{label}</span>
      {value !== undefined && <span className="font-mono text-ink">{value}</span>}
    </span>
    {children}
  </label>
);

export const Stat = ({ label, value, unit, hint }: { label: string; value: string; unit?: string; hint?: string }) => (
  <div className="flex items-baseline justify-between py-1">
    <span className="text-sm text-muted" title={hint}>{label}</span>
    <span className="font-mono text-sm text-ink tabular-nums">
      {value}
      {unit && <span className="text-muted ml-1">{unit}</span>}
    </span>
  </div>
);

export const Dot = ({ tone }: { tone: 'ok' | 'warn' | 'idle' | 'bad' }) => (
  <span
    className={cx(
      'inline-block h-1.5 w-1.5 rounded-full',
      tone === 'ok' && 'bg-ok',
      tone === 'warn' && 'bg-accent',
      tone === 'bad' && 'bg-danger',
      tone === 'idle' && 'bg-faint',
    )}
  />
);
