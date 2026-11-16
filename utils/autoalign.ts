/**
 * Auto-align a 3D scan to the OpenStreetMap site data.
 *
 * The scan is flattened to a top-down height map; "tall" pixels become a building mask. That mask is
 * compared with the map's building footprints at many rotations (and a couple of scales) using FFT
 * cross-correlation, starting from the rough area the user circled on the satellite image.
 */
import type { SiteData, SiteAlign } from './site';

export interface ScanRaster {
  n: number;            // pixels per side
  half: number;         // half-size of the covered square, scene units
  cx: number; cz: number; // scan centre in the scene (xz)
  pivotX?: number; pivotZ?: number; // the point the scan is moved and turned about
  height: Float32Array; // world height per pixel, NaN where the scan has nothing. Row 0 = north (-z).
}

export interface LoopHint { cx: number; cz: number; radius: number } // site metres (x east, z south)

export interface AlignResult { align: SiteAlign; score: number; runnerUp: number }

const rad = Math.PI / 180;

// ---------------------------------------------------------------- FFT

function fft1(re: Float64Array, im: Float64Array, inv: boolean) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((2 * Math.PI) / len) * (inv ? 1 : -1);
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

function fft2(re: Float64Array, im: Float64Array, n: number, inv: boolean) {
  for (let r = 0; r < n; r++) fft1(re.subarray(r * n, (r + 1) * n), im.subarray(r * n, (r + 1) * n), inv);
  const cr = new Float64Array(n), ci = new Float64Array(n);
  for (let c = 0; c < n; c++) {
    for (let r = 0; r < n; r++) { cr[r] = re[r * n + c]; ci[r] = im[r * n + c]; }
    fft1(cr, ci, inv);
    for (let r = 0; r < n; r++) { re[r * n + c] = cr[r]; im[r * n + c] = ci[r]; }
  }
}

// ---------------------------------------------------------------- masks

/** Binary "building" mask (1 = tall) of the scan, n×n, from its height map. */
function scanBuildingMask(scan: ScanRaster): Float32Array {
  const hs: number[] = [];
  for (let i = 0; i < scan.height.length; i++) if (!Number.isNaN(scan.height[i])) hs.push(scan.height[i]);
  if (hs.length < 100) throw new Error("The scan didn't render from above. Is it loaded and visible?");
  hs.sort((a, b) => a - b);
  const ground = hs[Math.floor(hs.length * 0.15)];
  const top = hs[Math.floor(hs.length * 0.98)];
  const thr = ground + Math.max((top - ground) * 0.25, 1e-6);
  const mask = new Float32Array(scan.height.length);
  let count = 0;
  for (let i = 0; i < mask.length; i++) if (scan.height[i] > thr) { mask[i] = 1; count++; }
  if (count < 30) throw new Error("Couldn't find any buildings in the scan (nothing stands clearly above the ground).");
  return mask;
}

/** Map footprints around qc, n×n pixels of `res` metres. */
function mapBuildingRaster(site: SiteData, qx: number, qz: number, n: number, res: number): Float32Array {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, n, n);
  ctx.setTransform(1 / res, 0, 0, 1 / res, n / 2 - qx / res, n / 2 - qz / res);
  ctx.fillStyle = '#fff';
  for (const b of site.buildings) {
    ctx.beginPath();
    b.ring.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
    ctx.closePath(); ctx.fill();
  }
  const d = ctx.getImageData(0, 0, n, n).data;
  const out = new Float32Array(n * n);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] / 255;
  return out;
}

/** The scan mask resampled into map orientation: grid point u -> scan offset  p' = s·R(rot)·u. */
function rotatedMask(mask: Float32Array, scan: ScanRaster, n: number, res: number, rot: number, s: number): Float32Array {
  const out = new Float32Array(n * n);
  const cs = Math.cos(rot * rad), sn = Math.sin(rot * rad);
  const k = scan.n / (2 * scan.half);
  const sub = [-1 / 3, 0, 1 / 3];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let acc = 0;
      for (const a of sub) for (const b of sub) {
        const ux = (j + 0.5 + a - n / 2) * res, uz = (i + 0.5 + b - n / 2) * res;
        const px = s * (ux * cs + uz * sn), pz = s * (-ux * sn + uz * cs);
        const sj = Math.floor((px + scan.half) * k), si = Math.floor((pz + scan.half) * k);
        if (sj >= 0 && sj < scan.n && si >= 0 && si < scan.n) acc += mask[si * scan.n + sj];
      }
      out[i * n + j] = acc / 9;
    }
  }
  return out;
}

