import React from 'react';
import { cx } from './ui';
import type { PoleStyle } from '../types';

const base = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

/** A single upright pole with a base plate and a cap. */
export const PoleIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...base}>
    <path d="M12 4.5v14" strokeWidth={2.6} />
    <circle cx="12" cy="3.4" r="1.5" fill="currentColor" stroke="none" />
    <path d="M7 21h10" strokeWidth={2} />
    <path d="M9.5 18.5h5" strokeWidth={1.6} />
  </svg>
);

/** A pole standing at the corner of an outline: two ground edges meeting at its foot. */
export const CornerPoleIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...base}>
    <path d="M7 3.2v13.6" strokeWidth={2.6} />
    <circle cx="7" cy="2.6" r="1.4" fill="currentColor" stroke="none" />
    <path d="M7 19.5H21" strokeWidth={1.7} strokeDasharray="0.1 3.1" />
    <path d="M7 19.5L2.5 22.5" strokeWidth={1.7} strokeDasharray="0.1 3.1" />
    <path d="M4.5 17.5h5" strokeWidth={1.6} />
  </svg>
);

export const POLE_STYLES: Record<PoleStyle, { label: string; color: string; metal: boolean }> = {
  wood: { label: 'Wood', color: '#8a5a2b', metal: false },
  steel: { label: 'Black steel', color: '#1b1d21', metal: true },
};

/** The fixed steel pole comes in two lengths only. */
export const STEEL_HEIGHTS = [2.5, 3] as const;
export const snapSteelHeight = (h: number) => (Math.abs(h - 2.5) <= Math.abs(h - 3) ? 2.5 : 3);

/** Pole height: free for wooden poles, 2.5 m or 3 m for the fixed steel pole. */
export const PoleHeightInput = ({ style, value, onChange, className }: {
  style: PoleStyle; value: number; onChange: (h: number) => void; className?: string;
}) => style === 'steel' ? (
  <div className="flex gap-1" role="radiogroup" aria-label="Steel pole length">
    {STEEL_HEIGHTS.map((h) => (
      <button key={h} role="radio" aria-checked={Math.abs(value - h) < 0.01} onClick={() => onChange(h)}
        className={cx('flex-1 h-7 px-2 rounded-md border text-xs font-mono whitespace-nowrap transition-colors',
          Math.abs(value - h) < 0.01 ? 'border-accent bg-accent/10 text-ink' : 'border-line text-muted hover:text-ink hover:bg-hover')}>
        {h} m
      </button>
    ))}
  </div>
) : (
  <input type="number" min={0.1} step={0.5} value={value} className={className ?? 'w-full'}
    onChange={(e) => onChange(Math.max(0.1, parseFloat(e.target.value) || 0.1))} />
);

/** Pick wooden or black steel poles. */
export const PoleStylePicker = ({ value, onChange, compact = false }: { value: PoleStyle; onChange: (s: PoleStyle) => void; compact?: boolean }) => (
  <div className="flex gap-1" role="radiogroup" aria-label="Pole style">
    {(Object.keys(POLE_STYLES) as PoleStyle[]).map((k) => (
      <button
        key={k} role="radio" aria-checked={value === k} onClick={() => onChange(k)} title={`${POLE_STYLES[k].label} pole`}
        className={cx('flex items-center justify-center gap-1.5 rounded-md border transition-colors',
          compact ? 'h-7 px-2 text-xs whitespace-nowrap' : 'flex-1 h-8 text-xs',
          value === k ? 'border-accent bg-accent/10 text-ink' : 'border-line text-muted hover:text-ink hover:bg-hover')}
      >
        <span className="inline-block h-4 w-1.5 rounded-sm" style={{ background: POLE_STYLES[k].color, boxShadow: POLE_STYLES[k].metal ? 'inset 1px 0 0 rgba(255,255,255,.35)' : 'inset 1px 0 0 rgba(255,255,255,.2)' }} />
        {compact && k === 'steel' ? 'Steel' : POLE_STYLES[k].label}
      </button>
    ))}
  </div>
);
