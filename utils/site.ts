/**
 * Site context: real-world buildings, roads and water around a picked location, from OpenStreetMap
 * (Overpass). Coordinates become metres in scene space: origin = the picked point, +x east, +z south.
 */

export interface SiteBuilding { ring: [number, number][]; height: number }
export interface SiteRoad { pts: [number, number][]; width: number }
export interface SiteData {
  name: string;
  lat: number;
  lon: number;
  radius: number;
  buildings: SiteBuilding[];
  roads: SiteRoad[];
  water: [number, number][][];
  green?: [number, number][][]; // parks, grass, woods
  fetchedAt: number;
}

const ENDPOINTS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const ROAD_WIDTH: Record<string, number> = {
  motorway: 12, trunk: 11, primary: 9, secondary: 8, tertiary: 7, residential: 6, unclassified: 6,
  living_street: 5, service: 4, pedestrian: 4, footway: 1.5, path: 1.5, cycleway: 2, track: 3, steps: 1.5,
};

const isGreen = (t: Record<string, string>) =>
  /^(park|garden|pitch)$/.test(t.leisure ?? '') ||
  /^(grass|forest|meadow|recreation_ground|village_green)$/.test(t.landuse ?? '') ||
  /^(wood|scrub|grassland)$/.test(t.natural ?? '');

interface OsmWay { tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }

async function fetchOverpass(
  lat: number, lon: number, radius: number,
  onStatus?: (s: string) => void, signal?: AbortSignal,
): Promise<OsmWay[]> {
  // A bounding box is much cheaper for Overpass than `around`, and `out geom qt` skips sorting.
  const dLat = radius / 111_320;
  const dLon = radius / (111_320 * Math.cos((lat * Math.PI) / 180));
  const bbox = `${lat - dLat},${lon - dLon},${lat + dLat},${lon + dLon}`;
  const q = `[out:json][timeout:25][bbox:${bbox}];(way["building"];way["highway"];way["natural"="water"];way["waterway"="riverbank"];way["leisure"~"^(park|garden|pitch)$"];way["landuse"~"^(grass|forest|meadow|recreation_ground|village_green)$"];way["natural"~"^(wood|scrub|grassland)$"];);out geom qt;`;

  // Ask every mirror at once and take whichever answers first; the public servers are often
  // busy, so racing them is far faster than trying one after another.
  const json = await new Promise<{ elements: OsmWay[] }>((resolve, reject) => {
    const ctls = ENDPOINTS.map(() => new AbortController());
    const timer = setTimeout(() => finish(new Error('The map servers took too long. Try again in a minute.')), 75_000);
    let pending = ENDPOINTS.length, done = false;
    const errs: string[] = [];
    const finish = (r: { elements: OsmWay[] } | Error) => {
      if (done) return;
      done = true; clearTimeout(timer); clearInterval(tick);
      signal?.removeEventListener('abort', onAbort);
      ctls.forEach((c) => c.abort());
      r instanceof Error ? reject(r) : resolve(r);
    };
    const onAbort = () => finish(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
    signal?.addEventListener('abort', onAbort);
    const t0 = Date.now();
    const tick = setInterval(() => onStatus?.(`Waiting for the map servers… ${Math.round((Date.now() - t0) / 1000)} s`), 1000);
    onStatus?.('Asking the map servers…');
    ENDPOINTS.forEach((url, i) => {
      fetch(url, {
        method: 'POST', signal: ctls[i].signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status}`);
          const j = await res.json();
          if (!j?.elements) throw new Error(`${new URL(url).host}: bad answer`);
          onStatus?.(`Got it from ${new URL(url).host}`);
          finish(j);
        })
        .catch((e) => {
          if (done) return;
          errs.push(e?.message ?? String(e));
          if (--pending === 0) finish(new Error(`Couldn't reach the map servers (${errs.join('; ')}). Try again in a minute.`));
        });
    });
  });

  return json.elements;
}

// ---------------------------------------------------------------- OSM XML (api.openstreetmap.org / .osm files)