const zeroMean = (a: Float32Array) => {
  let m = 0; for (let i = 0; i < a.length; i++) m += a[i]; m /= a.length;
  let e = 0; const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) { out[i] = a[i] - m; e += out[i] * out[i]; }
  return { v: out, norm: Math.sqrt(e) };
};

interface Ctx { n: number; res: number; qx: number; qz: number; fr: Float64Array; fi: Float64Array; norm: number; maxShift: number }

function makeCtx(site: SiteData, qx: number, qz: number, n: number, res: number, maxShiftPx: number): Ctx {
  const o = zeroMean(mapBuildingRaster(site, qx, qz, n, res));
  const fi = new Float64Array(n * n);
  fft2(o.v, fi, n, false);
  return { n, res, qx, qz, fr: o.v, fi, norm: o.norm, maxShift: maxShiftPx };
}

/** Best shift for one rotation: returns the NCC score and the pixel shift. */
function bestShift(ctx: Ctx, rotated: Float32Array) {
  const { n } = ctx;
  const m = zeroMean(rotated);
  if (m.norm < 1e-6 || ctx.norm < 1e-6) return { score: -1, dx: 0, dz: 0 };
  const mi = new Float64Array(n * n);
  fft2(m.v, mi, n, false);
  const pr = new Float64Array(n * n), pi = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) { // conj(M) * O
    pr[i] = m.v[i] * ctx.fr[i] + mi[i] * ctx.fi[i];
    pi[i] = m.v[i] * ctx.fi[i] - mi[i] * ctx.fr[i];
  }
  fft2(pr, pi, n, true);
  let best = -Infinity, bi = 0, bj = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const di = i > n / 2 ? i - n : i, dj = j > n / 2 ? j - n : j;
    if (Math.abs(di) > ctx.maxShift || Math.abs(dj) > ctx.maxShift) continue;
    const v = pr[i * n + j];
    if (v > best) { best = v; bi = di; bj = dj; }
  }
  return { score: best / (m.norm * ctx.norm), dx: bj, dz: bi };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// ---------------------------------------------------------------- the search

export async function autoAlign(
  scan: ScanRaster, site: SiteData, hint: LoopHint, onProgress?: (msg: string, frac: number) => void,
): Promise<AlignResult> {
  const mask = scanBuildingMask(scan);

  // Scales to try: as measured, plus the one that would make the scan fill the circled area (e.g. a scan in other units).
  const scales = [1];
  const ratio = hint.radius / (scan.half * 0.8);
  if (ratio > 1.6 || ratio < 0.62) scales.push(ratio);

  const N1 = 128;
  let best = { score: -Infinity, rot: 0, s: 1, dvx: 0, dvz: 0 };
  const perRot = new Map<string, number>();

  for (let si = 0; si < scales.length; si++) {
    const s = scales[si];
    const footprint = scan.half / s;
    const W = Math.min(Math.max(hint.radius, footprint) * 1.7, 320);
    const res = (2 * W) / N1;
    const ctx = makeCtx(site, hint.cx, hint.cz, N1, res, Math.floor(N1 * 0.3));
    const steps = 90;
    for (let k = 0; k < steps; k++) {
      const rot = (k * 360) / steps;
      const r = bestShift(ctx, rotatedMask(mask, scan, N1, res, rot, s));
      perRot.set(`${si}:${k}`, r.score);
      if (r.score > best.score) best = { score: r.score, rot, s, dvx: hint.cx + r.dx * res, dvz: hint.cz + r.dz * res };
      if (k % 6 === 0) { onProgress?.('Trying orientations…', (si * steps + k) / (scales.length * steps) * 0.6); await tick(); }
    }
  }

  // Runner-up: best score at least 20° away from the winner (how clear-cut the match is).
  let runnerUp = -Infinity;
  for (const [key, sc] of perRot) {
    const [si, k] = key.split(':').map(Number);
    if (scales[si] !== best.s) continue;
    const rot = (k * 360) / 90;
    const diff = Math.min(Math.abs(rot - best.rot), 360 - Math.abs(rot - best.rot));
    if (diff >= 20 && sc > runnerUp) runnerUp = sc;
  }

  // Refine: finer rotation steps and a finer grid around the winner.
  onProgress?.('Refining…', 0.7);
  await tick();
  const N2 = 256;
  const W2 = Math.max(Math.min((scan.half / best.s) * 1.6, 320), 40);
  const res2 = (2 * W2) / N2;
  const ctx2 = makeCtx(site, best.dvx, best.dvz, N2, res2, Math.floor(N2 * 0.12));
  let fine = { score: -Infinity, rot: best.rot, dvx: best.dvx, dvz: best.dvz };
  for (let k = -8; k <= 8; k++) {
    const rot = best.rot + k * 0.75;
    const r = bestShift(ctx2, rotatedMask(mask, scan, N2, res2, rot, best.s));
    if (r.score > fine.score) fine = { score: r.score, rot, dvx: best.dvx + r.dx * res2, dvz: best.dvz + r.dz * res2 };
    if (k % 3 === 0) { onProgress?.('Refining…', 0.7 + ((k + 8) / 16) * 0.28); await tick(); }
  }

  // p = c + s·R(rot)·(q − d)  →  site origin sits at T = c − s·R(rot)·d
  const cs = Math.cos(fine.rot * rad), sn = Math.sin(fine.rot * rad);
  const tx = scan.cx - best.s * (fine.dvx * cs + fine.dvz * sn);
  const tz = scan.cz - best.s * (-fine.dvx * sn + fine.dvz * cs);
  const rot = ((fine.rot + 180) % 360 + 360) % 360 - 180;
  return { align: { x: tx, z: tz, rot, scale: best.s }, score: fine.score, runnerUp };
}

