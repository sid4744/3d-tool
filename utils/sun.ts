/** Sun position from date, time and place (the standard low-precision solar formulas, good to ~0.1°). */

export interface SunSettings {
  on: boolean;
  date: string;      // YYYY-MM-DD, local
  minutes: number;   // local clock time, minutes after midnight
  utcOffset: number; // hours; local clock = UTC + offset
  north: number;     // degrees the scene's -z axis is turned away from true north (models without a site)
}

export interface SunPos { altitude: number; azimuth: number } // radians; azimuth from north, clockwise

const rad = Math.PI / 180;

export function sunPosition(utcMs: number, lat: number, lon: number): SunPos {
  const d = utcMs / 86_400_000 - 0.5 + 2440588 - 2451545;
  const M = rad * (357.5291 + 0.98560028 * d);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  const e = rad * 23.4397;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
  const H = rad * (280.16 + 360.9856235 * d) - rad * -lon - ra;
  const phi = lat * rad;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { altitude, azimuth: az + Math.PI };
}

export function utcFromLocal(date: string, minutes: number, utcOffset: number): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1, 0, 0) + (minutes - utcOffset * 60) * 60_000;
}

export function sunAt(s: SunSettings, lat: number, lon: number): SunPos {
  return sunPosition(utcFromLocal(s.date, s.minutes, s.utcOffset), lat, lon);
}

/** Sunrise and sunset in local minutes after midnight, or null in polar day/night. */
export function sunTimes(s: SunSettings, lat: number, lon: number): { rise: number | null; set: number | null } {
  let rise: number | null = null, set: number | null = null;
  let prev = sunAt({ ...s, minutes: 0 }, lat, lon).altitude;
  for (let m = 5; m <= 1440; m += 5) {
    const a = sunAt({ ...s, minutes: m }, lat, lon).altitude;
    if (prev < 0 && a >= 0 && rise === null) rise = m;
    if (prev >= 0 && a < 0 && set === null) set = m;
    prev = a;
  }
  return { rise, set };
}

export const fmtClock = (minutes: number) => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export const todayISO = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

export const DEFAULT_SUN = (): SunSettings => ({
  on: true, date: todayISO(), minutes: 15 * 60, utcOffset: -new Date().getTimezoneOffset() / 60, north: 0,
});

/** Where the sun is in the scene (+x east, -z north), as a unit vector pointing towards the sun. */
export function sunVector(p: SunPos, northTurn = 0): [number, number, number] {
  const az = p.azimuth - northTurn * rad;
  const c = Math.cos(p.altitude);
  return [Math.sin(az) * c, Math.sin(p.altitude), -Math.cos(az) * c];
}
