import { useEffect, useRef, useState } from 'react';

/**
 * Webcam head + eye tracking (MediaPipe Face Landmarker, runs fully on-device).
 *
 * Output goes to the module-level `head` object, not React state, so the 3D render loop
 * can read it every frame without triggering re-renders. Units are metres, origin at the
 * centre of the physical display, +x right, +y up, +z toward the viewer.
 */

export const head = { x: 0, y: 0, z: 0.55, lastSeen: 0 };

export const trackingSettings = {
  diagInches: 15.6,      // physical display diagonal
  hfovDeg: 65,           // webcam horizontal field of view
  strength: 1,           // exaggeration of lateral head movement
};

const IPD = 0.063;               // average interpupillary distance (m)
const CAM_ABOVE_SCREEN = 0.012;  // webcam sits just above the display's top edge

export const metersPerCssPx = () =>
  (trackingSettings.diagInches * 0.0254) / Math.hypot(screen.width, screen.height);

class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  constructor(private minCut = 1.5, private beta = 18) {}
  private static alpha(cut: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cut);
    return 1 / (1 + tau / dt);
  }
  filter(v: number, t: number) {
    if (this.x === null) { this.x = v; this.t = t; return v; }
    const dt = Math.max(t - this.t, 1e-3);
    this.t = t;
    this.dx += OneEuro.alpha(1, dt) * ((v - this.x) / dt - this.dx);
    const cut = this.minCut + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cut, dt) * (v - this.x);
    return this.x;
  }
}

export type TrackingStatus = 'off' | 'starting' | 'tracking' | 'lost' | 'error';

export interface TrackingInfo {
  status: TrackingStatus;
  message: string;
  distanceCm: number | null;
  stream: MediaStream | null;
}

export function useHeadTracking(enabled: boolean): TrackingInfo {
  const [info, setInfo] = useState<TrackingInfo>({ status: 'off', message: '', distanceCm: null, stream: null });
  const infoRef = useRef(info);
  infoRef.current = info;

  useEffect(() => {
    if (!enabled) {
      setInfo({ status: 'off', message: '', distanceCm: null, stream: null });
      return;
    }
    let cancelled = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let video: HTMLVideoElement | null = null;
    let landmarker: any = null;

    const patch = (p: Partial<TrackingInfo>) => {
      if (!cancelled) setInfo((prev) => ({ ...prev, ...p }));
    };

    (async () => {
      try {
        patch({ status: 'starting', message: 'Requesting camera…' });
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, frameRate: { ideal: 60 } },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        video = document.createElement('video');
        video.playsInline = true;
        video.muted = true;
        video.srcObject = stream;
        await video.play();
        patch({ stream, message: 'Loading face model…' });

        const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
        const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`);
        const make = (delegate: 'GPU' | 'CPU') =>
          FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}models/face_landmarker.task`, delegate },
            runningMode: 'VIDEO',
            numFaces: 1,
          });
        try { landmarker = await make('GPU'); } catch { landmarker = await make('CPU'); }
        if (cancelled) { landmarker.close(); return; }

        const fx = new OneEuro(), fy = new OneEuro(), fz = new OneEuro(0.8, 6);
        let lastTime = -1;
        let lastReport = 0;

        const loop = (now: number) => {
          raf = requestAnimationFrame(loop);
          if (!video || video.readyState < 2 || video.currentTime === lastTime) {
            maybeLost(now);
            return;
          }
          lastTime = video.currentTime;
          const res = landmarker.detectForVideo(video, now);
          const lm = res.faceLandmarks?.[0];
          if (!lm || lm.length < 478) { maybeLost(now); return; }

          const vw = video.videoWidth, vh = video.videoHeight;
          const a = lm[468], b = lm[473]; // iris centres → eye tracking, not just head pose
          const ipdPx = Math.hypot((a.x - b.x) * vw, (a.y - b.y) * vh);
          if (ipdPx < 4) return;

          const f = (vw / 2) / Math.tan((trackingSettings.hfovDeg * Math.PI) / 360);
          const z = (f * IPD) / ipdPx;
          const cx = ((a.x + b.x) / 2) * vw - vw / 2;
          const cy = ((a.y + b.y) / 2) * vh - vh / 2;
          const screenH = screen.height * metersPerCssPx();
          const t = now / 1000;

          head.x = fx.filter((-cx / f) * z, t);                       // mirrored: image-left is the user's right
          head.y = fy.filter((-cy / f) * z + screenH / 2 + CAM_ABOVE_SCREEN, t);
          head.z = fz.filter(Math.min(Math.max(z, 0.25), 1.5), t);
          head.lastSeen = now;

          if (now - lastReport > 250) {
            lastReport = now;
            patch({ status: 'tracking', message: '', distanceCm: Math.round(z * 100) });
          }
        };
        const maybeLost = (now: number) => {
          if (now - head.lastSeen > 800 && infoRef.current.status === 'tracking') {
            patch({ status: 'lost', message: 'Face not visible', distanceCm: null });
          }
        };
        raf = requestAnimationFrame(loop);
      } catch (e: any) {
        console.warn('Head tracking unavailable', e);
        const denied = e?.name === 'NotAllowedError';
        patch({
          status: 'error',
          message: denied ? 'Camera access was blocked' : 'Camera or face model unavailable',
        });
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      landmarker?.close?.();
      stream?.getTracks().forEach((t) => t.stop());
      head.lastSeen = 0;
    };
  }, [enabled]);

  return info;
}