/** Centre and equivalent radius (site metres) of a freehand loop of lat/lon points. */
export function loopHint(loop: { lat: number; lng: number }[], site: SiteData): LoopHint {
  const mLat = 111_320, mLon = 111_320 * Math.cos((site.lat * Math.PI) / 180);
  const pts = loop.map((p) => [(p.lng - site.lon) * mLon, -(p.lat - site.lat) * mLat] as const);
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
    const f = x1 * z2 - x2 * z1;
    a += f; cx += (x1 + x2) * f; cz += (z1 + z2) * f;
  }
  a /= 2;
  if (Math.abs(a) < 1) {
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, mz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return { cx: mx, cz: mz, radius: 10 };
  }
  return { cx: cx / (6 * a), cz: cz / (6 * a), radius: Math.sqrt(Math.abs(a) / Math.PI) };
}

/** Height of the scan's floor (world units): a low percentile of everything the scan covers. */
export function scanFloor(scan: ScanRaster): number | null {
  const hs: number[] = [];
  for (let i = 0; i < scan.height.length; i++) if (!Number.isNaN(scan.height[i])) hs.push(scan.height[i]);
  if (hs.length < 100) return null;
  hs.sort((a, b) => a - b);
  return hs[Math.floor(hs.length * 0.1)];
}

/** Indices of map buildings that sit where the scan has geometry (so they would poke through it). */
export function buildingsOverlappingScan(site: SiteData, align: SiteAlign, scan: ScanRaster): Set<number> {
  const out = new Set<number>();
  const cs = Math.cos(align.rot * rad), sn = Math.sin(align.rot * rad), s = align.scale;
  const k = scan.n / (2 * scan.half);
  const covered = (qx: number, qz: number) => {
    const px = align.x + s * (qx * cs + qz * sn), pz = align.z + s * (-qx * sn + qz * cs);
    const j = Math.floor((px - scan.cx + scan.half) * k), i = Math.floor((pz - scan.cz + scan.half) * k);
    for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && ii < scan.n && jj >= 0 && jj < scan.n && !Number.isNaN(scan.height[ii * scan.n + jj])) return true;
    }
    return false;
  };
  site.buildings.forEach((b, idx) => {
    let mx = 0, mz = 0;
    for (const [x, z] of b.ring) { mx += x; mz += z; }
    mx /= b.ring.length; mz /= b.ring.length;
    if (covered(mx, mz) || b.ring.some(([x, z]) => covered(x, z))) out.add(idx);
  });
  return out;
}

/**
 * autoAlign solves "where does the map sit relative to the scan". We keep the map fixed (north-up) and move
 * the scan instead, so convert: the scan's pose is the inverse transform, expressed as an offset of its centre.
 */
export function scanPoseFromMap(a: SiteAlign, cx: number, cz: number): SiteAlign {
  const t = a.rot * rad, cs = Math.cos(t), sn = Math.sin(t);
  const dx = cx - a.x, dz = cz - a.z;
  const qx = (dx * cs - dz * sn) / a.scale, qz = (dx * sn + dz * cs) / a.scale;
  const rot = ((-a.rot + 180) % 360 + 360) % 360 - 180;
  return { x: qx - cx, z: qz - cz, rot, scale: 1 / a.scale };
}
