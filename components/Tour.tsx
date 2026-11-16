import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GraduationCap, X } from 'lucide-react';
import { Btn, IconBtn } from './ui';
import type { ToolMode, ViewMode } from '../types';

export const TourButton = ({ open, onToggle }: { open: boolean; onToggle: () => void }) => (
  <button
    onClick={onToggle}
    aria-label="Start demo tour"
    className={'h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md border text-xs font-medium transition-colors ' +
      (open ? 'border-accent bg-accent/10 text-ink' : 'border-line text-muted hover:text-ink hover:bg-hover')}
  >
    <GraduationCap size={15} /> <span className="hidden md:inline">Demo</span>
  </button>
);

type Step = {
  title: string;
  text: string;
  /** aria-label of the button to point at, or `text:Some label` to match a button by its visible text. Omit to centre the card. */
  target?: string;
  tool?: ToolMode;
  view?: ViewMode;
  /** A small "try it" line shown under the text. */
  tryIt?: string;
};

const STEPS: Step[] = [
  { title: 'Welcome to the 3D Tool', text: 'This short tour walks through everything the tool can do, from loading a site scan to exporting a finished plan. You can click around while it is open to try things. Use the arrow keys or the buttons below to move on, Esc to leave.' },
  { title: '1. Bring in the site', target: 'text:Import scan', text: 'Start by loading a 3D scan of the venue (.glb, .obj, .ply ...). The tent is sketched on top of it. No scan? You can still sketch on the empty grid.' },
  { title: 'Find the venue', target: 'Site location', text: 'Search for the address so the map, surrounding buildings, true north and the sun position are all correct.' },
  { title: '2. Three ways to look', target: 'text:Orbit', view: 'orbit', text: 'Orbit is the free 3D view: drag to look around, right-drag to pan, scroll to zoom. Top looks straight down (best for sketching) and Depth shades the scan by distance so the shape of the ground is easy to read.', tryIt: 'Try switching between Orbit, Top and Depth.' },
  { title: '3. Sketch the tent', target: 'Sketch outline', tool: 'draw', text: 'Click on the ground to place each corner of the tent. Press the tick when you are done to close the shape. The area, fabric needed and panel count appear in the side panel. Add more shapes or alternative options from the bar at the bottom.', tryIt: 'Shortcut: S' },
  { title: '4. Place poles', target: 'Place poles', tool: 'pole', text: 'Click on the ground to drop a pole. Steel poles come in 2.5 m and 3 m, with the flange sitting on the ground and the spigot in the ground, leaning away from the tent. Wooden poles stand upright with a guy line running out one pole-length at 45 degrees.', tryIt: 'Shortcut: P. Pick Wood or Black steel in the bar above.' },
  { title: 'Poles on every corner', target: 'Corner poles', text: 'Adds a pole outside each corner in one go. Each one leans outward along the bisector of its corner angle. Choose the offset, height and wood or steel, then press Add.' },
  { title: '5. Select and edit', target: 'Select', tool: 'view', text: 'Click any pole, object or measurement to select it. For a selected pole the side panel lets you change the height, swap steel for wood (and back), turn it to point a different way, and switch guy lines off. Press Delete to remove a selection.', tryIt: 'Shortcut: V. Drag a window with W to select several things.' },
  { title: 'Window select', target: 'Window select', tool: 'box-select', text: 'Drag a rectangle to select everything inside it. Drag left to right to take only what is fully inside, right to left to take anything it touches. Hold Shift to add to the selection.' },
  { title: '6. Move, rotate, scale', target: 'Move / rotate / scale', tool: 'transform', text: 'Drag the handles to move, rotate or scale the selected object. With nothing selected it moves the whole tent. Turn snapping on for tidy steps.', tryIt: 'Shortcut: T' },
  { title: '7. Measure', target: 'Measure', tool: 'measure', text: 'Click two points to measure the distance. Click a measurement line to select it and press Delete to remove just that one.', tryIt: 'Shortcut: M' },
  { title: '8. Furniture', target: 'Furniture', text: 'Add tables, chairs and other items inside the tent to check how the space works for the event.' },
  { title: '9. Your own objects', target: 'Add OBJ object', text: 'Import a single .obj model, for example a stage or a vehicle, and place it in the scene.' },
  { title: 'Object library', target: 'Object library', text: 'Link a folder of .obj files once and get a library with thumbnails. Click or drag objects into the scene, Ctrl/Shift-click to pick several. Drop one onto an object that is already placed to swap it, with a faint preview of the new size while you hover.' },
  { title: '10. Map and surroundings', target: 'Map', text: 'Show or hide the map and nearby buildings, and choose which details appear.' },
  { title: 'Sun and shadows', target: 'Sun and shadows', text: 'Set the date and time to see where the sun is and the shadows it casts over the tent. Press play to watch the day go by.' },
  { title: '11. Turntable', target: 'Turntable', text: 'Pick a centre point on the ground and the camera orbits it automatically. Change speed, direction, distance and height live, which is handy for presenting.' },
  { title: '12. Layers and the side panel', target: 'Toggle side panel', text: 'The side panel holds the layers (including the guy lines), colours, dimensions, fabric takeoff and the options for whatever is selected. Hide or show it any time.', tryIt: 'Shortcut: I' },
  { title: 'Made a mistake?', target: 'Undo', text: 'Undo and Redo step back and forward through your changes.', tryIt: 'Ctrl+Z and Ctrl+Y' },
  { title: 'Light or dark', target: 'Toggle light or dark mode', text: 'Switch the look of the whole tool to suit your screen.', tryIt: 'Shortcut: L' },
  { title: 'Quick help', target: 'Quick help', text: 'Open Quick Help and point at any button to read what it does, whenever you need a reminder.' },
  { title: '13. Export', target: 'text:Export', text: 'When the plan is ready, export a DXF drawing, an OBJ outline or a PDF sheet.' },
  { title: 'You are ready', text: 'That is the whole tool: import a scan, sketch the tent, add poles and extras, check the sun, then export. You can run this tour again from the Demo button at any time.' },
];

