import { Vector3 } from 'three';

/**
 * Positions for corner poles around a closed outline, each pushed `offset` metres away from
 * the membrane edge (a mitred offset: the pole is `offset` from *both* edges meeting at the corner).
 *
 * The outline is a closed loop whose last point repeats the first (that's how the sketch tool
 * stores it). Near-straight vertices are not corners and get no pole.
 */
export function cornerPoles(points: Vector3[], offset: number, minTurnDeg = 12): Vector3[] {
  const ring = points.length > 1 && points[0].distanceTo(points[points.length - 1]) < 1e-6
    ? points.slice(0, -1)
    : points.slice();
  const n = ring.length;
  if (n < 3) return [];

  // Orientation in the ground plane (x, z): decides which side of an edge is "outside".
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    area2 += a.x * b.z - b.x * a.z;
  }
  const side = area2 >= 0 ? 1 : -1;
  const outward = (a: Vector3, b: Vector3) => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    return new Vector3((dz / len) * side, 0, (-dx / len) * side);
  };

  const out: Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const prev = ring[(i + n - 1) % n], cur = ring[i], next = ring[(i + 1) % n];
    const n1 = outward(prev, cur), n2 = outward(cur, next);
    const turn = (Math.acos(Math.min(1, Math.max(-1, n1.dot(n2)))) * 180) / Math.PI;
    if (turn < minTurnDeg) continue;
    const bis = n1.clone().add(n2);
    if (bis.lengthSq() < 1e-9) continue;
    bis.normalize();
    // Distance along the bisector that keeps `offset` from both edges; capped for very sharp corners.
    const reach = offset / Math.max(bis.dot(n1), 0.33);
    out.push(new Vector3(cur.x + bis.x * reach, cur.y, cur.z + bis.z * reach));
  }
  return out;
}

/** Yaw (radians, about +Y) that turns a model whose lean points along local -Z so it leans along `dir` (ground plane). */
export const yawForDir = (dx: number, dz: number) => Math.atan2(-dx, -dz);
/** Ground-plane direction a pole with this yaw leans (and whose guy line runs). */
export const dirForYaw = (yaw: number): [number, number] => [-Math.sin(yaw), -Math.cos(yaw)];

const ringOf = (points: Vector3[]) =>
  points.length > 1 && points[0].distanceTo(points[points.length - 1]) < 1e-6 ? points.slice(0, -1) : points.slice();

/** Outward bisector of the corner at ring[i]: the angle between the two edges is split in half and pointed away from the inside. */
function outwardBisector(ring: Vector3[], i: number): [number, number] | null {
  const n = ring.length;
  const prev = ring[(i + n - 1) % n], cur = ring[i], next = ring[(i + 1) % n];
  const e1 = new Vector3(prev.x - cur.x, 0, prev.z - cur.z).normalize();
  const e2 = new Vector3(next.x - cur.x, 0, next.z - cur.z).normalize();
  const inward = e1.clone().add(e2);
  if (inward.lengthSq() < 1e-9) {            // straight edge: use the edge normal instead
    inward.set(-e1.z, 0, e1.x);
  } else inward.normalize();
  // Make sure "outward" really is outside (reflex corners flip the bisector).
  const out = inward.clone().multiplyScalar(-1);
  const probe = { x: cur.x + out.x * 0.05, z: cur.z + out.z * 0.05 };
  let inside = false;
  for (let a = 0, b = n - 1; a < n; b = a++) {
    const A = ring[a], B = ring[b];
    if ((A.z > probe.z) !== (B.z > probe.z) && probe.x < ((B.x - A.x) * (probe.z - A.z)) / (B.z - A.z) + A.x) inside = !inside;
  }
  if (inside) out.multiplyScalar(-1);
  return [out.x, out.z];
}

/** Corner poles with the outward bisector direction of each corner (the way the pole leans / its guy line runs). */
export function cornerPoleSpecs(points: Vector3[], offset: number): Array<{ position: Vector3; yaw: number }> {
  const ring = ringOf(points);
  const pos = cornerPoles(points, offset);
  return pos.map((p) => {
    // match the pole back to its corner (nearest ring vertex)
    let bi = 0, bd = Infinity;
    ring.forEach((r, i) => { const d = Math.hypot(r.x - p.x, r.z - p.z); if (d < bd) { bd = d; bi = i; } });
    const dir = outwardBisector(ring, bi) ?? [0, -1];
    return { position: p, yaw: yawForDir(dir[0], dir[1]) };
  });
}

/**
 * Which way should a pole placed at `point` face? Near a corner of an outline it takes that corner's outward bisector;
 * otherwise it faces away from the middle of the nearest outline. With no outline it faces -Z.
 */
export function poleYawAt(point: Vector3, outlines: Vector3[][]): number {
  let bestD = Infinity, dir: [number, number] | null = null, centre: Vector3 | null = null;
  for (const pts of outlines) {
    const ring = ringOf(pts);
    if (ring.length < 3) continue;
    ring.forEach((r, i) => {
      const d = Math.hypot(r.x - point.x, r.z - point.z);
      if (d >= bestD) return;
      const b = outwardBisector(ring, i);
      if (b) { bestD = d; dir = b; centre = ring.reduce((m, q) => m.add(q), new Vector3()).multiplyScalar(1 / ring.length); }
    });
  }
  if (!dir) return 0;
  const c = centre as Vector3 | null;
  if (bestD > 3 && c) {
    const far = Math.hypot(point.x - c.x, point.z - c.z);
    if (far > 1e-6) return yawForDir((point.x - c.x) / far, (point.z - c.z) / far);
  }
  const d = dir as [number, number];
  return yawForDir(d[0], d[1]);
}
