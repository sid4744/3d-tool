import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { X, PenLine, Hand, Loader2, Wand2, Eraser } from 'lucide-react';
import { Btn, IconBtn, cx } from './ui';
import type { SiteData, SiteAlign } from '../utils/site';
import { autoAlign, loopHint, type ScanRaster, type AlignResult } from '../utils/autoalign';

export const AlignDialog = ({
  site, probe, onClose, onAligned,
}: {
  site: SiteData;
  probe: React.MutableRefObject<((raw?: boolean) => ScanRaster | null) | null>;
  onClose: () => void;
  onAligned: (a: SiteAlign, r: AlignResult, scan: ScanRaster) => void;
}) => {
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const poly = useRef<L.Polyline | null>(null);
  const drawing = useRef(false);
  const mode = useRef<'draw' | 'pan'>('draw');
  const [tool, setTool] = useState<'draw' | 'pan'>('draw');
  const [loop, setLoop] = useState<L.LatLng[]>([]);
  const [busy, setBusy] = useState<{ msg: string; frac: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapEl.current) return;
    const m = L.map(mapEl.current, { zoomControl: false, doubleClickZoom: false });
    const dLat = site.radius / 111_320, dLon = site.radius / (111_320 * Math.cos((site.lat * Math.PI) / 180));
    m.fitBounds([[site.lat - dLat, site.lon - dLon], [site.lat + dLat, site.lon + dLon]]);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Imagery © Esri',
    }).addTo(m);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    L.rectangle([[site.lat - dLat, site.lon - dLon], [site.lat + dLat, site.lon + dLon]], {
      color: '#ffffff', weight: 1, dashArray: '4 6', fill: false, interactive: false,
    }).addTo(m);
    poly.current = L.polyline([], { color: '#e5312b', weight: 4, lineJoin: 'round', interactive: false }).addTo(m);
    m.dragging.disable();

    m.on('mousedown', (e: L.LeafletMouseEvent) => {
      if (mode.current !== 'draw') return;
      drawing.current = true;
      poly.current!.setLatLngs([e.latlng]);
      setLoop([]);
    });
    m.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (!drawing.current) return;
      poly.current!.addLatLng(e.latlng);
    });
    const finish = () => {
      if (!drawing.current) return;
      drawing.current = false;
      const pts = (poly.current!.getLatLngs() as L.LatLng[]).slice();
      if (pts.length < 8) { poly.current!.setLatLngs([]); return; }
      pts.push(pts[0]);
      poly.current!.setLatLngs(pts);
      setLoop(pts.slice(0, -1));
    };
    m.on('mouseup', finish);
    addEventListener('mouseup', finish);
    map.current = m;
    setTimeout(() => m.invalidateSize(), 50);
    return () => { removeEventListener('mouseup', finish); m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    mode.current = tool;
    if (!map.current) return;
    if (tool === 'pan') map.current.dragging.enable(); else map.current.dragging.disable();
    map.current.getContainer().style.cursor = tool === 'draw' ? 'crosshair' : '';
  }, [tool]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose, busy]);

  const clear = () => { poly.current?.setLatLngs([]); setLoop([]); setError(null); };

  const run = async () => {
    setError(null);
    const scan = probe.current?.(true);
    if (!scan) { setError('No scan is loaded. Open your site model first (Open, top bar).'); return; }
    setBusy({ msg: 'Reading the scan from above…', frac: 0.02 });
    try {
      await new Promise((r) => setTimeout(r, 30));
      const hint = loopHint(loop.map((p) => ({ lat: p.lat, lng: p.lng })), site);
      const result = await autoAlign(scan, site, hint, (msg, frac) => setBusy({ msg, frac }));
      onAligned(result.align, result, scan);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally { setBusy(null); }
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 backdrop-blur-[2px] p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="w-full max-w-[860px] rounded-xl border border-line bg-panel shadow-2xl overflow-hidden animate-rise">
        <div className="flex items-center gap-2 h-12 px-4 border-b border-line">
          <Wand2 size={15} className="text-accent" />
          <h2 className="text-sm font-semibold">Auto-align scan</h2>
          <span className="text-xs text-muted hidden sm:inline">Draw a rough loop around the area your scan covers.</span>
          <IconBtn className="ml-auto" onClick={onClose} disabled={!!busy} aria-label="Close"><X size={15} /></IconBtn>
        </div>

        <div className="relative">
          <div ref={mapEl} className="h-[400px] w-full bg-bg" />
          <div className="absolute top-3 left-3 z-[500] flex gap-1 rounded-lg border border-line bg-panel/95 p-1 shadow-lg">
            {([['draw', 'Draw loop', <PenLine size={13} key="d" />], ['pan', 'Move map', <Hand size={13} key="p" />]] as const).map(([id, label, icon]) => (
              <button key={id} onClick={() => setTool(id)}
                className={cx('inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs transition-colors',
                  tool === id ? 'bg-accent text-bg font-medium' : 'text-muted hover:text-ink hover:bg-hover')}>
                {icon}{label}
              </button>
            ))}
          </div>
          {!loop.length && !busy && (
            <div className="absolute inset-x-0 bottom-3 z-[500] flex justify-center pointer-events-none">
              <span className="rounded-full bg-panel/95 border border-line px-3 py-1 text-xs text-muted shadow">
                Click and drag to draw around your scan, like you would with a marker
              </span>
            </div>
          )}
        </div>

        <div className="p-4 space-y-2.5">
          {busy ? (
            <div className="flex items-center gap-3 rounded-lg border border-line bg-bg px-3 py-2.5">
              <Loader2 size={16} className="animate-spin text-accent shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-ink">{busy.msg}</div>
                <div className="mt-1.5 h-1 rounded-full bg-line overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: `${Math.round(busy.frac * 100)}%` }} /></div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-2xs text-faint flex-1">
                {loop.length ? 'Loop drawn. Redraw it any time, or run the alignment.' : 'The satellite view is the same place as your site map, so the match is georeferenced.'}
              </span>
              <Btn size="sm" variant="ghost" onClick={clear} disabled={!loop.length}><Eraser size={13} /> Clear</Btn>
              <Btn variant="primary" onClick={run} disabled={!loop.length}><Wand2 size={14} /> Align automatically</Btn>
            </div>
          )}
          {error && <div className="text-xs text-danger">{error}</div>}
        </div>
      </div>
    </div>
  );
};