const find = (target?: string): HTMLElement | null => {
  if (!target) return null;
  if (target.startsWith('text:')) {
    const want = target.slice(5).trim().toLowerCase();
    const all = Array.from(document.querySelectorAll('button')) as HTMLElement[];
    return all.find((b) => (b.textContent || '').trim().toLowerCase() === want && b.offsetParent !== null) ?? null;
  }
  return document.querySelector(`[aria-label="${target}"]`) as HTMLElement | null;
};

export const Tour = ({ onClose, onTool, onView }: { onClose: () => void; onTool: (t: ToolMode) => void; onView: (v: ViewMode) => void }) => {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [size, setSize] = useState({ w: 340, h: 200 });
  const card = useRef<HTMLDivElement>(null);
  const step = STEPS[i];

  // Switch tool / view as the tour reaches a step that needs one.
  useEffect(() => {
    if (step.tool) onTool(step.tool);
    if (step.view) onView(step.view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  // Follow the target (it can move when panels open or the window resizes).
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = find(step.target);
      const r = el ? el.getBoundingClientRect() : null;
      setRect((p) => (p && r && p.x === r.x && p.y === r.y && p.width === r.width && p.height === r.height ? p : r));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [i, step.target]);

  useLayoutEffect(() => {
    const r = card.current?.getBoundingClientRect();
    if (r && (Math.abs(r.width - size.w) > 1 || Math.abs(r.height - size.h) > 1)) setSize({ w: r.width, h: r.height });
  });

  const last = i === STEPS.length - 1;
  const next = () => (last ? onClose() : setI((n) => n + 1));
  const back = () => setI((n) => Math.max(0, n - 1));
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      else if (e.key === 'ArrowRight' && !(e.target as HTMLElement)?.closest?.('input,textarea')) next();
      else if (e.key === 'ArrowLeft' && !(e.target as HTMLElement)?.closest?.('input,textarea')) back();
    };
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  });

  const vw = innerWidth, vh = innerHeight, gap = 14, pad = 5;
  let left = (vw - size.w) / 2, top = (vh - size.h) / 2;
  if (rect) {
    if (rect.top < 70) { left = rect.right - size.w; top = rect.bottom + gap; }
    else if (rect.right + gap + size.w < vw - 8) { left = rect.right + gap; top = rect.top + rect.height / 2 - 40; }
    else { left = rect.left - gap - size.w; top = rect.top; }
  }
  left = Math.max(8, Math.min(left, vw - size.w - 8));
  top = Math.max(8, Math.min(top, vh - size.h - 8));

  return (
    <div data-quickhelp className="fixed inset-0 z-[60] pointer-events-none">
      {rect ? (
        <div
          className="absolute rounded-lg pointer-events-none transition-all duration-200"
          style={{
            left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2,
            boxShadow: '0 0 0 2px rgb(var(--accent, 245 158 11)), 0 0 0 9999px rgba(0,0,0,0.45)',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/45" />
      )}
      <div ref={card} style={{ left, top }} className="absolute pointer-events-auto w-[340px] max-w-[calc(100vw-16px)] rounded-xl border border-line bg-panel shadow-2xl animate-rise">
        <div className="flex items-center h-9 pl-3 pr-1.5 border-b border-line">
          <GraduationCap size={14} className="text-accent mr-2" />
          <span className="text-xs font-medium text-ink flex-1">Demo tour</span>
          <span className="text-2xs text-faint mr-2">{i + 1} / {STEPS.length}</span>
          <IconBtn className="h-6 w-6" onClick={onClose} aria-label="Close demo tour"><X size={13} /></IconBtn>
        </div>
        <div className="p-3.5">
          <div className="text-sm font-semibold text-ink mb-1">{step.title}</div>
          <p className="text-xs leading-[18px] text-muted">{step.text}</p>
          {step.tryIt && <p className="mt-2 text-xs text-accent">{step.tryIt}</p>}
        </div>
        <div className="flex items-center gap-2 px-3 pb-3">
          <div className="flex-1 h-1 rounded bg-line overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: `${((i + 1) / STEPS.length) * 100}%` }} /></div>
          <Btn size="sm" onClick={back} disabled={i === 0}>Back</Btn>
          <Btn size="sm" variant="primary" onClick={next}>{last ? 'Finish' : i === 0 ? 'Start' : 'Next'}</Btn>
        </div>
      </div>
    </div>
  );
};
