import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Search, X, MapPin, Loader2, FileUp, ExternalLink } from 'lucide-react';
import { Btn, IconBtn } from './ui';
import { fetchSite, searchPlace, reversePlace, siteFromFile, type SiteData } from '../utils/site';

const START = { lat: 52.0907, lon: 5.1214 }; // Utrecht, until the user picks somewhere

export const SiteDialog = ({
  initial, onClose, onBuilt,
}: {
  initial: SiteData | null;
  onClose: () => void;
  onBuilt: (s: SiteData) => void;
}) => {
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const circle = useRef<L.Circle | null>(null);
  const abort = useRef<AbortController | null>(null);
  const fileEl = useRef<HTMLInputElement>(null);
  const [elapsed, setElapsed] = useState(0);

  const [pos, setPos] = useState({ lat: initial?.lat ?? START.lat, lon: initial?.lon ?? START.lon });
  const [radius, setRadius] = useState(initial?.radius ?? 150);
  const [name, setName] = useState(initial?.name ?? '');
  const autoName = useRef(true);     // false once the user types their own name
  const skipReverse = useRef(true);  // the first position and search results already have a matching name
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = status !== null;
  useEffect(() => {
    if (!busy) { setElapsed(0); return; }
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [busy]);

  // map setup (once)
  useEffect(() => {
    if (!mapEl.current) return;
    const m = L.map(mapEl.current, { zoomControl: false }).setView([pos.lat, pos.lon], initial ? 16 : 13);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Imagery © Esri',
    }).addTo(m);
    const icon = L.divIcon({
      className: '', iconSize: [18, 18], iconAnchor: [9, 9],
      html: '<div style="width:18px;height:18px;border-radius:50%;background:#f5a524;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.5)"></div>',
    });
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    marker.current = L.marker([pos.lat, pos.lon], { icon, draggable: true }).addTo(m);
    circle.current = L.circle([pos.lat, pos.lon], { radius, color: '#f5a524', weight: 2, fillOpacity: 0.08 }).addTo(m);
    marker.current.on('drag', () => { const p = marker.current!.getLatLng(); circle.current!.setLatLng(p); });
    marker.current.on('dragend', () => { const p = marker.current!.getLatLng(); setPos({ lat: p.lat, lon: p.lng }); });
    m.on('click', (e: L.LeafletMouseEvent) => setPos({ lat: e.latlng.lat, lon: e.latlng.lng }));
    map.current = m;
    setTimeout(() => m.invalidateSize(), 50);
    return () => { m.remove(); map.current = null; abort.current?.abort(); };
  }, []);

  // Reopening with a saved site: make sure the name still matches the spot.
  useEffect(() => {
    if (!initial) return;
    reversePlace(initial.lat, initial.lon).then((l) => { if (l && autoName.current) setName(l); }).catch(() => {});
  }, []);

  // Moving the marker renames the site after the new spot (unless you typed a name yourself).
  useEffect(() => {
    if (skipReverse.current) { skipReverse.current = false; return; }
    if (!autoName.current) return;
    setName(`${pos.lat.toFixed(4)}, ${pos.lon.toFixed(4)}`);
    const t = setTimeout(async () => {
      try { const label = await reversePlace(pos.lat, pos.lon); if (label && autoName.current) setName(label); } catch { /* keep coordinates */ }
    }, 500);
    return () => clearTimeout(t);
  }, [pos]);
  useEffect(() => {
    marker.current?.setLatLng([pos.lat, pos.lon]);
    circle.current?.setLatLng([pos.lat, pos.lon]);
  }, [pos]);
  useEffect(() => { circle.current?.setRadius(radius); }, [radius]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);

  const search = async () => {
    if (!query.trim()) return;
    setError(null); setStatus('Searching…');
    try {
      const r = await searchPlace(query.trim());
      if (!r) { setError('No place found for that search.'); return; }
      skipReverse.current = true;
      setPos({ lat: r.lat, lon: r.lon });
      if (autoName.current) setName(r.label);
      map.current?.setView([r.lat, r.lon], 17);
    } catch (e: any) { setError(e.message); } finally { setStatus(null); }
  };

  const build = async () => {
    setError(null); setStatus('Starting…');
    abort.current = new AbortController();
    try {
      const site = await fetchSite(pos.lat, pos.lon, radius, name.trim() || `${pos.lat.toFixed(4)}, ${pos.lon.toFixed(4)}`, setStatus, abort.current.signal);
      if (!site.buildings.length && !site.roads.length) { setError('Nothing mapped here. Try a bigger radius or another spot.'); return; }
      onBuilt(site);
    } catch (e: any) {
      if (e?.name !== 'AbortError') setError(e.message);
    } finally { setStatus(null); }
  };

  const dLat = radius / 111_320, dLon = radius / (111_320 * Math.cos((pos.lat * Math.PI) / 180));
  const downloadUrl = `https://api.openstreetmap.org/api/0.6/map?bbox=${(pos.lon - dLon).toFixed(6)},${(pos.lat - dLat).toFixed(6)},${(pos.lon + dLon).toFixed(6)},${(pos.lat + dLat).toFixed(6)}`;

  const useFile = async (f: File) => {
    setError(null); setStatus('Reading the file…');
    try {
      const site = siteFromFile(await f.text(), pos.lat, pos.lon, radius, name.trim() || f.name.replace(/\.[^.]+$/, ''));
      if (!site.buildings.length && !site.roads.length) { setError('No buildings or roads in that file around the marker.'); return; }
      onBuilt(site);
    } catch (e: any) { setError(e.message); } finally { setStatus(null); }
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 backdrop-blur-[2px] p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="w-full max-w-[860px] rounded-xl border border-line bg-panel shadow-2xl overflow-hidden animate-rise">
        <div className="flex items-center gap-2 h-12 px-4 border-b border-line">
          <MapPin size={15} className="text-accent" />
          <h2 className="text-sm font-semibold">Site location</h2>
          <span className="text-xs text-muted hidden sm:inline">Click the map to place the origin of your site.</span>
          <IconBtn className="ml-auto" onClick={() => { abort.current?.abort(); onClose(); }} aria-label="Close"><X size={15} /></IconBtn>
        </div>

        <div className="relative">
          <div ref={mapEl} className="h-[380px] w-full bg-bg" />
          <form
            className="absolute top-3 left-3 right-3 z-[500] flex gap-2 max-w-sm"
            onSubmit={(e) => { e.preventDefault(); search(); }}
          >
            <input
              value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search an address or place"
              className="flex-1 text-sm shadow-lg"
            />
            <Btn type="submit" disabled={busy}><Search size={14} /></Btn>
          </form>
        </div>

        <div className="p-4 grid gap-3 sm:grid-cols-[1fr_200px_auto] items-end">
          <label className="text-xs text-muted flex flex-col gap-1">
            Name
            <input value={name} onChange={(e) => { autoName.current = false; setName(e.target.value); }} placeholder="e.g. Dam Square" className="text-sm" />
          </label>
          <label className="text-xs text-muted flex flex-col gap-1">
            <span className="flex justify-between">Radius <span className="font-mono text-ink">{radius} m</span></span>
            <input type="range" min={50} max={600} step={25} value={radius} onChange={(e) => setRadius(+e.target.value)} />
          </label>
          <Btn variant="primary" onClick={build} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <MapPin size={14} />}
            {busy ? 'Working…' : initial ? 'Rebuild site' : 'Build site'}
          </Btn>
        </div>
        <div className="px-4 pb-4 -mt-1 space-y-2.5">
          {busy ? (
            <div className="flex items-center gap-3 rounded-lg border border-line bg-bg px-3 py-2.5">
              <Loader2 size={16} className="animate-spin text-accent shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-ink truncate">{status}</div>
                <div className="text-2xs text-faint">{elapsed} s{elapsed > 12 ? ' · the map servers are slow right now. You can cancel and load a downloaded file instead.' : ''}</div>
              </div>
              <Btn size="sm" onClick={() => { abort.current?.abort(); setStatus(null); }}>Cancel</Btn>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-2xs text-faint">
              <span className="font-mono">{pos.lat.toFixed(5)}, {pos.lon.toFixed(5)}</span>
              <span className="mx-auto" />
              <a href={downloadUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted hover:text-ink">
                <ExternalLink size={11} /> Download this area (.osm)
              </a>
              <button onClick={() => fileEl.current?.click()} className="inline-flex items-center gap-1 text-muted hover:text-ink">
                <FileUp size={11} /> Use a downloaded file
              </button>
              <input ref={fileEl} type="file" accept=".osm,.xml,.json" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) useFile(f); e.target.value = ''; }} />
            </div>
          )}
          {error && <div className="text-xs text-danger">{error}</div>}
        </div>
      </div>
    </div>
  );
};
