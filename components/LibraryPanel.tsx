import React, { useMemo, useState } from 'react';
import { FolderOpen, Library, RefreshCw, Search, Box } from 'lucide-react';
import { Btn, IconBtn, cx } from './ui';
import { PanelCard } from './Inspector';
import type { LibraryItem, LibraryStatus } from '../hooks/useLibrary';

export const LIB_MIME = 'application/x-qtents-lib';
/** The library ids being dragged right now (drag data can't be read until the drop). */
export const libDrag = { ids: [] as string[] };

/** Floating object library: a linked folder of .obj files shown as thumbnails you can click or drag into the scene. */
export const LibraryPanel = ({
  supported, status, folder, items, thumbs, onChoose, onReconnect, onRefresh, onAdd, onClose,
}: {
  supported: boolean; status: LibraryStatus; folder: string | null; items: LibraryItem[]; thumbs: Record<string, string | null>;
  onChoose: () => void; onReconnect: () => void; onRefresh: () => void; onAdd: (ids: string[]) => void; onClose: () => void;
}) => {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const shown = useMemo(() => items.filter((i) => i.id.toLowerCase().includes(q.trim().toLowerCase())), [items, q]);
  const label = (n: string) => n.replace(/\.obj$/i, '');

  const body = () => {
    if (!supported) return <p className="text-xs text-muted leading-[17px]">Linking a folder needs a Chromium browser (Chrome or Edge).</p>;
    if (status === 'none' || (status === 'error' && !items.length)) {
      return (
        <div className="text-xs text-muted leading-[17px]">
          <p className="mb-2.5">Link a folder of .obj files to build your library. You can change the folder at any time.</p>
          <Btn size="sm" variant="primary" className="w-full" onClick={onChoose}><FolderOpen size={13} /> Link folder</Btn>
          {status === 'error' && <p className="text-danger mt-2">Could not read that folder.</p>}
        </div>
      );
    }
    if (status === 'needs-permission') {
      return (
        <div className="text-xs text-muted leading-[17px]">
          <p className="mb-2.5">Allow access to <span className="text-ink font-medium">{folder}</span> again to show your library.</p>
          <div className="flex gap-2">
            <Btn size="sm" variant="primary" className="flex-1" onClick={onReconnect}>Reconnect</Btn>
            <Btn size="sm" className="flex-1" onClick={onChoose}>Other folder</Btn>
          </div>
        </div>
      );
    }
    return (
      <>
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-xs text-ink font-medium truncate flex-1" title={folder ?? ''}>{folder}</span>
          <IconBtn className="h-6 w-6" onClick={onRefresh} aria-label="Refresh library"><RefreshCw size={12} /></IconBtn>
          <Btn size="sm" onClick={onChoose}>Change</Btn>
        </div>
        <div className="relative mb-2">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${items.length} objects`} className="w-full pl-6" />
        </div>
        {status === 'loading' && <p className="text-2xs text-faint mb-2">Reading folder...</p>}
        {status === 'ready' && !items.length && <p className="text-xs text-muted">No .obj files found in this folder.</p>}
        <div className="grid grid-cols-3 gap-1.5 max-h-[340px] overflow-y-auto pr-0.5">
          {shown.map((it) => {
            const on = picked.includes(it.id);
            const t = thumbs[it.id];
            return (
              <button
                key={it.id}
                draggable
                title={`${it.id}\nClick to add - drag into the scene - Ctrl/Shift-click to pick several`}
                onDragStart={(e) => {
                  const ids = on ? picked : [it.id];
                  e.dataTransfer.setData(LIB_MIME, JSON.stringify(ids));
                  libDrag.ids = ids;
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onDragEnd={() => { libDrag.ids = []; }}
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey || e.shiftKey) setPicked((p) => (p.includes(it.id) ? p.filter((x) => x !== it.id) : [...p, it.id]));
                  else onAdd([it.id]);
                }}
                className={cx('group rounded-md border p-1 text-left transition-colors cursor-grab active:cursor-grabbing',
                  on ? 'border-accent bg-accent/10' : 'border-line hover:bg-hover')}
              >
                <div className="aspect-square rounded bg-raised grid place-items-center overflow-hidden">
                  {t ? <img src={t} alt="" draggable={false} className="h-full w-full object-contain" /> : <Box size={18} className={cx('text-faint', t === undefined && 'animate-pulse')} />}
                </div>
                <div className="mt-1 text-2xs text-muted group-hover:text-ink truncate">{label(it.name)}</div>
              </button>
            );
          })}
        </div>
        {picked.length > 0 && (
          <div className="flex gap-2 mt-2">
            <Btn size="sm" variant="primary" className="flex-1" onClick={() => { onAdd(picked); setPicked([]); }}>Add {picked.length} selected</Btn>
            <Btn size="sm" variant="ghost" onClick={() => setPicked([])}>Clear</Btn>
          </div>
        )}
      </>
    );
  };

  return <PanelCard title="Library" icon={<Library size={13} />} onClose={onClose}>{body()}</PanelCard>;
};
