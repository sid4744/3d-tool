import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

export interface LibraryItem {
  id: string;      // path inside the folder
  name: string;    // file name
  handle: any;     // FileSystemFileHandle
}
export type LibraryStatus = 'none' | 'needs-permission' | 'loading' | 'ready' | 'unsupported' | 'error';

const DB = 'qtents-library';
const KEY = 'folder';
const MAX_ITEMS = 600;
const MAX_THUMB_BYTES = 40 * 1024 * 1024;

const idb = (): Promise<IDBDatabase> => new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const saveHandle = async (h: any) => {
  try { const db = await idb(); db.transaction('kv', 'readwrite').objectStore('kv').put(h, KEY); } catch { /* storage unavailable */ }
};
const loadHandle = async (): Promise<any | null> => {
  try {
    const db = await idb();
    return await new Promise((res) => {
      const r = db.transaction('kv').objectStore('kv').get(KEY);
      r.onsuccess = () => res(r.result ?? null);
      r.onerror = () => res(null);
    });
  } catch { return null; }
};

async function walk(dir: any, prefix: string, depth: number, out: LibraryItem[]) {
  for await (const [name, h] of dir.entries()) {
    if (out.length >= MAX_ITEMS) return;
    if (h.kind === 'file' && /\.obj$/i.test(name)) out.push({ id: prefix + name, name, handle: h });
    else if (h.kind === 'directory' && depth < 4 && !name.startsWith('.')) await walk(h, `${prefix}${name}/`, depth + 1, out);
  }
}

// One shared offscreen renderer for all thumbnails.
let thumbGl: THREE.WebGLRenderer | null = null;
async function renderThumb(file: File): Promise<{ url: string; size: [number, number, number] } | null> {
  if (file.size > MAX_THUMB_BYTES) return null;
  const obj = new OBJLoader().parse(await file.text());
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return null;
  if (!thumbGl) {
    thumbGl = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbGl.setSize(144, 144, false);
    thumbGl.setPixelRatio(1);
  }
  const scene = new THREE.Scene();
  obj.traverse((o: any) => { if (o.isMesh) o.material = new THREE.MeshStandardMaterial({ color: '#c9b79c', roughness: 0.7, metalness: 0.05, side: THREE.DoubleSide }); });
  scene.add(obj);
  scene.add(new THREE.HemisphereLight('#ffffff', '#8a8f98', 1.1));
  const sun = new THREE.DirectionalLight('#ffffff', 2.2); sun.position.set(3, 5, 4); scene.add(sun);
  const c = box.getCenter(new THREE.Vector3());
  const r = box.getSize(new THREE.Vector3()).length() / 2 || 1;
  const cam = new THREE.PerspectiveCamera(35, 1, r * 0.05, r * 20);
  cam.position.copy(c).add(new THREE.Vector3(1, 0.8, 1.2).normalize().multiplyScalar(r / Math.sin(THREE.MathUtils.degToRad(17.5)) * 1.05));
  cam.lookAt(c);
  thumbGl.setClearColor(0x000000, 0);
  thumbGl.render(scene, cam);
  const url = thumbGl.domElement.toDataURL('image/png');
  const sz = box.getSize(new THREE.Vector3());
  obj.traverse((o: any) => { if (o.isMesh) { o.geometry?.dispose(); o.material?.dispose(); } });
  return { url, size: [sz.x, sz.y, sz.z] };
}

/** A linked folder of .obj files, with thumbnails. The folder is remembered between visits. */
export function useLibrary() {
  const supported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  const [status, setStatus] = useState<LibraryStatus>(supported ? 'none' : 'unsupported');
  const [folder, setFolder] = useState<string | null>(null);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const [sizes, setSizes] = useState<Record<string, [number, number, number]>>({});
  const handleRef = useRef<any>(null);
  const runId = useRef(0);

  const load = useCallback(async (h: any) => {
    const run = ++runId.current;
    setStatus('loading'); setFolder(h.name); setThumbs({}); setSizes({});
    try {
      const out: LibraryItem[] = [];
      await walk(h, '', 0, out);
      out.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
      if (run !== runId.current) return;
      setItems(out); setStatus('ready');
      for (const it of out) {                       // thumbnails trickle in, one at a time
        if (run !== runId.current) return;
        let t: { url: string; size: [number, number, number] } | null = null;
        try { t = await renderThumb(await it.handle.getFile()); } catch { t = null; }
        if (run !== runId.current) return;
        setThumbs((m) => ({ ...m, [it.id]: t?.url ?? null }));
        if (t) setSizes((m) => ({ ...m, [it.id]: t!.size }));
        await new Promise((r) => setTimeout(r, 0));
      }
    } catch { if (run === runId.current) setStatus('error'); }
  }, []);

  // Reconnect to the remembered folder.
  useEffect(() => {
    if (!supported) return;
    (async () => {
      const h = await loadHandle();
      if (!h) return;
      handleRef.current = h; setFolder(h.name);
      try {
        if ((await h.queryPermission({ mode: 'read' })) === 'granted') load(h); else setStatus('needs-permission');
      } catch { setStatus('needs-permission'); }
    })();
  }, [supported, load]);

  const chooseFolder = useCallback(async () => {
    try {
      const h = await (window as any).showDirectoryPicker({ id: 'qtents-library', mode: 'read' });
      handleRef.current = h; await saveHandle(h); load(h);
    } catch { /* cancelled */ }
  }, [load]);

  const reconnect = useCallback(async () => {
    const h = handleRef.current;
    if (!h) return chooseFolder();
    try { if ((await h.requestPermission({ mode: 'read' })) === 'granted') load(h); } catch { chooseFolder(); }
  }, [load, chooseFolder]);

  const refresh = useCallback(() => { if (handleRef.current) load(handleRef.current); }, [load]);

  return { supported, status, folder, items, thumbs, sizes, chooseFolder, reconnect, refresh };
}
