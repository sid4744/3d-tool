import React, { useEffect, useRef, useState } from 'react';
import {
  MousePointer2, BoxSelect, PenTool, MapPin, Ruler, Move, Undo2, Redo2, FolderOpen, Download, ChevronDown,
  Orbit, Scan, ScanFace, Check, Upload, X, RotateCw, Scaling, FileOutput, FileBox, FileText, PanelRight, Sun, Moon, Globe, PackagePlus, Library, Rotate3d, Import, Cone, Armchair, Map as MapIcon, Trash2, ArrowDownToLine,
} from 'lucide-react';
import { Btn, IconBtn, Seg, Tip, Dot, cx } from './ui';
import { QuickHelpButton } from './QuickHelp';
import { TourButton } from './Tour';
import { PoleIcon, CornerPoleIcon, PoleStylePicker, PoleHeightInput } from './PoleIcons';
import type { PoleStyle } from '../types';
import type { ToolMode, ViewMode } from '../types';
import type { TrackingInfo } from '../hooks/useHeadTracking';

// ---------------------------------------------------------------- top bar

export const TopBar = ({
  projectName, onOpen, viewMode, onViewMode, canUndo, onUndo, canRedo, onRedo, canExport, onExportDXF, onExportOBJ, onExportPDF,
  inspectorOpen, onToggleInspector, theme, onToggleTheme, onSite, hasSite, helpOpen, onHelp, tourOpen, onTour,
}: {
  tourOpen: boolean;
  onTour: () => void;
  helpOpen: boolean;
  onHelp: () => void;
  onSite: () => void;
  hasSite: boolean;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  projectName: string | null;
  onOpen: () => void;
  viewMode: ViewMode;
  onViewMode: (v: ViewMode) => void;
  canUndo: boolean;
  onUndo: () => void;
  canRedo: boolean;
  onRedo: () => void;
  canExport: boolean;
  onExportDXF: () => void;
  onExportOBJ: () => void;
  onExportPDF: () => void;
}) => {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
    addEventListener('mousedown', off);
    return () => removeEventListener('mousedown', off);
  }, [menu]);

  return (
    <header className="h-11 shrink-0 flex items-center gap-3 px-3 border-b border-line bg-panel">
      <div className="flex items-center gap-2.5 min-w-0 flex-1 basis-0">
        <img src={`${import.meta.env.BASE_URL}qtents-q.png`} alt="Q" className="h-8 w-8 shrink-0 rounded-[6px] bg-white p-[3px] border border-line object-contain" draggable={false} />
        <span className="text-[13px] font-semibold tracking-tight truncate min-w-0">3D Tool v2.0 <span className="hidden lg:inline text-muted font-normal">Evaluation Edition</span></span>
        <span className="text-faint hidden sm:inline">/</span>
        <button
          onClick={onOpen}
          className="truncate text-sm text-muted hover:text-ink transition-colors max-w-[150px] hidden sm:block"
          title="Import a scan"
        >
          {projectName ?? 'No scan'}
        </button>
        <Tip label="Import a 3D scan (.glb, .obj, .ply ...)" side="bottom"><span className="shrink-0 inline-flex">
          <Btn size="sm" variant="primary" onClick={onOpen} className="font-semibold shadow-sm"><Import size={15} /> <span className="hidden sm:inline">Import scan</span></Btn></span>
        </Tip>
      </div>

      <div className="flex justify-center">
        <Seg
          value={viewMode === 'front' || viewMode === 'right' ? 'orbit' : viewMode}
          onChange={onViewMode}
          options={[
            { value: 'orbit', label: 'Orbit', icon: <Orbit size={14} /> },
            { value: 'top', label: 'Top', icon: <Scan size={14} /> },
            { value: 'depth', label: 'Depth', icon: <ScanFace size={14} /> },
          ]}
        />
      </div>

      <div className="flex items-center gap-1 justify-end flex-1 basis-0">
        <Tip label="Take the demo tour" side="bottom"><span className="inline-flex"><TourButton open={tourOpen} onToggle={onTour} /></span></Tip>
        <Tip label="Quick help" side="bottom"><QuickHelpButton open={helpOpen} onToggle={onHelp} /></Tip>
        <Tip label="Undo" keys="Ctrl Z" side="bottom">
          <IconBtn onClick={onUndo} disabled={!canUndo} aria-label="Undo"><Undo2 size={15} /></IconBtn>
        </Tip>
        <Tip label="Redo" keys="Ctrl Y" side="bottom">
          <IconBtn onClick={onRedo} disabled={!canRedo} aria-label="Redo"><Redo2 size={15} /></IconBtn>
        </Tip>
        <Tip label={hasSite ? 'Site location' : 'Pick a site location'} side="bottom">
          <IconBtn onClick={onSite} active={hasSite} aria-label="Site location"><Globe size={15} /></IconBtn>
        </Tip>
        <Tip label={theme === 'light' ? 'Dark mode' : 'Light mode'} keys="L" side="bottom">
          <IconBtn onClick={onToggleTheme} aria-label="Toggle light or dark mode">
            {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
          </IconBtn>
        </Tip>
        <Tip label={inspectorOpen ? 'Hide panel' : 'Show panel'} keys="I" side="bottom">
          <IconBtn onClick={onToggleInspector} active={inspectorOpen} aria-label="Toggle side panel"><PanelRight size={15} /></IconBtn>
        </Tip>
        <div className="relative" ref={ref}>
          <Btn variant="primary" onClick={() => setMenu((m) => !m)} disabled={!canExport}>
            <Upload size={14} /> <span className="hidden md:inline">Export</span> <ChevronDown size={12} className="-mr-0.5" />
          </Btn>
          {menu && (
            <div className="absolute right-0 top-full mt-1.5 w-44 rounded-lg border border-line bg-raised shadow-xl p-1 z-50 animate-rise">
              {[
                { icon: <FileOutput size={14} />, label: 'DXF drawing', fn: onExportDXF },
                { icon: <FileBox size={14} />, label: 'OBJ outline', fn: onExportOBJ },
                { icon: <FileText size={14} />, label: 'PDF sheet', fn: onExportPDF },
              ].map((i) => (
                <button
                  key={i.label}
                  onClick={() => { setMenu(false); i.fn(); }}
                  className="w-full flex items-center gap-2 px-2 h-7 rounded-md text-sm text-ink hover:bg-hover"
                >
                  <span className="text-muted">{i.icon}</span>{i.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

// ---------------------------------------------------------------- tool rail

export const TOOLS: Array<{ id: ToolMode; label: string; key: string; icon: React.ReactNode; hint: string }> = [
  { id: 'view', label: 'Select', key: 'V', icon: <MousePointer2 size={16} />, hint: 'Click an object to select it. Drag to orbit, right-drag to pan, scroll to zoom.' },
  { id: 'box-select', label: 'Window select', key: 'W', icon: <BoxSelect size={16} />, hint: 'Drag a rectangle to select everything inside it.' },
  { id: 'draw', label: 'Sketch outline', key: 'S', icon: <PenTool size={16} />, hint: 'Click on the ground to place corners. Close the shape when you are done.' },
  { id: 'pole', label: 'Place poles', key: 'P', icon: <PoleIcon size={17} />, hint: 'Click on the ground to place a pole at the height set above.' },
  { id: 'measure', label: 'Measure', key: 'M', icon: <Ruler size={16} />, hint: 'Click two points on the ground to measure the distance.' },
  { id: 'transform', label: 'Move / rotate / scale', key: 'T', icon: <Move size={16} />, hint: 'Select an object, then drag its handles. Nothing selected moves the whole tent.' },
];

export const ToolRail = ({ tool, onTool, onAddObj, onCornerPoles, polesOpen, onFurniture, furnitureOpen, onMap, mapOpen, onSun, sunOpen, onTurntable, turntableOpen, onLibrary, libraryOpen }: {
  onLibrary: () => void; libraryOpen: boolean;
  onTurntable: () => void; turntableOpen: boolean;
  tool: ToolMode; onTool: (t: ToolMode) => void; onAddObj: () => void; onCornerPoles: () => void; polesOpen: boolean;
  onFurniture: () => void; furnitureOpen: boolean; onMap: () => void; mapOpen: boolean; onSun: () => void; sunOpen: boolean;
}) => (
  <nav className="w-11 shrink-0 flex flex-col items-center gap-1 py-2 border-r border-line bg-panel" aria-label="Tools">
    {TOOLS.map((t) => (
      <React.Fragment key={t.id}>
        <Tip label={t.label} keys={t.key}>
          <IconBtn
            active={tool === t.id}
            onClick={() => onTool(t.id)}
            aria-label={t.label}
            aria-pressed={tool === t.id}
            className="h-8 w-8"
          >
            {t.icon}
          </IconBtn>
        </Tip>
        {t.id === 'pole' && (
          <Tip label="Corner poles">
            <IconBtn active={polesOpen} onClick={onCornerPoles} aria-label="Corner poles" aria-pressed={polesOpen} className="h-8 w-8"><CornerPoleIcon size={17} /></IconBtn>
          </Tip>
        )}
      </React.Fragment>
    ))}
    <div className="my-1 h-px w-6 bg-line" aria-hidden />
    <Tip label="Map">
      <IconBtn active={mapOpen} onClick={onMap} aria-label="Map" aria-pressed={mapOpen} className="h-8 w-8"><MapIcon size={17} /></IconBtn>
    </Tip>
    <Tip label="Sun & shadows">
      <IconBtn active={sunOpen} onClick={onSun} aria-label="Sun and shadows" aria-pressed={sunOpen} className="h-8 w-8"><Sun size={17} /></IconBtn>
    </Tip>
    <Tip label="Furniture">
      <IconBtn active={furnitureOpen} onClick={onFurniture} aria-label="Furniture" aria-pressed={furnitureOpen} className="h-8 w-8"><Armchair size={17} /></IconBtn>
    </Tip>
    <Tip label="Turntable">
      <IconBtn active={turntableOpen} onClick={onTurntable} aria-label="Turntable" aria-pressed={turntableOpen} className="h-8 w-8"><Rotate3d size={17} /></IconBtn>
    </Tip>
    <Tip label="Object library">
      <IconBtn active={libraryOpen} onClick={onLibrary} aria-label="Object library" aria-pressed={libraryOpen} className="h-8 w-8"><Library size={17} /></IconBtn>
    </Tip>
    <Tip label="Add OBJ object">
      <IconBtn onClick={onAddObj} aria-label="Add OBJ object" className="h-8 w-8"><PackagePlus size={17} /></IconBtn>
    </Tip>
  </nav>
);

/** Floating transform panel for a selected object: Move / Rotate / Scale, snap and delete. */
export const TransformPanel = ({
  target, subMode, onSubMode, snap, onSnap, onDelete, onDropToGround,
}: {
  target: string | null;
  subMode: 'translate' | 'rotate' | 'scale'; onSubMode: (m: 'translate' | 'rotate' | 'scale') => void;
  snap: boolean; onSnap: (v: boolean) => void; onDelete: () => void; onDropToGround?: () => void;
}) => (
  <div className="w-[264px] rounded-lg border border-line bg-panel/95 shadow-lg backdrop-blur-sm animate-rise" onPointerDown={(e) => e.stopPropagation()}>
    <div className="flex items-center h-8 pl-2.5 pr-2.5 border-b border-line">
      <Move size={13} className="text-muted mr-2 shrink-0" />
      <span className="text-xs font-medium text-ink flex-1">Transform</span>
      <span className="text-2xs text-faint truncate max-w-[110px]">{target ?? ''}</span>
    </div>
    <div className="p-2.5 space-y-2.5">
      <Seg
        value={subMode}
        onChange={onSubMode}
        options={[
          { value: 'translate', label: 'Move', icon: <Move size={13} /> },
          { value: 'rotate', label: 'Rotate', icon: <RotateCw size={13} /> },
          { value: 'scale', label: 'Scale', icon: <Scaling size={13} /> },
        ]}
      />
      <div className="flex items-center gap-2">
        <Tip label="Snap to grid" keys="X" side="bottom">
          <Btn size="sm" variant={snap ? 'primary' : 'default'} onClick={() => onSnap(!snap)} aria-pressed={snap}>Snap</Btn>
        </Tip>
        <Btn size="sm" variant="danger" onClick={onDelete} aria-label="Delete selected object"><Trash2 size={13} /> Delete</Btn>
        <span className="text-2xs text-faint ml-auto">G · R · E</span>
      </div>
      {onDropToGround && (
        <Btn size="sm" className="w-full" onClick={onDropToGround}><ArrowDownToLine size={13} /> Drop to ground</Btn>
      )}
    </div>
  </div>
);

// ---------------------------------------------------------------- context bar (tool options)

export const ContextBar = ({
  tool, poleHeight, onPoleHeight, canClose, onClose, tentColor, onTentColor,
  subMode, onSubMode, measureDistance, measureCount, measurePending, onClearMeasures,
  snap, onSnap, target, poleStyle, onPoleStyle,
}: {
  poleStyle: PoleStyle; onPoleStyle: (s: PoleStyle) => void;
  snap: boolean;
  onSnap: (v: boolean) => void;
  target: string | null;
  measureCount: number;
  measurePending: boolean;
  onClearMeasures: () => void;
  tool: ToolMode;
  poleHeight: number;
  onPoleHeight: (h: number) => void;
  canClose: boolean;
  onClose: () => void;
  tentColor: string;
  onTentColor: (c: string) => void;
  subMode: 'translate' | 'rotate' | 'scale';
  onSubMode: (m: 'translate' | 'rotate' | 'scale') => void;
  measureDistance: number | null;
}) => {
  let body: React.ReactNode = null;
  if (tool === 'draw') {
    body = (
      <>
        <label className="flex items-center gap-2 text-xs text-muted">
          Outline
          <input
            type="color"
            value={tentColor}
            onChange={(e) => onTentColor(e.target.value)}
            className="h-5 w-5 rounded-[4px] border border-line bg-transparent p-0 cursor-pointer"
            aria-label="Outline colour"
          />
        </label>
        <Btn variant={canClose ? 'primary' : 'default'} size="sm" disabled={!canClose} onClick={onClose}>
          <Check size={13} /> Close shape
        </Btn>
      </>
    );
  } else if (tool === 'pole') {
    body = (
      <label className="flex items-center gap-2 text-xs text-muted whitespace-nowrap">
        Pole height
        <PoleHeightInput style={poleStyle} value={poleHeight} onChange={onPoleHeight} className="w-16 !py-0.5 font-mono" />
        {poleStyle === 'steel' ? '' : 'm'}
      </label>
    );
    body = <>{body}<PoleStylePicker value={poleStyle} onChange={onPoleStyle} compact /></>;
  } else if (tool === 'transform') {
    body = (
      <>
        <span className={cx('text-xs max-w-[180px] truncate', target ? 'text-accent' : 'text-muted')}>
          {target ?? 'Click an object to transform it'}
        </span>
        <Seg
          value={subMode}
          onChange={onSubMode}
          options={[
            { value: 'translate', label: 'Move', icon: <Move size={13} /> },
            { value: 'rotate', label: 'Rotate', icon: <RotateCw size={13} /> },
            { value: 'scale', label: 'Scale', icon: <Scaling size={13} /> },
          ]}
        />
        <Tip label="Snap to grid" keys="X" side="bottom">
          <Btn size="sm" variant={snap ? 'primary' : 'default'} onClick={() => onSnap(!snap)} aria-pressed={snap}>
            Snap
          </Btn>
        </Tip>
        <span className="text-2xs text-faint hidden lg:inline">G · R · E</span>
      </>
    );
  } else if (tool === 'measure') {
    body = (
      <>
        <span className="text-xs text-muted">
          {measurePending ? 'Click the second point' : measureCount ? 'Last' : 'Click two points on the ground'}
        </span>
        {measureDistance !== null && !measurePending && (
          <span className="font-mono text-sm text-accent tabular-nums">{measureDistance.toFixed(3)} m</span>
        )}
        {measureCount > 0 && (
          <Btn size="sm" variant="ghost" onClick={onClearMeasures}>Clear {measureCount}</Btn>
        )}
      </>
    );
  }
  if (!body) return null;
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 rounded-lg border border-line bg-panel/90 backdrop-blur px-3 h-9 shadow-lg animate-rise">
      {body}
    </div>
  );
};

// ---------------------------------------------------------------- status bar

export const StatusBar = ({
  tool, viewMode, tracking, hint,
}: { tool: ToolMode; viewMode: ViewMode; tracking: TrackingInfo; hint: string }) => {
  const tone =
    tracking.status === 'tracking' ? 'ok'
    : tracking.status === 'error' ? 'bad'
    : tracking.status === 'off' ? 'idle' : 'warn';
  return (
    <footer className="h-6 shrink-0 flex items-center justify-between px-3 border-t border-line bg-panel text-xs text-muted">
      <span className="truncate">{hint}</span>
      <span className="flex items-center gap-4 shrink-0">
        {viewMode === 'depth' && (
          <span className="flex items-center gap-1.5">
            <Dot tone={tone} />
            {tracking.status === 'tracking' && `Head tracking · ${tracking.distanceCm} cm`}
            {tracking.status === 'starting' && (tracking.message || 'Starting camera…')}
            {tracking.status === 'lost' && 'Face not visible — using last position'}
            {tracking.status === 'error' && `${tracking.message} — mouse controls the view`}
          </span>
        )}
        <span className="font-mono">{tool}</span>
      </span>
    </footer>
  );
};

// ---------------------------------------------------------------- empty state

export const EmptyState = ({ onOpen, onSketch }: { onOpen: () => void; onSketch: () => void }) => (
  <div className="absolute inset-0 grid place-items-center z-10 pointer-events-none">
    <div className="pointer-events-auto w-[min(420px,calc(100%-32px))] rounded-xl border border-line bg-panel/90 backdrop-blur p-8 text-center animate-rise">
      <div className="mx-auto mb-4 grid place-items-center h-10 w-10 rounded-lg border border-line text-muted">
        <Upload size={18} />
      </div>
      <h1 className="text-[15px] font-semibold mb-1">Open a 3D model</h1>
      <p className="text-sm text-muted mb-5">
        Drop a file anywhere, or choose one. Switch to <span className="text-ink">Depth</span> to look around it with your head.
      </p>
      <div className="flex justify-center gap-2">
        <Btn variant="primary" onClick={onOpen}><FolderOpen size={14} /> Choose file</Btn>
        <Btn onClick={onSketch}><PenTool size={14} /> Start sketching</Btn>
      </div>
      <p className="mt-4 text-xs text-faint font-mono">.glb  .gltf  .obj  .stl  .ply  .fbx  .zip</p>
    </div>
  </div>
);

export const DropOverlay = () => (
  <div className="absolute inset-3 z-40 rounded-xl border-2 border-dashed border-accent bg-accent/5 grid place-items-center pointer-events-none">
    <span className="text-[15px] font-medium text-accent">Drop to open</span>
  </div>
);

// ---------------------------------------------------------------- toasts

export interface Toast { id: number; text: string; tone: 'info' | 'error' }

export const Toasts = ({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) => (
  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center">
    {toasts.map((t) => (
      <div
        key={t.id}
        role="status"
        className={cx(
          'flex items-center gap-3 rounded-lg border bg-raised px-3 py-2 text-sm shadow-xl animate-rise max-w-[520px]',
          t.tone === 'error' ? 'border-danger/50' : 'border-line',
        )}
      >
        <span className={t.tone === 'error' ? 'text-danger' : 'text-ink'}>{t.text}</span>
        <button onClick={() => onDismiss(t.id)} className="text-faint hover:text-ink" aria-label="Dismiss"><X size={13} /></button>
      </div>
    ))}
  </div>
);
