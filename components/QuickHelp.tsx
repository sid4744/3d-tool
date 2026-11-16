import React, { useEffect, useState } from 'react';
import { HelpCircle, X } from 'lucide-react';
import { IconBtn } from './ui';

type Entry = { title: string; text: string; keys?: string };

/** What each button does. Keys are the button's aria-label / visible text, lowercased. */
const HELP: Record<string, Entry> = {
  'select': { title: 'Select', keys: 'V', text: 'Click an object to select it. Drag to orbit, right-drag to pan, scroll to zoom.' },
  'window select': { title: 'Window select', keys: 'W', text: 'Drag a rectangle to select everything inside it. Drag right to select only what is fully inside, left to select anything it touches. Hold Shift to add.' },
  'sketch outline': { title: 'Sketch outline', keys: 'S', text: 'Click on the ground to place the corners of a tent shape, then press the tick to finish.' },
  'place poles': { title: 'Place poles', keys: 'P', text: 'Click on the ground to place a single pole at the height shown in the bar above.' },
  'measure': { title: 'Measure', keys: 'M', text: 'Click two points to measure the distance between them.' },
  'move / rotate / scale': { title: 'Move / rotate / scale', keys: 'T', text: 'Drag the handles to move, rotate or scale the selected object. With nothing selected it moves the whole tent.' },
  'corner poles': { title: 'Corner poles', text: 'Add a pole outside every corner of a shape in one go. Choose the shape, offset, height and wood or steel.' },
  'map': { title: 'Map', text: 'Show or hide the map and surrounding buildings, and pick which details appear.' },
  'sun and shadows': { title: 'Sun & shadows', text: 'Set the date and time to see where the sun is and the shadows it casts. Press play to animate the day.' },
  'furniture': { title: 'Furniture', text: 'Add tables, chairs and other items inside the tent to check the space.' },
  'turntable': { title: 'Turntable', text: 'Pick a centre on the ground, then the camera orbits it automatically. Change speed, direction, distance and height live.' },
  'object library': { title: 'Object library', text: 'Link a folder of .obj files, then click or drag objects from it into the scene. Ctrl/Shift-click to pick several at once.' },
  'add obj object': { title: 'Add OBJ object', text: 'Import your own .obj model into the scene.' },
  'import scan': { title: 'Import scan', text: 'Load a 3D scan of the site (.glb, .obj, .ply ...) to sketch the tent on top of.' },
  'undo': { title: 'Undo', keys: 'Ctrl Z', text: 'Take back the last sketch change.' },
  'redo': { title: 'Redo', keys: 'Ctrl Y', text: 'Bring back a change you just undid.' },
  'site location': { title: 'Site location', text: 'Search for the venue address so the map, north direction and sun are correct.' },
  'toggle light or dark mode': { title: 'Light / dark mode', keys: 'L', text: 'Switch the look of the app between light and dark.' },
  'toggle side panel': { title: 'Side panel', keys: 'I', text: 'Show or hide the panel with dimensions, fabric needed and options.' },
  'export': { title: 'Export', text: 'Save the plan as a DXF drawing, an OBJ outline or a PDF sheet.' },
  'orbit': { title: 'Orbit view', text: 'Free 3D view. Drag to look around.' },
  'top': { title: 'Top view', text: 'Look straight down on the site, ideal for sketching.' },
  'depth': { title: 'Depth view', text: 'Shade the scan by distance so the shape of the ground is easy to read.' },
  'delete selected object': { title: 'Delete', keys: 'Del', text: 'Remove the selected object.' },
  'snap to grid': { title: 'Snap to grid', keys: 'X', text: 'Make moves jump in fixed steps.' },
  'start demo tour': { title: 'Demo tour', text: 'A guided walk through every feature of the tool.' },
  'quick help': { title: 'Quick help', text: 'This panel. Point at any button to read what it does.' },
};
const OVERVIEW = ['select', 'window select', 'sketch outline', 'place poles', 'measure', 'move / rotate / scale', 'corner poles', 'map', 'sun and shadows', 'furniture', 'turntable', 'object library', 'add obj object', 'import scan', 'undo', 'redo', 'site location', 'toggle side panel', 'export'];