export function waysFromXml(xml: string): OsmWay[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error("That file isn't valid OSM XML.");
  const nodes = new Map<string, { lat: number; lon: number }>();
  doc.querySelectorAll('node').forEach((n) => {
    nodes.set(n.getAttribute('id')!, { lat: +n.getAttribute('lat')!, lon: +n.getAttribute('lon')! });
  });
  const ways: OsmWay[] = [];
  doc.querySelectorAll('way').forEach((w) => {
    const tags: Record<string, string> = {};
    w.querySelectorAll('tag').forEach((t) => { tags[t.getAttribute('k')!] = t.getAttribute('v')!; });
    if (!(tags.building || tags.highway || tags.natural === 'water' || tags.waterway === 'riverbank' || isGreen(tags))) return;
    const geometry: { lat: number; lon: number }[] = [];
    w.querySelectorAll('nd').forEach((nd) => { const n = nodes.get(nd.getAttribute('ref')!); if (n) geometry.push(n); });
    if (geometry.length > 1) ways.push({ tags, geometry });
  });
  return ways;
}

/** One request to the main OpenStreetMap API: fast and reliable, limited to ~50k nodes per box. */
async function fetchOsmApi(
  w: number, s: number, e: number, n: number, signal: AbortSignal | undefined, depth = 0,
): Promise<OsmWay[]> {
  const res = await fetch(`https://api.openstreetmap.org/api/0.6/map?bbox=${w},${s},${e},${n}`, { signal });
  if (res.status === 400 && depth < 2) { // too many nodes in one go: ask for the four quarters instead
    const mx = (w + e) / 2, my = (s + n) / 2;
    const parts = await Promise.all([
      fetchOsmApi(w, s, mx, my, signal, depth + 1), fetchOsmApi(mx, s, e, my, signal, depth + 1),
      fetchOsmApi(w, my, mx, n, signal, depth + 1), fetchOsmApi(mx, my, e, n, signal, depth + 1),
    ]);
    return parts.flat();
  }
  if (!res.ok) throw new Error(`api.openstreetmap.org: HTTP ${res.status}`);
  return waysFromXml(await res.text());
}

export async function fetchSite(
  lat: number, lon: number, radius: number, name: string,
  onStatus?: (s: string) => void, signal?: AbortSignal,
): Promise<SiteData> {
  const dLat = radius / 111_320;
  const dLon = radius / (111_320 * Math.cos((lat * Math.PI) / 180));
  let ways: OsmWay[];
  try {
    onStatus?.('Downloading map data from openstreetmap.org…');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25_000);
    const onAbort = () => ctl.abort();
    signal?.addEventListener('abort', onAbort);
    try { ways = await fetchOsmApi(lon - dLon, lat - dLat, lon + dLon, lat + dLat, ctl.signal); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
  } catch (e: any) {
    if (signal?.aborted) throw e;
    onStatus?.('That was slow, trying the Overpass servers instead…');
    ways = await fetchOverpass(lat, lon, radius, onStatus, signal);
  }
  onStatus?.('Building the 3D site…');
  return buildSiteData(ways, lat, lon, radius, name);
}

/** Build a site from a downloaded .osm (XML) or Overpass .json export, centred on lat/lon. */
export function siteFromFile(text: string, lat: number, lon: number, radius: number, name: string): SiteData {
  const t = text.trimStart();
  const ways: OsmWay[] = t.startsWith('{')
    ? (JSON.parse(t).elements ?? []).filter((w: OsmWay) => w.geometry)
    : waysFromXml(text);
  return buildSiteData(ways, lat, lon, radius, name);
}

