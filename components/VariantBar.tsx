import React, { useState } from 'react';
import { Plus, Copy, Trash2, Shapes, Check } from 'lucide-react';
import { cx } from './ui';

export interface VariantInfo { id: string; name: string }

/** Tabs for switching between sketch options (variants of the tent design). */
export const VariantBar = ({
  variants, activeId, onSwitch, onAdd, onDuplicate, onRename, onDelete,
  shapeCount, activeShape, onShape, onAddShape, onDeleteShape, onFinish, canFinish,
}: {
  variants: VariantInfo[];
  activeId: string;
  onSwitch: (id: string) => void;
  onAdd: () => void;
  onDuplicate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  shapeCount: number; activeShape: number;
  onShape: (i: number) => void; onAddShape: () => void; onDeleteShape: () => void;
  onFinish: () => void; canFinish: boolean;
}) => {
  const [editing, setEditing] = useState<string | null>(null);
  const btn = 'inline-flex items-center justify-center h-7 w-7 rounded-md text-muted hover:text-ink hover:bg-hover transition-colors disabled:opacity-40';
  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-3 z-20 flex flex-col items-center gap-1 max-w-[90%]" onPointerDown={(e) => e.stopPropagation()}>
    <div className="flex items-center gap-1 rounded-lg border border-line bg-panel/95 p-1 shadow-lg max-w-full overflow-x-auto">
      <button onClick={onFinish} disabled={!canFinish} title="Finish drawing this option"
        className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-accent text-bg hover:opacity-90 disabled:opacity-35 transition-opacity"><Check size={15} /></button>
      <Shapes size={13} className="text-faint mx-1.5 shrink-0" />
      {Array.from({ length: shapeCount }, (_, i) => (
        <button key={i} onClick={() => onShape(i)} title="Edit this shape"
          className={cx('h-7 px-2.5 rounded-md text-xs whitespace-nowrap transition-colors',
            i === activeShape ? 'bg-ink/10 text-ink font-medium' : 'text-muted hover:text-ink hover:bg-hover')}>
          Shape {i + 1}
        </button>
      ))}
      <button className={btn} onClick={onAddShape} title="Add another shape to this option"><Plus size={14} /></button>
      <button className={btn} onClick={onDeleteShape} disabled={shapeCount < 2} title="Delete this shape"><Trash2 size={13} /></button>
    </div>
    <div className="flex items-center gap-1 rounded-lg border border-line bg-panel/95 p-1 shadow-lg max-w-full overflow-x-auto">
      {variants.map((v) => (
        editing === v.id ? (
          <input key={v.id} autoFocus defaultValue={v.name} className="h-7 w-28 px-2 text-xs rounded-md"
            onBlur={(e) => { onRename(v.id, e.target.value.trim() || v.name); setEditing(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }} />
        ) : (
          <button key={v.id} onClick={() => onSwitch(v.id)} onDoubleClick={() => setEditing(v.id)}
            title="Click to switch, double-click to rename"
            className={cx('h-7 px-2.5 rounded-md text-xs whitespace-nowrap transition-colors',
              v.id === activeId ? 'bg-accent text-bg font-medium' : 'text-muted hover:text-ink hover:bg-hover')}>
            {v.name}
          </button>
        )
      ))}
      <span className="w-px h-4 bg-line mx-0.5" />
      <button className={btn} onClick={onAdd} title="New empty option"><Plus size={14} /></button>
      <button className={btn} onClick={onDuplicate} title="Duplicate this option"><Copy size={13} /></button>
      <button className={btn} onClick={() => onDelete(activeId)} disabled={variants.length < 2} title="Delete this option"><Trash2 size={13} /></button>
    </div>
    </div>
  );
};