export const QuickHelpButton = ({ open, onToggle }: { open: boolean; onToggle: () => void }) => (
  <IconBtn onClick={onToggle} active={open} aria-label="Quick help" aria-pressed={open}><HelpCircle size={15} /></IconBtn>
);

/** GarageBand-style Quick Help: hover any button to read what it does. */
export const QuickHelp = ({ onClose }: { onClose: () => void }) => {
  const [hover, setHover] = useState<Entry | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [size, setSize] = useState({ w: 300, h: 160 });
  const card = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const r = card.current?.getBoundingClientRect();
    if (r && (Math.abs(r.width - size.w) > 1 || Math.abs(r.height - size.h) > 1)) setSize({ w: r.width, h: r.height });
  });
  // Sit beside the button being described: below top-bar buttons, to the right of rail buttons.
  const home = () => document.querySelector('[aria-label="Quick help"]')?.getBoundingClientRect() ?? null;
  const a = anchor ?? home();
  let pos: { left: number; top: number } = { left: 60, top: 60 };
  if (a) {
    const vw = innerWidth, vh = innerHeight, gap = 8;
    if (a.top < 60) pos = { left: a.right - size.w, top: a.bottom + gap };
    else if (a.right + gap + size.w < vw) pos = { left: a.right + gap, top: a.top + a.height / 2 - 20 };
    else pos = { left: a.left - gap - size.w, top: a.top };
    pos = { left: Math.max(8, Math.min(pos.left, vw - size.w - 8)), top: Math.max(8, Math.min(pos.top, vh - size.h - 8)) };
  }

  useEffect(() => {
    let last: HTMLElement | null = null;
    const mark = (el: HTMLElement | null) => {
      if (last) last.style.outline = '';
      last = el;
      if (el) el.style.outline = '2px solid rgb(var(--accent, 245 158 11))';
    };
    const over = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('[data-quickhelp]')) { mark(null); return; }
      const b = t?.closest('button,[role="radio"]') as HTMLElement | null;
      if (!b) { mark(null); setHover(null); setAnchor(null); return; }
      const key = (b.getAttribute('aria-label') || b.textContent || '').trim().toLowerCase();
      const hit = HELP[key];
      mark(hit ? b : null);
      setHover(hit ?? null);
      setAnchor(hit ? b.getBoundingClientRect() : null);
    };
    const keyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('pointerover', over);
    addEventListener('keydown', keyDown);
    return () => { removeEventListener('pointerover', over); removeEventListener('keydown', keyDown); mark(null); };
  }, [onClose]);

  return (
    <div ref={card} data-quickhelp style={{ left: pos.left, top: pos.top }} className="fixed z-40 w-[300px] rounded-lg border border-line bg-panel/95 shadow-xl backdrop-blur-sm animate-rise">
      <div className="flex items-center h-8 pl-2.5 pr-1 border-b border-line">
        <HelpCircle size={13} className="text-accent mr-2" />
        <span className="text-xs font-medium text-ink flex-1">Quick help</span>
        <IconBtn className="h-6 w-6" onClick={onClose} aria-label="Close quick help"><X size={13} /></IconBtn>
      </div>
      <div className="p-3 text-xs leading-[17px] max-h-[60vh] overflow-y-auto">
        {hover ? (
          <>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-ink text-sm">{hover.title}</span>
              {hover.keys && <kbd className="px-1.5 rounded border border-line text-2xs text-muted">{hover.keys}</kbd>}
            </div>
            <p className="text-muted">{hover.text}</p>
          </>
        ) : (
          <>
            <p className="text-muted mb-2">Point at any button to see what it does. Esc closes help.</p>
            <ul className="space-y-1.5">
              {OVERVIEW.map((k) => (
                <li key={k}>
                  <span className="text-ink font-medium">{HELP[k].title}</span>
                  {HELP[k].keys && <span className="text-faint"> ({HELP[k].keys})</span>}
                  <span className="text-muted"> - {HELP[k].text}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
};