function buildSiteData(ways: OsmWay[], lat: number, lon: number, radius: number, name: string): SiteData {
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  const toXZ = (g: { lat: number; lon: number }): [number, number] => [
    (g.lon - lon) * mPerDegLon,
    -(g.lat - lat) * mPerDegLat,
  ];

  const buildings: SiteBuilding[] = [];
  const roads: SiteRoad[] = [];
  const water: [number, number][][] = [];
  const green: [number, number][][] = [];

  for (const w of ways) {
    const t = w.tags ?? {};
    if (!w.geometry || w.geometry.length < 2) continue;
    const pts = w.geometry.map(toXZ);
    if (t.building) {
      if (pts.length < 4) continue;
      const ring = pts.slice(0, -1);
      let height = parseFloat(t.height ?? '');
      if (!isFinite(height)) {
        const levels = parseFloat(t['building:levels'] ?? '');
        height = isFinite(levels) ? levels * 3.2 + 1 : 7 + (Math.abs(Math.round(ring[0][0] * 7 + ring[0][1] * 3)) % 5);
      }
      buildings.push({ ring, height: Math.max(2.5, height) });
    } else if (t.highway) {
      roads.push({ pts, width: ROAD_WIDTH[t.highway] ?? 4 });
    } else if (t.natural === 'water' || t.waterway === 'riverbank') {
      if (pts.length >= 4) water.push(pts.slice(0, -1));
    } else if (isGreen(t)) {
      if (pts.length >= 4) green.push(pts.slice(0, -1));
    }
  }
  return { name, lat, lon, radius, buildings, roads, water, green, fetchedAt: Date.now() };
}


/** Place-name search (OpenStreetMap Nominatim). */
export async function searchPlace(query: string): Promise<{ lat: number; lon: number; label: string } | null> {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Search failed (HTTP ${res.status})`);
  const r = await res.json();
  return r[0] ? { lat: +r[0].lat, lon: +r[0].lon, label: String(r[0].display_name).split(',').map((p: string) => p.trim()).filter((p: string) => !/^\d+$/.test(p)).slice(0, 2).join(', ') } : null;
}

// ---------------------------------------------------------------- colours

/** Where the map sits relative to the scan: shift (m) along the ground, turn (°, anticlockwise from above) and scale. */
export interface SiteAlign { x: number; z: number; rot: number; scale: number }
export const NO_ALIGN: SiteAlign = { x: 0, z: 0, rot: 0, scale: 1 };

export interface SiteColors { ground: string; roads: string; buildings: string; water: string; green: string }

export const SITE_PRESETS: { id: string; label: string; colors: SiteColors }[] = [
  { id: 'paper', label: 'Paper', colors: { ground: '#e6e6df', roads: '#c9c9c0', buildings: '#f4f3ef', water: '#b3cde0', green: '#d3dec4' } },
  { id: 'colour', label: 'Colour', colors: { ground: '#d9d4c7', roads: '#8e9097', buildings: '#e9dccb', water: '#6fa8d6', green: '#9fc47f' } },
  { id: 'blueprint', label: 'Blueprint', colors: { ground: '#1d3b63', roads: '#2f5a93', buildings: '#7fa8dc', water: '#14294a', green: '#244b78' } },
  { id: 'night', label: 'Night', colors: { ground: '#1b1e24', roads: '#383d47', buildings: '#59606d', water: '#25384a', green: '#26332a' } },
  { id: 'mono', label: 'Mono', colors: { ground: '#d8d8d8', roads: '#a9a9a9', buildings: '#ffffff', water: '#bdbdbd', green: '#cacaca' } },
];

export const ELEMENT_LABEL: Record<keyof SiteColors, string> = {
  buildings: 'Buildings', roads: 'Roads', water: 'Water', green: 'Parks', ground: 'Ground',
};

/** Name of the place at a point (so the label always matches where the marker is). */
export async function reversePlace(lat: number, lon: number): Promise<string | null> {
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=17&lat=${lat}&lon=${lon}`);
  if (!res.ok) return null;
  const r = await res.json();
  if (!r || r.error) return null;
  const label = String(r.display_name ?? '').split(',').map((p: string) => p.trim()).filter((p: string) => p && !/^\d+$/.test(p)).slice(0, 2).join(', ');
  return label || null;
}
