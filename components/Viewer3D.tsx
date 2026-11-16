import { X } from 'lucide-react';
import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Canvas, useThree, useLoader, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Environment, Lightformer, Line, TransformControls, Text, Html } from '@react-three/drei';
import monoFont from '@fontsource/geist-mono/files/geist-mono-latin-500-normal.woff?url';
import { cx } from './ui';
import * as THREE from 'three';
import { Vector3, Group } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { dirForYaw, poleYawAt } from '../utils/poles';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SiteData, SiteColors, SiteAlign } from '../utils/site';
import { sunVector, type SunPos } from '../utils/sun';
import type { ScanRaster } from '../utils/autoalign';
import { DepthCamera } from './DepthCamera';
import { TurntableState, ModelKind, ViewMode, ToolMode, TentData, LayerState, MeasurementState, ExternalModel, FurnitureItem, SelectionItem, FabricPanel } from '../types';

const ACCENT = '#f5a524';
const DANGER = '#e5534b';

export interface FitRequest { center: Vector3; radius: number; nonce: number }

// -- Helper Components --

type BoxRect = { start: { x: number; y: number }; end: { x: number; y: number }; shift: boolean };

/**
 * CAD-style window select. Drag left to right = window (only things fully inside), right to left = crossing
 * (anything the box touches). Coordinates are relative to the canvas.
 */
const BoxSelector = ({ active, onSelect }: { active: boolean; onSelect: (rect: BoxRect) => void }) => {
  const { gl } = useThree();
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const boxRef = useRef<typeof box>(null);
  boxRef.current = box;

  useEffect(() => {
    if (!active) { setBox(null); return; }
    const el = gl.domElement;
    const rel = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || e.target !== el) return;
      const p = rel(e);
      setBox({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    };
    const move = (e: PointerEvent) => {
      if (!boxRef.current) return;
      const p = rel(e);
      setBox((b) => (b ? { ...b, x1: p.x, y1: p.y } : b));
    };
    const up = (e: PointerEvent) => {
      const b = boxRef.current;
      if (!b) return;
      const p = rel(e);
      setBox(null);
      onSelect({ start: { x: b.x0, y: b.y0 }, end: { x: p.x, y: p.y }, shift: e.shiftKey });
    };
    const cancel = (e: KeyboardEvent) => { if (e.key === 'Escape') setBox(null); };
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', cancel);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', cancel);
    };
  }, [active, gl, onSelect]);

  if (!box) return null;
  const crossing = box.x1 < box.x0;
  return (
    <Html fullscreen style={{ pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute',
        left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1),
        width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0),
        border: `1px ${crossing ? 'dashed' : 'solid'} ${crossing ? '#4ebe96' : ACCENT}`,
        backgroundColor: crossing ? 'rgba(78, 190, 150, 0.12)' : 'rgba(245, 165, 36, 0.12)',
        pointerEvents: 'none',
      }} />
    </Html>
  );
};

// -- Scene Components --

const solidMaterial = () =>
  new THREE.MeshStandardMaterial({ color: '#c9ccd3', roughness: 0.55, metalness: 0.08, side: THREE.DoubleSide });

const GeometryModel = ({ kind, url, visible, onObject }: { kind: 'stl' | 'ply'; url: string; visible: boolean; onObject: (o: THREE.Object3D) => void }) => {
  const geo = useLoader(kind === 'stl' ? STLLoader : PLYLoader, url) as THREE.BufferGeometry;
  const mesh = useMemo(() => {
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const m = solidMaterial();
    m.vertexColors = !!geo.attributes.color;
    return new THREE.Mesh(geo, m);
  }, [geo]);
  useEffect(() => onObject(mesh), [mesh]);
  return <primitive object={mesh} visible={visible} />;
};

const SceneModel = ({ kind, url, visible, onObject }: { kind: Exclude<ModelKind, 'stl' | 'ply'>; url: string; visible: boolean; onObject: (o: THREE.Object3D) => void }) => {
  const loaded: any = useLoader(kind === 'gltf' ? GLTFLoader : kind === 'obj' ? OBJLoader : FBXLoader, url);
  const obj: THREE.Object3D = useMemo(() => {
    const o: THREE.Object3D = loaded.scene ?? loaded;
    o.traverse((n: any) => {
      if (!n.isMesh) return;
      if (!n.geometry.attributes.normal) n.geometry.computeVertexNormals(); // lighting and shadows need normals
      if (kind === 'obj' || kind === 'fbx') {
        if (!n.material || n.material.isMeshBasicMaterial) n.material = solidMaterial();
      } else if (n.material?.isMeshBasicMaterial) {
        // Unlit scan materials ignore light, so they can never show shadows. Make them lit, keeping the texture.
        const b = n.material;
        n.material = new THREE.MeshStandardMaterial({
          map: b.map, color: b.color, vertexColors: b.vertexColors, side: b.side, transparent: b.transparent,
          opacity: b.opacity, alphaMap: b.alphaMap, roughness: 0.9, metalness: 0,
        });
      }
    });
    return o;
  }, [loaded, kind]);
  useEffect(() => onObject(obj), [obj]);
  return <primitive object={obj} visible={visible} />;
};

const Model = ({ url, kind, visible, onLoaded }: { url: string; kind: ModelKind; visible: boolean; onLoaded: (sphere: THREE.Sphere, centre: { x: number; z: number }) => void }) => {
  const report = (o: THREE.Object3D) => {
    o.userData.isScan = true;
    const box = new THREE.Box3().setFromObject(o);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    // Pivot for moving/turning the scan: the middle of where its geometry really is. Stray points far
    // from the main mass (common in photogrammetry) would drag a plain bounding-box centre away.
    const xs: number[] = [], zs: number[] = [], v = new Vector3();
    o.updateWorldMatrix(true, true);
    o.traverse((m: any) => {
      const pos = m.isMesh && m.geometry?.attributes?.position;
      if (!pos) return;
      const step = Math.max(1, Math.floor(pos.count / 4000));
      for (let i = 0; i < pos.count; i += step) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); xs.push(v.x); zs.push(v.z); }
    });
    const mid = (a: number[]) => { a.sort((p, q) => p - q); return (a[Math.floor(a.length * 0.05)] + a[Math.floor(a.length * 0.95)]) / 2; };
    const centre = xs.length > 20 ? { x: mid(xs), z: mid(zs) } : { x: sphere.center.x, z: sphere.center.z };
    onLoaded(isFinite(sphere.radius) && sphere.radius > 0 ? sphere : new THREE.Sphere(new Vector3(), 1), centre);
  };
  return kind === 'stl' || kind === 'ply'
    ? <GeometryModel kind={kind} url={url} visible={visible} onObject={report} />
    : <SceneModel kind={kind} url={url} visible={visible} onObject={report} />;
};

/** Buildings, roads and water around the picked location, merged into a few meshes. */
const SiteLayer = ({ site, colors, ghost = false, hidden = null }: { site: SiteData; colors: SiteColors; ghost?: boolean; hidden?: Set<number> | 'all' | null }) => {
  const ghostProps = ghost ? { transparent: true, opacity: 0.45, depthWrite: false } : {};
  const built = useMemo(() => {
    const geos: THREE.BufferGeometry[] = [];
    site.buildings.forEach((b, bi) => {
      if (hidden === 'all' || (hidden && hidden.has(bi))) return;
      try {
        const shape = new THREE.Shape(b.ring.map(([x, z]) => new THREE.Vector2(x, -z)));
        const g = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false });
        g.rotateX(-Math.PI / 2);
        geos.push(g.index ? g.toNonIndexed() : g);
      } catch { /* skip degenerate footprint */ }
    });
    const buildings = geos.length ? mergeGeometries(geos) : null;
    geos.forEach((g) => g.dispose());
    const edges = buildings ? new THREE.EdgesGeometry(buildings, 35) : null;

    // roads as flat ribbons
    const verts: number[] = [];
    for (const r of site.roads) {
      const hw = r.width / 2;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
        const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
        if (len < 1e-3) continue;
        const nx = (-dz / len) * hw, nz = (dx / len) * hw;
        verts.push(ax + nx, 0.03, az + nz, ax - nx, 0.03, az - nz, bx + nx, 0.03, bz + nz,
                   ax - nx, 0.03, az - nz, bx - nx, 0.03, bz - nz, bx + nx, 0.03, bz + nz);
      }
    }
    const roads = new THREE.BufferGeometry();
    roads.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));

    const waterGeos: THREE.BufferGeometry[] = [];
    for (const w of site.water) {
      try {
        const g = new THREE.ShapeGeometry(new THREE.Shape(w.map(([x, z]) => new THREE.Vector2(x, -z))));
        g.rotateX(-Math.PI / 2);
        g.translate(0, 0.02, 0);
        waterGeos.push(g.index ? g.toNonIndexed() : g);
      } catch { /* skip */ }
    }
    const water = waterGeos.length ? mergeGeometries(waterGeos) : null;
    const greenGeos: THREE.BufferGeometry[] = [];
    for (const w of site.green ?? []) {
      try {
        const g = new THREE.ShapeGeometry(new THREE.Shape(w.map(([x, z]) => new THREE.Vector2(x, -z))));
        g.rotateX(-Math.PI / 2);
        g.translate(0, 0.01, 0);
        greenGeos.push(g.index ? g.toNonIndexed() : g);
      } catch { /* skip */ }
    }
    const green = greenGeos.length ? mergeGeometries(greenGeos) : null;
    return { buildings, edges, roads, water, green };
  }, [site, hidden]);

  return (
    <group renderOrder={-1}>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.04, 0]} userData={{ noShadow: true }}>
        <planeGeometry args={[site.radius * 2, site.radius * 2]} />
        <meshBasicMaterial color={colors.ground} {...ghostProps} />
      </mesh>
      {built.green && (
        <mesh geometry={built.green} userData={{ noShadow: true }}><meshBasicMaterial color={colors.green} side={THREE.DoubleSide} {...ghostProps} /></mesh>
      )}
      {built.water && (
        <mesh geometry={built.water} userData={{ noShadow: true }}><meshBasicMaterial color={colors.water} side={THREE.DoubleSide} {...ghostProps} /></mesh>
      )}
      <mesh geometry={built.roads} userData={{ noShadow: true }}><meshBasicMaterial color={colors.roads} side={THREE.DoubleSide} {...ghostProps} /></mesh>
      {built.buildings && (
        <mesh geometry={built.buildings}>
          <meshStandardMaterial color={colors.buildings} roughness={0.9} flatShading {...ghostProps} />
        </mesh>
      )}
      {built.edges && (
        <lineSegments geometry={built.edges} userData={{ noShadow: true }}>
          <lineBasicMaterial color={colors.buildings} opacity={0.5} transparent />
        </lineSegments>
      )}
    </group>
  );
};

/** Renders the loaded scan from straight above into a height map (for auto-alignment). */
const ScanProbe = ({ probe }: { probe: React.MutableRefObject<((raw?: boolean) => ScanRaster | null) | null> }) => {
  const { scene, gl } = useThree();
  useEffect(() => {
    probe.current = (raw = false) => {
      // raw = look at the scan as loaded, ignoring the move/turn the user has applied to it
      let pose: THREE.Object3D | null = null;
      scene.traverse((o) => { if (!pose && o.userData?.scanPose) pose = o; });
      const saved = pose ? { p: (pose as THREE.Object3D).position.clone(), r: (pose as THREE.Object3D).rotation.clone(), s: (pose as THREE.Object3D).scale.clone() } : null;
      if (raw && pose) {
        const g = pose as THREE.Object3D, c = g.userData.centre as { x: number; z: number };
        g.position.set(c.x, g.position.y, c.z); g.rotation.set(0, 0, 0); g.scale.set(1, 1, 1);
        g.updateMatrixWorld(true);
      }
      try {
        return renderHeightMap();
      } finally {
        if (raw && pose && saved) {
          const g = pose as THREE.Object3D;
          g.position.copy(saved.p); g.rotation.copy(saved.r); g.scale.copy(saved.s); g.updateMatrixWorld(true);
        }
      }
    };
    const renderHeightMap = (): ScanRaster | null => {
      let scan: THREE.Object3D | null = null;
      scene.traverse((o) => { if (!scan && o.userData?.isScan) scan = o; });
      if (!scan) return null;
      const root: THREE.Object3D = scan;
      const box = new THREE.Box3().setFromObject(root);
      if (box.isEmpty()) return null;
      const n = 256;
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      const half = (Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2) * 1.02;
      const minY = box.min.y, range = Math.max(box.max.y - box.min.y, 1e-6);

      const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, range + 40);
      cam.up.set(0, 0, -1);                       // image top = north (-z)
      cam.position.set(cx, box.max.y + 20, cz);
      cam.lookAt(cx, minY, cz);
      cam.updateMatrixWorld(true);

      const mat = new THREE.ShaderMaterial({
        side: THREE.DoubleSide, toneMapped: false,
        uniforms: { minY: { value: minY }, range: { value: range } },
        vertexShader: 'varying float vH; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vH = w.y; gl_Position = projectionMatrix*viewMatrix*w; }',
        fragmentShader: 'uniform float minY; uniform float range; varying float vH; void main(){ float t = clamp((vH-minY)/range,0.,1.); float v = floor(t*65535.+.5); float hi = floor(v/256.); gl_FragColor = vec4(hi/255., (v-hi*256.)/255., 0., 1.); }',
      });

      // Hide everything that isn't the scan, render with the height shader, then put it all back.
      const keep = new Set<THREE.Object3D>();
      root.traverse((o) => keep.add(o));
      const hidden: THREE.Object3D[] = [];
      let wasVisible = root.visible;
      root.visible = true;
      scene.traverse((o: any) => {
        if (keep.has(o) || !(o.isMesh || o.isLine || o.isPoints || o.isSprite) || !o.visible) return;
        o.visible = false; hidden.push(o);
      });
      const rt = new THREE.WebGLRenderTarget(n, n, { depthBuffer: true });
      const prevTarget = gl.getRenderTarget(), prevOverride = scene.overrideMaterial, prevBg = scene.background;
      const prevClear = gl.getClearColor(new THREE.Color()), prevAlpha = gl.getClearAlpha();
      const prevShadow = gl.shadowMap.autoUpdate;
      scene.overrideMaterial = mat; scene.background = null; gl.shadowMap.autoUpdate = false;
      gl.setRenderTarget(rt); gl.setClearColor(0x000000, 0); gl.clear();
      gl.render(scene, cam);
      const buf = new Uint8Array(n * n * 4);
      gl.readRenderTargetPixels(rt, 0, 0, n, n, buf);
      gl.setRenderTarget(prevTarget); gl.setClearColor(prevClear, prevAlpha);
      scene.overrideMaterial = prevOverride; scene.background = prevBg; gl.shadowMap.autoUpdate = prevShadow;
      hidden.forEach((o) => { o.visible = true; });
      root.visible = wasVisible;
      rt.dispose(); mat.dispose();

      const height = new Float32Array(n * n);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const p = ((n - 1 - i) * n + j) * 4;           // buffer rows run bottom to top
          height[i * n + j] = buf[p + 3] === 0 ? NaN : minY + (((buf[p] * 256 + buf[p + 1]) / 65535) * range);
        }
      }
      let poseObj: THREE.Object3D | null = null;
      scene.traverse((o) => { if (!poseObj && o.userData?.scanPose) poseObj = o; });
      const pv = (poseObj as THREE.Object3D | null)?.userData.centre as { x: number; z: number } | undefined;
      return { n, half, cx, cz, pivotX: pv?.x ?? cx, pivotZ: pv?.z ?? cz, height };
    };
    return () => { probe.current = null; };
  }, [scene, gl]);
  return null;
};

/** Turns on shadow casting/receiving for the scene's solid meshes (gizmos and overlays are skipped). */
const ShadowEnabler = () => {
  const { scene } = useThree();
  const t = useRef(0);
  useFrame((_, dt) => {
    t.current += dt;
    if (t.current < 0.4) return;
    t.current = 0;
    scene.traverse((o: any) => {
      if (!o.isMesh || o.userData.noShadow) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      const solid = m && m.depthTest !== false && !m.isShadowMaterial && m.type !== 'ShaderMaterial' && o.visible;
      if (o.castShadow !== !!solid) { o.castShadow = !!solid; o.receiveShadow = !!solid; }
      // Image-based ambient light isn't shadowed, so while the sun is on it washes shadows out of
      // scans and objects. Dim it so the sun does the lighting.
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
        if (mat && typeof mat.envMapIntensity === 'number' && mat.userData && mat.userData._env === undefined) {
          mat.userData._env = mat.envMapIntensity;
          mat.envMapIntensity = 0.15;
          mat.needsUpdate = true;
        }
      }
    });
  });
  useEffect(() => () => {
    scene.traverse((o: any) => {
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
        if (mat?.userData?._env !== undefined) { mat.envMapIntensity = mat.userData._env; delete mat.userData._env; mat.needsUpdate = true; }
      }
    });
  }, [scene]);
  return null;
};

/** The sun as a directional light, plus a shadow-catcher over the ground and N / sun markers. */
const SunRig = ({ pos, north, extent, light }: { pos: SunPos; north: number; extent: number; light: boolean }) => {
  const dir = sunVector(pos, north);
  const up = Math.max(0, dir[1]);                       // 0 at the horizon, 1 overhead
  const day = THREE.MathUtils.smoothstep(dir[1], -0.02, 0.18);
  const warm = new THREE.Color('#ff9d5c').lerp(new THREE.Color('#fff3dc'), Math.min(1, up * 2.2));
  const d = extent * 2;
  return (
    <>
      <ambientLight intensity={0.14 + 0.3 * day} color={day > 0 ? '#dfe8ff' : '#7b8bb5'} />
      <directionalLight
        key={`${Math.round(extent)}`}
        position={[dir[0] * d, Math.max(dir[1], 0.02) * d, dir[2] * d]}
        intensity={day * (0.6 + 1.4 * Math.min(1, up * 2))}
        color={warm}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-extent} shadow-camera-right={extent}
        shadow-camera-top={extent} shadow-camera-bottom={-extent}
        shadow-camera-near={1} shadow-camera-far={d * 4}
        shadow-bias={-0.0004} shadow-normalBias={0.05}
      />
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.08, 0]} receiveShadow raycast={() => null} userData={{ noShadow: true }} renderOrder={-1}>
        <planeGeometry args={[extent * 2.4, extent * 2.4]} />
        <shadowMaterial opacity={0.3 * day} transparent depthWrite={false} />
      </mesh>
      {/* north and sun markers on the edge of the area */}
      <Chip position={[0, 0.3, -extent * 0.92]}>N</Chip>
      {dir[1] > 0 && <Chip position={[dir[0] * extent * 0.9, 0.3 + dir[1] * extent * 0.5, dir[2] * extent * 0.9]} tone="live">☀</Chip>}
    </>
  );
};

type XformMode = 'translate' | 'rotate' | 'scale';

/** Turn about the vertical axis in degrees. Euler angles flip past 90° (e.g. 103° reads as 77° with x and z at ±180°), so read it from the quaternion. */
const yawDeg = (o: THREE.Object3D) => THREE.MathUtils.radToDeg(2 * Math.atan2(o.quaternion.y, o.quaternion.w));
const isPureYaw = (o: THREE.Object3D) => Math.abs(o.quaternion.x) < 1e-3 && Math.abs(o.quaternion.z) < 1e-3;

const describeXform = (o: THREE.Object3D, mode: XformMode) => {
  if (mode === 'translate') return `X ${o.position.x.toFixed(2)}   Y ${o.position.y.toFixed(2)}   Z ${o.position.z.toFixed(2)} m`;
  if (mode === 'rotate') {
    const d = (r: number) => THREE.MathUtils.radToDeg(r).toFixed(0);
    return isPureYaw(o)
      ? `${yawDeg(o).toFixed(0)}°`
      : `${d(o.rotation.x)}°  ${d(o.rotation.y)}°  ${d(o.rotation.z)}°`;
  }
  const f = (n: number) => n.toFixed(2);
  return Math.abs(o.scale.x - o.scale.y) < 1e-3 && Math.abs(o.scale.x - o.scale.z) < 1e-3
    ? `${f(o.scale.x)}×`
    : `${f(o.scale.x)} × ${f(o.scale.y)} × ${f(o.scale.z)}`;
};

/**
 * Transform handles attached to the *real* object (never a hidden stand-in), so it moves live
 * while you drag. State is committed once on release. Snapping is optional.
 */
const Gizmo = ({
  object, mode, snap, step, axes, onLive, onCommit,
}: {
  object: THREE.Object3D;
  mode: XformMode;
  snap: boolean;
  step: number;
  axes?: { x: boolean; y: boolean; z: boolean };
  onLive: (text: string | null) => void;
  onCommit: () => void;
}) => (
  <TransformControls
    object={object}
    mode={mode}
    translationSnap={snap ? step : (null as any)}
    rotationSnap={snap ? Math.PI / 12 : (null as any)}
    scaleSnap={snap ? 0.05 : (null as any)}
    showX={axes?.x ?? true}
    showY={axes?.y ?? true}
    showZ={axes?.z ?? true}
    onMouseDown={() => onLive(describeXform(object, mode))}
    onObjectChange={() => onLive(describeXform(object, mode))}
    onMouseUp={() => { onLive(null); onCommit(); }}
  />
);

const ExternalObjModel = ({
  model,
  isSelected,
  onSelect,
  onDropped,
  transformMode,
  snap,
  snapStep,
  onTransformEnd,
  groundY = 0,
}: {
  groundY?: number;
  model: ExternalModel;
  isSelected: boolean;
  onSelect: () => void;
  onDropped: (y: number) => void;
  transformMode: XformMode | null;
  snap: boolean;
  snapStep: number;
  onTransformEnd: (next: { position: Vector3; rotation: Vector3; scale: Vector3 }) => void;
}) => {
  const obj = useLoader(OBJLoader, model.url);

  const { scene, center, size } = useMemo(() => {
    const c = obj.clone();
    if (model.color) {
      const mat = new THREE.MeshStandardMaterial({ color: model.color, roughness: 0.65, metalness: 0.05, side: THREE.DoubleSide });
      c.traverse((o: any) => { if (o.isMesh) o.material = mat; });
    }
    const box = new THREE.Box3().setFromObject(c);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    return { scene: c, center, size };
  }, [obj, model.color]);
  const outline = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)), [size]);

  // Drop to ground: fall under gravity until the lowest point rests on y = 0.
  const groupRef = useRef<Group | null>(null);
  const [grp, setGrp] = useState<Group | null>(null);
  const [live, setLive] = useState<string | null>(null);
  const setRefs = React.useCallback((g: Group | null) => { groupRef.current = g; setGrp(g); }, []);
  const fall = useRef<{ y: number; v: number; target: number } | null>(null);
  const seenNonce = useRef(model.dropNonce ?? 0);
  useEffect(() => {
    if ((model.dropNonce ?? 0) === seenNonce.current) return;
    seenNonce.current = model.dropNonce ?? 0;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(model.rotation.x, model.rotation.y, model.rotation.z));
    const m = new THREE.Matrix4().compose(new Vector3(), q, model.scale);
    let lowest = Infinity;
    for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
      lowest = Math.min(lowest, new Vector3(size.x * sx, size.y * sy, size.z * sz).applyMatrix4(m).y);
    }
    fall.current = { y: model.position.y, v: 0, target: groundY - lowest };
  }, [model.dropNonce]);
  useFrame((_, dt) => {
    const f = fall.current;
    if (!f || !groupRef.current) return;
    const step = Math.min(dt, 0.05);
    f.v -= 30 * step;
    f.y += f.v * step;
    if (f.y <= f.target) {
      f.y = f.target;
      if (Math.abs(f.v) < 1.2) {
        groupRef.current.position.y = f.target;
        fall.current = null;
        onDropped(f.target);
        return;
      }
      f.v = -f.v * 0.28;
    }
    groupRef.current.position.y = f.y;
  });

  const commit = () => {
    const g = groupRef.current;
    if (!g) return;
    onTransformEnd({
      position: g.position.clone(),
      rotation: new Vector3(g.rotation.x, g.rotation.y, g.rotation.z),
      scale: g.scale.clone(),
    });
  };

  return (
    <>
      <group
        ref={setRefs}
        userData={{ selType: 'model', selId: model.id }}
        position={model.position}
        rotation={[model.rotation.x, model.rotation.y, model.rotation.z]}
        scale={model.scale}
        onClick={(e: any) => {
          if (e.nativeEvent?.button !== 0) return;
          e.stopPropagation();
          onSelect();
        }}
      >
        <primitive object={scene} position={[-center.x, -center.y, -center.z]} />
        {isSelected && (
          <lineSegments geometry={outline} renderOrder={6}>
            <lineBasicMaterial color={ACCENT} depthTest={false} />
          </lineSegments>
        )}
      </group>

      {transformMode && grp && (
        <Gizmo object={grp} mode={transformMode} snap={snap} step={snapStep} onLive={setLive} onCommit={commit} />
      )}
      {live && grp && (
        <Chip position={[grp.position.x, grp.position.y + (size.y * grp.scale.y) / 2, grp.position.z]} tone="live">{live}</Chip>
      )}
    </>
  );
};

/** Invisible fill over a closed shape so it can be right-clicked. */
const ShapeHit = ({ points, enabled, onMenu, onPick }: { points: Vector3[]; enabled: boolean; onMenu: (x: number, y: number) => void; onPick: () => void }) => {
  const [hover, setHover] = useState(false);
  useEffect(() => { if (!enabled) setHover(false); }, [enabled]);
  const geo = useMemo(() => {
    try {
      const ring = points.slice(0, -1);
      const sh = new THREE.Shape(ring.map((p) => new THREE.Vector2(p.x, -p.z)));
      return new THREE.ShapeGeometry(sh);
    } catch { return null; }
  }, [points]);
  if (!geo) return null;
  const y = Math.max(...points.map((p) => p.y)) + 0.1;
  const ring = points.slice(0, -1);
  const c = ring.reduce((a, p) => a.add(p), new Vector3()).divideScalar(Math.max(ring.length, 1));
  let area = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; area += a.x * b.z - b.x * a.z; }
  area = Math.abs(area) / 2;
  return (
    <group>
    {hover && <Chip position={[c.x, y + 0.4, c.z]} tone="live">{`Floor area · ${area.toFixed(1)} m²`}</Chip>}
    <mesh
      geometry={geo} rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]}
      raycast={enabled ? THREE.Mesh.prototype.raycast : () => null}
      onPointerOver={(e) => { e.stopPropagation(); setHover(true); }}
      onPointerOut={() => setHover(false)}
      onClick={(e) => { if (e.nativeEvent?.button !== 0) return; onPick(); }}
      onContextMenu={(e) => { e.stopPropagation(); e.nativeEvent.preventDefault(); onMenu(e.nativeEvent.clientX, e.nativeEvent.clientY); }}
    >
      <meshBasicMaterial color={ACCENT} transparent opacity={hover ? 0.22 : 0} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
    </group>
  );
};

/** Clickable edges of the outline, used to pick the panelling direction. */
const EdgePicker = ({ points, thickness, onPick }: { points: Vector3[]; thickness: number; onPick: (i: number) => void }) => {
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => () => { document.body.style.cursor = ''; }, []);
  return (
    <group>
      {points.slice(0, -1).map((a, i) => {
        const b = points[i + 1];
        const len = a.distanceTo(b);
        if (len < 1e-3) return null;
        const ang = Math.atan2(b.z - a.z, b.x - a.x);
        return (
          <mesh
            key={i} renderOrder={9}
            position={[(a.x + b.x) / 2, Math.max(a.y, b.y) + 0.12, (a.z + b.z) / 2]}
            rotation={[-Math.PI / 2, 0, -ang]}
            onPointerOver={(e) => { e.stopPropagation(); setHover(i); document.body.style.cursor = 'pointer'; }}
            onPointerOut={() => { setHover(null); document.body.style.cursor = ''; }}
            onClick={(e) => { e.stopPropagation(); document.body.style.cursor = ''; onPick(i); }}
          >
            <planeGeometry args={[len, thickness]} />
            <meshBasicMaterial color={ACCENT} transparent opacity={hover === i ? 0.9 : 0.4} depthTest={false} side={THREE.DoubleSide} />
          </mesh>
        );
      })}
    </group>
  );
};

const FabricRenderer = ({ panels }: { panels: FabricPanel[] }) => {
  return (
    <group>
      {panels.map((panel) => (
        <group
          key={panel.id}
          position={panel.position}
          rotation={[0, panel.rotation, 0]}
        >
          {/* Main Panel Fabric */}
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[panel.width, panel.length]} />
            <meshStandardMaterial
              color="white"
              side={THREE.DoubleSide}
              transparent
              opacity={0.6}
              roughness={0.9}
            />
          </mesh>

          {/* Seam/Border Visualization */}
          <lineSegments rotation={[-Math.PI / 2, 0, 0]}>
            <edgesGeometry args={[new THREE.PlaneGeometry(panel.width, panel.length)]} />
            <lineBasicMaterial color="#6b7280" linewidth={1} transparent opacity={0.6} />
          </lineSegments>

          {/* Size Label */}
          <React.Suspense fallback={null}>
            <Text
              font={monoFont}
              position={[0, 0.1, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              fontSize={0.3}
              color="#2a2c31"
            >
              {`${panel.width > panel.length ? panel.width.toFixed(1) : panel.length.toFixed(1)}m`}
            </Text>
          </React.Suspense>
        </group>
      ))}
    </group>
  );
};

interface FurnitureCommit { position: Vector3; rotation: number; width: number; depth: number; height: number }

const FurnitureNode = ({
  item, selected, baseColor, transformMode, snap, snapStep, onSelect, onTransformEnd,
}: {
  item: FurnitureItem; selected: boolean; baseColor: string;
  transformMode: XformMode | null; snap: boolean; snapStep: number;
  onSelect: () => void; onTransformEnd: (next: FurnitureCommit) => void;
}) => {
  const [mesh, setMesh] = useState<THREE.Mesh | null>(null);
  const [live, setLive] = useState<string | null>(null);

  const commit = () => {
    if (!mesh) return;
    const { x: sx, y: sy, z: sz } = mesh.scale;
    mesh.scale.set(1, 1, 1); // scaling is baked into the dimensions
    onTransformEnd({
      position: new Vector3(mesh.position.x, 0, mesh.position.z),
      rotation: 2 * Math.atan2(mesh.quaternion.y, mesh.quaternion.w),
      width: item.width * sx,
      depth: item.depth * sz,
      height: item.height * sy,
    });
  };

  // Furniture stays on the floor: no vertical move, spin about Y only.
  const axes =
    transformMode === 'translate' ? { x: true, y: false, z: true }
    : transformMode === 'rotate' ? { x: false, y: true, z: false }
    : { x: true, y: true, z: true };

  return (
    <>
      <mesh
        ref={setMesh}
        userData={{ selType: 'furniture', selId: item.id }}
        position={[item.position.x, item.height / 2, item.position.z]}
        rotation={[0, item.rotation, 0]}
        onClick={(e) => {
          if (e.nativeEvent?.button !== 0) return;
          e.stopPropagation();
          onSelect();
        }}
      >
        {item.type === 'cylinder' ? (
          <cylinderGeometry args={[item.width / 2, item.width / 2, item.height, 32]} />
        ) : (
          <boxGeometry args={[item.width, item.height, item.depth]} />
        )}
        <meshStandardMaterial color={selected ? ACCENT : baseColor} transparent opacity={0.8} />
        <Html position={[0, item.height / 2 + 0.2, 0]} center distanceFactor={10}>
          <div className="bg-bg/80 text-ink font-mono text-2xs px-1.5 py-px rounded-sm pointer-events-none whitespace-nowrap">
            {item.name}
          </div>
        </Html>
      </mesh>
      {transformMode && mesh && (
        <Gizmo object={mesh} mode={transformMode} snap={snap} step={snapStep} axes={axes} onLive={setLive} onCommit={commit} />
      )}
      {live && mesh && (
        <Chip position={[mesh.position.x, mesh.position.y + (item.height * mesh.scale.y) / 2 + 0.3, mesh.position.z]} tone="live">{live}</Chip>
      )}
    </>
  );
};

const FurnitureRenderer = ({
  items, onSelect, selectedIds, baseColor, transformId, transformMode, snap, snapStep, onTransformEnd,
}: {
  items: FurnitureItem[]; onSelect: (id: string) => void; selectedIds: string[]; baseColor: string;
  transformId: string | null; transformMode: XformMode;
  snap: boolean; snapStep: number; onTransformEnd: (id: string, next: FurnitureCommit) => void;
}) => (
  <group>
    {items.map((item) => (
      <FurnitureNode
        key={item.id}
        item={item}
        selected={selectedIds.includes(item.id)}
        baseColor={baseColor}
        transformMode={transformId === item.id ? transformMode : null}
        snap={snap}
        snapStep={snapStep}
        onSelect={() => onSelect(item.id)}
        onTransformEnd={(next) => onTransformEnd(item.id, next)}
      />
    ))}
  </group>
);

// -- Dimension UI --
//
// Labels are DOM chips (drei <Html>), not 3D text: they always face the viewer, follow the
// app theme, and need no font download. (drei's <Text> fetches a font from a CDN and, with no
// Suspense boundary of its own, blanks the entire canvas while it loads.)

const fmt = (m: number) => (m >= 100 ? m.toFixed(1) : m.toFixed(2));

const Chip = ({ position, tone = 'default', children }: { position: THREE.Vector3 | [number, number, number]; tone?: 'default' | 'live' | 'snap'; children: React.ReactNode }) => (
  <Html position={position} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
    <div
      className={cx(
        '-translate-y-3.5 inline-flex items-center h-[19px] px-2 rounded-full border font-mono text-2xs tabular-nums whitespace-nowrap select-none shadow-sm',
        tone === 'default' && 'bg-panel/95 border-line text-ink',
        tone === 'live' && 'bg-accent border-accent text-bg font-medium',
        tone === 'snap' && 'bg-ok border-ok text-bg font-medium',
      )}
    >
      {children}
    </div>
  </Html>
);

/** Marker that stays the same size on screen (radius in px) at any zoom or model scale. */
const ScreenDot = ({ position, px = 5, color = ACCENT }: { position: THREE.Vector3; px?: number; color?: string }) => {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ camera, size }) => {
    if (!ref.current) return;
    const cam = camera as THREE.PerspectiveCamera;
    const worldPerPx = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * cam.position.distanceTo(position)) / size.height;
    ref.current.scale.setScalar(Math.max(worldPerPx * px, 1e-5));
  });
  return (
    <mesh ref={ref} position={position} renderOrder={9}>
      <sphereGeometry args={[1, 16, 16]} />
      <meshBasicMaterial color={color} depthTest={false} />
    </mesh>
  );
};

const Ring = ({ position, radius, color = ACCENT }: { position: THREE.Vector3; radius: number; color?: string }) => (
  <mesh position={[position.x, position.y + 0.02, position.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={10}>
    <ringGeometry args={[radius * 0.7, radius, 40]} />
    <meshBasicMaterial color={color} transparent opacity={0.9} depthTest={false} side={THREE.DoubleSide} />
  </mesh>
);

const mid = (a: Vector3, b: Vector3) => new Vector3().addVectors(a, b).multiplyScalar(0.5);

/** Edge lengths of the sketched outline. */
const SketchMeasurements = ({ points, minLength }: { points: Vector3[]; minLength: number }) => {
  if (points.length < 2) return null;
  return (
    <group>
      {points.slice(0, -1).map((p, i) => {
        const q = points[i + 1];
        const len = p.distanceTo(q);
        if (len < Math.max(minLength, 1e-3)) return null; // also skips the zero-length closing edge
        return <Chip key={i} position={mid(p, q)}>{fmt(len)} m</Chip>;
      })}
    </group>
  );
};

/** Finished measurements + the one in progress. */
const MeasureLayer = ({ measure, selectedId, canPick, onPick, onDelete }: {
  measure: MeasurementState; gridStep: number; selectedId: number | null; canPick: boolean;
  onPick: (i: number) => void; onDelete: (i: number) => void;
}) => (
  <group>
    {measure.done.map(([a, b], i) => {
      const sel = selectedId === i;
      return (
        <group key={i}>
          <Line points={[a, b]} color={sel ? '#ffffff' : ACCENT} lineWidth={sel ? 4 : 2} depthTest={false} renderOrder={8} />
          {canPick && (
            // wide invisible line: an easy target to click
            <Line
              points={[a, b]} color={ACCENT} lineWidth={14} transparent opacity={0} depthTest={false} depthWrite={false} renderOrder={9}
              onClick={(e) => { if (e.nativeEvent?.button !== 0) return; e.stopPropagation(); onPick(i); }}
              onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
              onPointerOut={() => { document.body.style.cursor = ''; }}
            />
          )}
          <ScreenDot position={a} px={sel ? 5 : 4} color={sel ? '#ffffff' : ACCENT} />
          <ScreenDot position={b} px={sel ? 5 : 4} color={sel ? '#ffffff' : ACCENT} />
          {sel ? (
            <Html position={mid(a, b)} center zIndexRange={[30, 0]}>
              <div className="-translate-y-3.5 inline-flex items-center h-[22px] pl-2 pr-0.5 rounded-full border border-accent bg-accent text-bg font-mono text-2xs tabular-nums whitespace-nowrap select-none shadow-md">
                {fmt(a.distanceTo(b))} m
                <button
                  aria-label="Delete measurement" title="Delete measurement (Del)"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onDelete(i); }}
                  className="ml-1.5 h-[18px] w-[18px] rounded-full bg-bg/25 hover:bg-bg/50 inline-flex items-center justify-center"
                ><X size={11} /></button>
              </div>
            </Html>
          ) : (
            <Chip position={mid(a, b)} tone="live">{fmt(a.distanceTo(b))} m</Chip>
          )}
        </group>
      );
    })}
    {measure.points.map((p, i) => <ScreenDot key={`p${i}`} position={p} px={5} />)}
  </group>
);

/**
 * Everything that follows the pointer on the ground: the click-catching plane, a cursor ring,
 * a live rubber-band segment with its length, and snap-to-start to close the outline.
 * Owns the cursor state so pointer moves don't re-render the whole scene.
 */
const DrawingLayer = ({
  active, toolMode, points, isClosed, measurePoints, gridStep, onPointAdd, onClose, groundY,
}: {
  groundY: number;
  active: boolean;
  toolMode: ToolMode;
  points: Vector3[];
  isClosed: boolean;
  measurePoints: Vector3[];
  gridStep: number;
  onPointAdd: (point: Vector3) => void;
  onClose: () => void;
}) => {
  const [cursor, setCursor] = useState<Vector3 | null>(null);
  useEffect(() => { if (!active) setCursor(null); }, [active]);

  const { camera, size } = useThree();
  // World size of one screen pixel at the cursor, so every on-ground affordance has a constant pixel size.
  const unit = cursor
    ? (2 * Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov) / 2) * camera.position.distanceTo(cursor)) / size.height
    : 0.01;
  const snapDist = unit * 22;
  const canClose = toolMode === 'draw' && !isClosed && points.length >= 3;
  const snapped = !!cursor && canClose && cursor.distanceTo(points[0]) < snapDist;
  const tip = snapped ? points[0] : cursor;

  let from: Vector3 | null = null;
  if (toolMode === 'draw' && !isClosed && points.length > 0) from = points[points.length - 1];
  if (toolMode === 'measure' && measurePoints.length === 1) from = measurePoints[0];

  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, groundY + 0.05, 0]}
        visible={false}
        raycast={active ? THREE.Mesh.prototype.raycast : () => null}
        onPointerMove={(e) => { if (active) setCursor(e.point.clone()); }}
        onPointerOut={() => setCursor(null)}
        onPointerDown={(e) => {
          if (!active || e.button !== 0) return;
          e.stopPropagation();
          if (snapped) onClose(); else onPointAdd(e.point);
        }}
      >
        <planeGeometry args={[100000, 100000]} />
        <meshBasicMaterial />
      </mesh>

      {active && tip && (
        <>
          <Ring position={tip} radius={unit * (snapped ? 20 : 11)} color={snapped ? '#4ebe96' : ACCENT} />
          {from && tip.distanceTo(from) > 1e-3 && (
            <>
              <Line points={[from, tip]} color={snapped ? '#4ebe96' : ACCENT} lineWidth={2} depthTest={false} renderOrder={8} dashed dashSize={unit * 9} gapSize={unit * 5} />
              <Chip position={mid(from, tip)} tone={snapped ? 'snap' : 'live'}>
                {snapped ? `Close · ${fmt(tip.distanceTo(from))} m` : `${fmt(tip.distanceTo(from))} m`}
              </Chip>
            </>
          )}
        </>
      )}
      {active && snapped && <Ring position={points[0]} radius={unit * 20} color="#4ebe96" />}
    </>
  );
};

/** Drives the camera around the turntable centre. Live: speed, distance and tilt apply every frame. */
const TurntableRig = ({ t, groundY }: { t: TurntableState; groundY: number }) => {
  const { camera, controls } = useThree();
  const ctl = controls as any;
  const apply = (dt: number) => {
    if (!t.origin) return;
    const o = t.origin;
    const off = camera.position.clone().sub(o);
    let az = Math.atan2(off.x, off.z);
    if (!isFinite(az)) az = 0;
    az += (t.reverse ? -1 : 1) * THREE.MathUtils.degToRad(t.speed) * dt;
    const r = Math.max(t.base * t.zoom, 0.5);
    const el = THREE.MathUtils.degToRad(t.elev);
    camera.position.set(o.x + r * Math.cos(el) * Math.sin(az), o.y + r * Math.sin(el), o.z + r * Math.cos(el) * Math.cos(az));
    camera.lookAt(o);
    if (ctl?.target) { ctl.target.copy(o); ctl.update?.(); }
  };
  // Distance / tilt sliders also apply while paused.
  useEffect(() => { apply(0); }, [t.origin, t.zoom, t.elev]);
  useFrame((_, dt) => { if (t.playing && t.origin) apply(Math.min(dt, 0.1)); });
  // While it is turning, the mouse should not fight the camera.
  useEffect(() => {
    if (!ctl) return;
    const was = ctl.enabled;
    ctl.enabled = !(t.playing && t.origin);
    return () => { ctl.enabled = was ?? true; };
  }, [ctl, t.playing, t.origin]);
  if (!t.origin) return null;
  const ringR = Math.max(t.base * t.zoom * Math.cos(THREE.MathUtils.degToRad(t.elev)), 0.1);
  const pts = Array.from({ length: 97 }, (_, i) => {
    const a = (i / 96) * Math.PI * 2;
    return new Vector3(t.origin!.x + Math.sin(a) * ringR, groundY + 0.06, t.origin!.z + Math.cos(a) * ringR);
  });
  return (
    <group>
      <Line points={pts} color={ACCENT} lineWidth={1.5} dashed dashSize={ringR / 40} gapSize={ringR / 60} depthTest={false} renderOrder={7} transparent opacity={0.7} />
      <ScreenDot position={new Vector3(t.origin.x, groundY + 0.06, t.origin.z)} px={6} />
    </group>
  );
};

/** Lets the page ask "where on the ground is this screen point?" (used when dropping library objects). */
export type ModelHit = { id: string; center: Vector3; bottom: number; size: Vector3 };
const GroundPicker = ({ pick, hitModel, groundY }: {
  pick: React.MutableRefObject<((x?: number, y?: number) => Vector3 | null) | null>;
  hitModel?: React.MutableRefObject<((x: number, y: number) => ModelHit | null) | null>;
  groundY: number;
}) => {
  const { camera, gl, scene } = useThree();
  useEffect(() => {
    if (!hitModel) return;
    hitModel.current = (cx, cy) => {
      // Screen-space test: the pointer is over (or just next to) an object's on-screen bounds.
      // More forgiving than a ray when the object is tiny next to a big scan.
      const r = gl.domElement.getBoundingClientRect();
      const px = cx - r.left, py = cy - r.top;
      let best: { o: THREE.Object3D; box: THREE.Box3; d: number } | null = null;
      scene.traverse((o) => {
        if (o.userData?.selType !== 'model') return;
        const box = new THREE.Box3().setFromObject(o);
        if (box.isEmpty()) return;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
          const v = new Vector3(x, y, z).project(camera);
          const sx = ((v.x + 1) / 2) * r.width, sy = ((1 - v.y) / 2) * r.height;
          x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
        }
        const pad = 12;
        if (px < x0 - pad || px > x1 + pad || py < y0 - pad || py > y1 + pad) return;
        const d = camera.position.distanceTo(box.getCenter(new Vector3()));
        if (!best || d < best.d) best = { o, box, d };
      });
      if (!best) return null;
      const b = best as { o: THREE.Object3D; box: THREE.Box3; d: number };
      return { id: b.o.userData.selId as string, center: b.box.getCenter(new Vector3()), bottom: b.box.min.y, size: b.box.getSize(new Vector3()) };
    };
    return () => { hitModel.current = null; };
  }, [camera, gl, scene]);
  useEffect(() => {
    pick.current = (cx, cy) => {
      const r = gl.domElement.getBoundingClientRect();
      const nx = (((cx ?? r.left + r.width / 2) - r.left) / r.width) * 2 - 1;
      const ny = -(((cy ?? r.top + r.height / 2) - r.top) / r.height) * 2 + 1;
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
      const hit = new Vector3();
      return ray.ray.intersectPlane(new THREE.Plane(new Vector3(0, 1, 0), -groundY), hit) ? hit : null;
    };
    return () => { pick.current = null; };
  }, [camera, gl, groundY]);
  return null;
};

/**
 * The fixed steel pole (2.5 m model; a 3 m one is the same pole with its straight leaning section lengthened).
 * It is built so the flange plate sits ON the ground and the square spigot below it goes into the ground,
 * and it leans toward its local -Z, so a yaw about Y chooses which way it faces.
 */
const STEEL_URL = `${import.meta.env.BASE_URL}models/steel-pole-2.5m.obj`;
const steelCache = new Map<string, THREE.BufferGeometry[]>();
function steelGeometries(obj: THREE.Group, height: number): THREE.BufferGeometry[] {
  const key = height.toFixed(3);
  const hit = steelCache.get(key);
  if (hit) return hit;
  const meshes: THREE.Mesh[] = [];
  obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  // Lean axis of the straight upper section, from the corners of the body at its two ends (model is in cm, +Y up).
  let by = 0, bz = 0, bn = 0, ty = 0, tz = 0, tn = 0;
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (Math.abs(x) < 4) continue;
      if (y >= 20 && y <= 30) { by += y; bz += z; bn++; } else if (y >= 240) { ty += y; tz += z; tn++; }
    }
  }
  const u = new THREE.Vector3(0, bn && tn ? ty / tn - by / bn : 220, bn && tn ? tz / tn - bz / bn : -21).normalize();
  const extra = ((height - 2.5) * 100) / u.y;                 // cm of extra length along the lean axis
  const CUT = 150;                                            // a plane in the long straight section
  const out: THREE.BufferGeometry[] = [];
  for (const m of meshes) {
    const g = m.geometry.clone();
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (y > CUT) { y += u.y * extra; z += u.z * extra; }
      y += 1; z += 0.2;                                       // flange underside at y = 0, flange centred on the origin
      pos.setXYZ(i, x * 0.01, y * 0.01, z * 0.01);
    }
    pos.needsUpdate = true;
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    g.computeBoundingBox(); g.computeBoundingSphere();
    out.push(g);
  }
  const spike = new THREE.BoxGeometry(0.09, 0.39, 0.09); spike.translate(0, -0.195, 0);   // 90 x 90 mm, 390 mm long
  out.push(spike);
  steelCache.set(key, out);
  return out;
}
const SteelPole = ({ height, color }: { height: number; color: string }) => {
  const obj = useLoader(OBJLoader, STEEL_URL);
  const geos = useMemo(() => steelGeometries(obj, height), [obj, height]);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.75, side: THREE.DoubleSide }), [color]);
  return <>{geos.map((g, i) => <mesh key={i} geometry={g} material={mat} castShadow />)}</>;
};

/** A guy line from the top of a wooden pole to the ground, as far out as the pole is tall (45 degrees to the pole). */
const GuyLine = ({ base, height, yaw }: { base: Vector3; height: number; yaw: number }) => {
  const [dx, dz] = dirForYaw(yaw);
  const top = new Vector3(base.x, base.y + height, base.z);
  const foot = new Vector3(base.x + dx * height, base.y, base.z + dz * height);
  return (
    <group raycast={() => null}>
      <Line points={[top, foot]} color="#000000" lineWidth={1.6} depthTest={false} renderOrder={6} raycast={() => null} />
      <mesh position={foot} raycast={() => null}>
        <cylinderGeometry args={[0.025, 0.025, 0.3, 8]} />
        <meshStandardMaterial color="#000000" metalness={0.3} roughness={0.5} />
      </mesh>
    </group>
  );
};

const CameraController = ({ viewMode, fit }: { viewMode: ViewMode; fit: FitRequest | null }) => {
  const { camera } = useThree();
  const orbitRef = useRef<any>(null);
  const framing = useRef({ center: new Vector3(0, 0, 0), distance: 50 });

  // Frame a freshly loaded model: keep the viewing direction, move target + distance to fit it.
  useEffect(() => {
    if (!fit || !orbitRef.current) return;
    const dir = camera.position.clone().sub(orbitRef.current.target);
    if (dir.lengthSq() < 1e-6) dir.set(1, 0.8, 1);
    dir.normalize();
    const cam = camera as THREE.PerspectiveCamera;
    const dist = (fit.radius / Math.sin(THREE.MathUtils.degToRad(cam.fov) / 2)) * 1.1;
    framing.current = { center: fit.center.clone(), distance: dist };
    cam.near = Math.max(fit.radius * 0.01, 0.01);
    cam.far = Math.max(fit.radius * 200, 2000);
    cam.updateProjectionMatrix();
    cam.position.copy(fit.center).addScaledVector(dir, dist);
    orbitRef.current.target.copy(fit.center);
    orbitRef.current.update();
  }, [fit?.nonce]);

  useEffect(() => {
    if (!orbitRef.current) return;

    const { center: target, distance } = framing.current;
    const newPos = new Vector3();

    switch (viewMode) {
      case 'top': newPos.set(0, distance, 0); break;
      case 'front': newPos.set(0, 0, distance); break;
      case 'right': newPos.set(distance, 0, 0); break;
      case 'orbit':
      case 'depth':
      default: {
        // Leaving a flat view: tilt back into a 3/4 view. Otherwise leave the camera alone.
        const off = camera.position.clone().sub(target);
        const flat = off.x === 0 && off.z === 0 && off.y > 0;
        if (!flat) return;
        newPos.set(distance * 0.7, distance * 0.7, distance * 0.7);
        break;
      }
    }

    camera.position.copy(newPos.add(target));
    camera.lookAt(target);
    orbitRef.current.target.copy(target);
    orbitRef.current.update();

  }, [viewMode, camera]);

  const rotatable = viewMode === 'orbit' || viewMode === 'depth';
  return (
    <OrbitControls
      ref={orbitRef}
      makeDefault
      enableRotate={rotatable}
      enableDamping={true}
      mouseButtons={{
        LEFT: (rotatable ? 0 : -1) as THREE.MOUSE, // ROTATE = 0, disabled = -1
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      }}
    />
  );
};

// -- Main Component Logic --

interface Viewer3DProps {
  modelUrl: string | null;
  modelKind: ModelKind;
  externalModels: ExternalModel[];
  setExternalModels: (models: ExternalModel[]) => void;
  viewMode: ViewMode;
  toolMode: ToolMode;
  tentData: TentData;
  setTentData: (data: TentData) => void;
  layers: LayerState;
  onCanvasCreated: (gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => void;
  currentPoleHeight: number;
  currentPoleStyle?: 'wood' | 'steel';
  selections: SelectionItem[];
  onSelectionChange: (sel: SelectionItem[]) => void;
  measureState: MeasurementState;
  onMeasurePoint: (p: Vector3) => void;
  onDeleteMeasure: (i: number) => void;
  turntable?: TurntableState | null;
  groundPickRef?: React.MutableRefObject<((x?: number, y?: number) => Vector3 | null) | null>;
  modelHitRef?: React.MutableRefObject<((x: number, y: number) => ModelHit | null) | null>;
  swapPreview?: { center: Vector3; size: Vector3; rot: Vector3 } | null;
  onTurntableOrigin?: (origin: Vector3, base: number, elev: number) => void;
  tentColor: string;
  fabricPanels: FabricPanel[];
  transformSubMode: 'translate' | 'rotate' | 'scale';
  onModelLoaded?: () => void;
  onCloseLoop?: () => void;
  ghostPoles?: Vector3[] | null;
  snap?: boolean;
  site?: SiteData | null;
  siteColors?: SiteColors;
  siteAlign?: SiteAlign;
  alignMode?: XformMode | null;
  onSiteAlign?: (a: SiteAlign) => void;
  onModelBounds?: (center: Vector3, radius: number) => void;
  scanY?: number;
  groundY?: number;
  pickingEdge?: boolean;
  onPickEdge?: (i: number) => void;
  onShapeMenu?: (index: number, x: number, y: number) => void;
  onShapePick?: (index: number) => void;
  hiddenBuildings?: Set<number> | 'all' | null;
  probeRef?: React.MutableRefObject<((raw?: boolean) => ScanRaster | null) | null>;
  sun?: { pos: SunPos; north: number } | null;
  theme: 'light' | 'dark';
}

// Inner component where we can safely use useThree hooks
const ViewerScene: React.FC<Viewer3DProps> = ({
  modelUrl,
  modelKind,
  externalModels,
  setExternalModels,
  viewMode,
  toolMode,
  tentData,
  setTentData,
  layers,
  currentPoleHeight,
  currentPoleStyle = 'steel',
  selections,
  onSelectionChange,
  measureState,
  onMeasurePoint,
  onDeleteMeasure,
  turntable = null,
  groundPickRef, modelHitRef, swapPreview = null,
  onTurntableOrigin,
  tentColor,
  fabricPanels,
  transformSubMode,
  onModelLoaded,
  onCloseLoop,
  ghostPoles,
  snap = true,
  site = null,
  siteColors,
  siteAlign = { x: 0, z: 0, rot: 0, scale: 1 },
  alignMode = null,
  onSiteAlign,
  onModelBounds,
  scanY = 0,
  groundY = 0,
  pickingEdge = false,
  onPickEdge,
  onShapeMenu,
  onShapePick,
  hiddenBuildings = null,
  probeRef,
  sun = null,
  theme
}) => {
  const groupRef = useRef<Group>(null);
  const { camera, size, scene } = useThree();

  // Camera framing + grid scale follow the size of whatever model was opened.
  const [fit, setFit] = useState<FitRequest | null>(null);
  const [scanGrp, setScanGrp] = useState<Group | null>(null);
  const [alignLive, setAlignLive] = useState<string | null>(null);
  const [scanC, setScanC] = useState({ x: 0, z: 0 });
  const [modelRadius, setModelRadius] = useState(0);
  // Frame a newly picked site (unless a site model is loaded: that one frames itself).
  useEffect(() => {
    if (site && !modelUrl) setFit({ center: new Vector3(0, 0, 0), radius: site.radius * 0.9, nonce: Date.now() });
  }, [site?.fetchedAt, site?.lat, site?.lon]);
  const handleModelLoaded = (sphere: THREE.Sphere, centre: { x: number; z: number }) => {
    setFit({ center: sphere.center.clone(), radius: sphere.radius, nonce: Date.now() });
    setModelRadius(sphere.radius);
    setScanC(centre);
    onModelBounds?.(new Vector3(centre.x, sphere.center.y, centre.z), sphere.radius);
    onModelLoaded?.();
  };
  const gridStep = modelUrl && modelRadius > 0 ? Math.pow(10, Math.floor(Math.log10(modelRadius / 6))) : 1;

  const handlePointAdd = (point: Vector3) => {
    if (turntable?.picking) {
      const off = camera.position.clone().sub(point);
      const d = Math.max(off.length(), 2);
      const elev = THREE.MathUtils.radToDeg(Math.asin(Math.min(1, Math.max(0, off.y / Math.max(off.length(), 1e-6)))));
      onTurntableOrigin?.(point.clone(), d, Math.min(80, Math.max(8, elev)));
      return;
    }
    if (toolMode === 'measure') {
      onMeasurePoint(point);
      return;
    }

    if (toolMode === 'draw') {
      if (tentData.isClosed) return;
      setTentData({
        ...tentData,
        points: [...tentData.points, point]
      });
      onSelectionChange([]);
    } else if (toolMode === 'pole') {
      setTentData({
        ...tentData,
        poles: [...tentData.poles, { position: point, height: currentPoleHeight, style: currentPoleStyle, yaw: poleYawAt(point, [tentData.points, ...(tentData.shapes ?? []).map((sh) => sh.points)].filter((pts) => pts.length > 2)) }]
      });
      onSelectionChange([{ type: 'pole', id: tentData.poles.length }]);
    } else {
      onSelectionChange([]);
    }
  };

  // The tent's transform handle sits at its centre (not the world origin): a pivot at the centre
  // wraps an inner group that undoes the offset, so at rest the net transform is identity.
  const tentCenter = useMemo(() => {
    const pts: Vector3[] = [];
    const ring = tentData.isClosed && tentData.points.length > 1 ? tentData.points.slice(0, -1) : tentData.points;
    ring.forEach((p) => pts.push(p));
    tentData.shapes?.forEach((s) => s.points.forEach((p) => pts.push(p)));
    tentData.poles.forEach((p) => pts.push(p.position));
    tentData.furniture.forEach((f) => pts.push(f.position));
    const c = new Vector3();
    if (pts.length) { pts.forEach((p) => c.add(p)); c.divideScalar(pts.length); c.y = 0; }
    return c;
  }, [tentData.points, tentData.poles, tentData.furniture, tentData.isClosed, tentData.shapes]);

  const [tentLive, setTentLive] = useState<string | null>(null);
  const handleTentTransformEnd = () => {
    const pivot = groupRef.current;
    if (!pivot) return;
    pivot.updateMatrix();
    const m = pivot.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(-tentCenter.x, -tentCenter.y, -tentCenter.z));
    const newPoints = tentData.points.map(p => p.clone().applyMatrix4(m));
    const newPoles = tentData.poles.map(p => ({ ...p, position: p.position.clone().applyMatrix4(m) }));
    const newFurniture = tentData.furniture.map(f => ({ ...f, position: f.position.clone().applyMatrix4(m) }));
    const newShapes = tentData.shapes?.map((s) => ({ ...s, points: s.points.map((p) => p.clone().applyMatrix4(m)) }));
    setTentData({ ...tentData, points: newPoints, poles: newPoles, furniture: newFurniture, shapes: newShapes });
    // Reset the pivot; its new centre arrives with the updated tent data.
    pivot.rotation.set(0, 0, 0);
    pivot.scale.set(1, 1, 1);
    const c = new Vector3();
    const ring = tentData.isClosed && newPoints.length > 1 ? newPoints.slice(0, -1) : newPoints;
    const all = [...ring, ...(newShapes ?? []).flatMap((s) => s.points), ...newPoles.map(p => p.position), ...newFurniture.map(f => f.position)];
    if (all.length) { all.forEach((p) => c.add(p)); c.divideScalar(all.length); c.y = 0; }
    pivot.position.copy(c);
  };

  const transformFor = (type: SelectionItem['type'], id: string | number): XformMode | null =>
    toolMode === 'transform' && singleSelection?.type === type && singleSelection.id === id ? transformSubMode : null;
  const snapStep = Math.max(gridStep * 0.25, 0.01);

  const handleBoxSelect = useCallback(({ start, end, shift }: BoxRect) => {
    const left = Math.min(start.x, end.x), right = Math.max(start.x, end.x);
    const top = Math.min(start.y, end.y), bottom = Math.max(start.y, end.y);
    if (right - left < 4 && bottom - top < 4) return;          // a click, not a drag
    const crossing = end.x < start.x;                          // right to left = touch is enough

    // Screen-space bounds of a set of world points.
    const test = (pts: Vector3[]): boolean => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false;
      for (const w of pts) {
        const p = w.clone().project(camera);
        if (p.z > 1) continue;                                 // behind the camera
        any = true;
        const x = (p.x * 0.5 + 0.5) * size.width, y = (-(p.y * 0.5) + 0.5) * size.height;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      if (!any) return false;
      return crossing
        ? x1 >= left && x0 <= right && y1 >= top && y0 <= bottom
        : x0 >= left && x1 <= right && y0 >= top && y1 <= bottom;
    };
    const corners = (box: THREE.Box3): Vector3[] => {
      const out: Vector3[] = [];
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) out.push(new Vector3(x, y, z));
      return out;
    };

    const found: SelectionItem[] = [];
    scene.traverse((o) => {
      const t = o.userData?.selType as SelectionItem['type'] | undefined;
      if (!t) return;
      const bb = new THREE.Box3().setFromObject(o);
      if (bb.isEmpty()) return;
      if (t === 'pole' && !layers.poles) return;
      if (t === 'furniture' && !layers.furniture) return;
      if (t === 'model' && !layers.imports) return;
      if (test(corners(bb))) found.push({ type: t, id: o.userData.selId });
    });

    // The tent outline (move/rotate it as a whole) when any of its shapes is picked
    if (layers.sketch) {
      const rest = tentData.shapes ?? [];
      const shapes = [{ points: tentData.points }, ...rest];
      if (shapes.some((sh) => sh.points.length > 1 && test(sh.points))) found.push({ type: 'tent', id: 0 });
    }

    if (shift) {
      const merged = [...selections];
      found.forEach((f) => { if (!merged.some((m) => m.type === f.type && m.id === f.id)) merged.push(f); });
      onSelectionChange(merged);
    } else {
      onSelectionChange(found);                                // an empty box clears the selection
    }
  }, [camera, size, scene, layers, tentData, selections, onSelectionChange]);

  // Helper to determine if a specific item is selected
  const isSelected = (type: SelectionItem['type'], id: string | number) => {
    return selections.some(s => s.type === type && s.id === id);
  };

  // Get single selection for transform logic (disable transform on multi-select for simplicity)
  const singleSelection = selections.length === 1 ? selections[0] : null;

  return (
      <>
        {sun ? (
          <>
            <SunRig
              pos={sun.pos} north={sun.north} light={theme === 'light'}
              extent={site ? site.radius * 1.05 : Math.max(60, modelRadius * 2.5)}
            />
            <ShadowEnabler />
          </>
        ) : (
          <>
            <ambientLight intensity={0.5} />
            <directionalLight position={[10, 20, 10]} intensity={1} castShadow />
          </>
        )}
        <Environment resolution={128}>
          <Lightformer intensity={2.2} position={[0, 10, 0]} rotation-x={Math.PI / 2} scale={[40, 40, 1]} />
          <Lightformer intensity={1.2} position={[-20, 6, 10]} scale={[20, 10, 1]} />
          <Lightformer intensity={1.0} position={[20, 6, -10]} rotation-y={Math.PI} scale={[20, 10, 1]} />
        </Environment>

        {layers.grid && (
          <Grid
            position={[0, -0.01, 0]}
            args={[100, 100]}
            cellSize={gridStep}
            cellThickness={0.6}
            cellColor={theme === 'light' ? '#d3d3ce' : '#2e323a'}
            sectionSize={gridStep * 5}
            sectionThickness={1}
            sectionColor={theme === 'light' ? '#b3b3ab' : '#4a505c'}
            fadeDistance={Math.max(50, modelRadius * 12)}
            fadeStrength={1.5}
            infiniteGrid
          />
        )}

        {site && layers.site && siteColors && (
          <SiteLayer site={site} colors={siteColors} ghost={!!alignMode} hidden={hiddenBuildings} />
        )}

        {modelUrl && (
          <React.Suspense fallback={null}>
             {/* The scan moves onto the map (which stays north-up). Pivot = the scan's own centre. */}
             <group
               ref={setScanGrp}
               userData={{ scanPose: true, centre: scanC }}
               position={[scanC.x + siteAlign.x, scanY, scanC.z + siteAlign.z]}
               rotation={[0, THREE.MathUtils.degToRad(siteAlign.rot), 0]}
               scale={siteAlign.scale}
             >
               <group position={[-scanC.x, 0, -scanC.z]}>
                 <Model url={modelUrl} kind={modelKind} visible={layers.model} onLoaded={handleModelLoaded} />
               </group>
             </group>
          </React.Suspense>
        )}
        {alignMode && scanGrp && (
          <>
            <Gizmo
              object={scanGrp} mode={alignMode} snap={false} step={1}
              axes={alignMode === 'translate' ? { x: true, y: false, z: true } : { x: false, y: true, z: false }}
              onLive={setAlignLive}
              onCommit={() => onSiteAlign?.({
                x: +(scanGrp.position.x - scanC.x).toFixed(3), z: +(scanGrp.position.z - scanC.z).toFixed(3),
                rot: +yawDeg(scanGrp).toFixed(2), scale: siteAlign.scale,
              })}
            />
            {alignLive && <Chip position={[scanGrp.position.x, scanGrp.position.y + 0.5, scanGrp.position.z]} tone="live">{alignLive}</Chip>}
          </>
        )}

        {/* Controller must be disabled during box select dragging ideally, handled by toolMode */}
        {probeRef && <ScanProbe probe={probeRef} />}
        <CameraController viewMode={viewMode} fit={fit} />
        <DepthCamera active={viewMode === 'depth'} />

        {groundPickRef && <GroundPicker pick={groundPickRef} hitModel={modelHitRef} groundY={groundY} />}
        {swapPreview && (
          <group position={swapPreview.center} rotation={[swapPreview.rot.x, swapPreview.rot.y, swapPreview.rot.z]} raycast={() => null}>
            <mesh raycast={() => null}>
              <boxGeometry args={[swapPreview.size.x, swapPreview.size.y, swapPreview.size.z]} />
              <meshBasicMaterial color={ACCENT} transparent opacity={0.22} depthWrite={false} depthTest={false} />
            </mesh>
            <lineSegments raycast={() => null}>
              <edgesGeometry args={[new THREE.BoxGeometry(swapPreview.size.x, swapPreview.size.y, swapPreview.size.z)]} />
              <lineBasicMaterial color={ACCENT} transparent opacity={0.9} depthTest={false} />
            </lineSegments>
          </group>
        )}
        {turntable && !turntable.picking && <TurntableRig t={turntable} groundY={groundY} />}
        <BoxSelector active={toolMode === 'box-select'} onSelect={handleBoxSelect} />
        <DrawingLayer
          active={toolMode === 'draw' || toolMode === 'pole' || toolMode === 'measure' || !!turntable?.picking}
          toolMode={turntable?.picking ? 'pole' : toolMode}
          points={tentData.points}
          isClosed={tentData.isClosed}
          measurePoints={measureState.points}
          gridStep={gridStep} groundY={groundY}
          onPointAdd={handlePointAdd}
          onClose={() => onCloseLoop?.()}
        />

        {/* --- Measurement Tool Visuals --- */}
        {layers.measurements && <MeasureLayer
          measure={measureState} gridStep={gridStep}
          selectedId={selections.find((s) => s.type === 'measure')?.id as number | undefined ?? null}
          canPick={toolMode === 'view'}
          onPick={(i) => onSelectionChange([{ type: 'measure', id: i }])}
          onDelete={onDeleteMeasure}
        />}

        {/* --- External Models --- */}
        {layers.imports && externalModels.map((model) => (
          <ExternalObjModel
            key={model.id}
            model={model}
            isSelected={isSelected('model', model.id)}
            groundY={groundY}
            onSelect={() => onSelectionChange([{ type: 'model', id: model.id }])}
            transformMode={transformFor('model', model.id)}
            snap={snap}
            snapStep={snapStep}
            onTransformEnd={(next) => setExternalModels(externalModels.map(m => m.id === model.id ? { ...m, ...next } : m))}
            onDropped={(y) => setExternalModels(externalModels.map(m => m.id === model.id
              ? { ...m, position: new Vector3(m.position.x, y, m.position.z) }
              : m))}
          />
        ))}

        {/* --- The Tent Group --- */}
        <group ref={groupRef} position={tentCenter}>
        <group position={[-tentCenter.x, -tentCenter.y, -tentCenter.z]}>
          {/* Render Sketch Lines */}
          {tentData.points.length > 0 && layers.sketch && (
            <Line
              points={tentData.points}
              color={tentColor}
              lineWidth={3}
            />
          )}

          {/* Other shapes in this option */}
          {layers.sketch && tentData.shapes?.map((s, si) => s.points.length > 0 && (
            <React.Fragment key={`shape-${si}`}>
              <Line points={s.points} color={tentColor} lineWidth={2} transparent opacity={0.6} />
              {s.points.map((p, i) => <ScreenDot key={i} position={p} px={3.5} color={tentColor} />)}
            </React.Fragment>
          ))}

          {/* Right-click any closed shape to change it */}
          {(() => {
            const rest = tentData.shapes ?? [];
            const at = Math.min(tentData.activeShape ?? rest.length, rest.length);
            const all = [...rest.slice(0, at), { points: tentData.points, isClosed: tentData.isClosed }, ...rest.slice(at)];
            const drawing = toolMode === 'draw' || toolMode === 'pole' || toolMode === 'measure';
            return all.map((s, i) => s.isClosed && s.points.length > 3 ? (
              <ShapeHit key={`hit-${i}`} points={s.points} enabled={!drawing && !pickingEdge} onMenu={(x, y) => onShapeMenu?.(i, x, y)} onPick={() => onShapePick?.(i)} />
            ) : null);
          })()}

          {/* Render Fabric Panels */}
          {layers.fabric && fabricPanels.length > 0 && (
             <FabricRenderer panels={fabricPanels} />
          )}

          {/* Render Measurements */}
          {layers.measurements && layers.sketch && (
            <SketchMeasurements points={tentData.points} minLength={gridStep * 0.5} />
          )}

          {/* Render Points */}
          {layers.sketch && tentData.points.map((p, i) => (
            <ScreenDot key={`pt-${i}`} position={p} px={4.5} color={i === 0 ? ACCENT : tentColor} />
          ))}

          {pickingEdge && tentData.isClosed && tentData.points.length > 3 && (
            <EdgePicker points={tentData.points} thickness={Math.max(gridStep * 0.35, 0.3)} onPick={(i) => onPickEdge?.(i)} />
          )}

          {/* Render Poles */}
          {layers.poles && tentData.poles.map((p, i) => {
            const selected = isSelected('pole', i);
            const wood = (p.style ?? 'steel') === 'wood';
            const yaw = p.yaw ?? 0;

            return (
              <React.Fragment key={`pole-${i}`}>
                <group
                  userData={{ selType: 'pole', selId: i }}
                  position={p.position}
                  rotation={[0, yaw, 0]}
                  onClick={(e) => {
                    if (e.nativeEvent?.button !== 0) return;
                    e.stopPropagation();
                    onSelectionChange([{ type: 'pole', id: i }]);
                  }}
                >
                  {wood ? (
                    <mesh position={[0, p.height / 2, 0]} castShadow>
                      <cylinderGeometry args={[0.055, 0.075, p.height, 16]} />
                      <meshStandardMaterial color={selected ? ACCENT : '#8a5a2b'} roughness={0.9} metalness={0} />
                    </mesh>
                  ) : (
                    <React.Suspense fallback={null}>
                      <SteelPole height={p.height} color={selected ? ACCENT : '#1b1d21'} />
                    </React.Suspense>
                  )}

                  {selected && (
                    <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                      <ringGeometry args={[0.3, 0.4, 32]} />
                      <meshBasicMaterial color={ACCENT} opacity={0.8} transparent side={THREE.DoubleSide} />
                    </mesh>
                  )}
                </group>
                {wood && layers.guyLines && <GuyLine base={p.position} height={p.height} yaw={yaw} />}
              </React.Fragment>
            );
          })}

          {/* Render Furniture */}
          {layers.furniture && (
            <FurnitureRenderer
              baseColor={theme === 'light' ? '#8d939e' : '#c9ccd3'}
              items={tentData.furniture}
              onSelect={(id) => onSelectionChange([{ type: 'furniture', id }])}
              selectedIds={selections.filter(s => s.type === 'furniture').map(s => s.id as string)}
              transformId={singleSelection?.type === 'furniture' ? (singleSelection.id as string) : null}
              transformMode={toolMode === 'transform' ? transformSubMode : 'translate'}
              snap={snap}
              snapStep={snapStep}
              onTransformEnd={(id, next) => setTentData({
                ...tentData,
                furniture: tentData.furniture.map(f => f.id === id ? { ...f, ...next } : f),
              })}
            />
          )}

        </group>
        </group>

        {/* Preview of where auto corner poles will go */}
        {ghostPoles && ghostPoles.length > 1 && (
          <group>
            <Line
              points={[...ghostPoles, ghostPoles[0]]} color={ACCENT} lineWidth={1.5}
              dashed dashSize={gridStep * 0.4} gapSize={gridStep * 0.25} depthTest={false} renderOrder={7}
            />
            {ghostPoles.map((p, i) => <ScreenDot key={`ghost-${i}`} position={p} px={5} />)}
          </group>
        )}

        {/* Global Transform for the whole tent structure (points + poles + furniture) */}
        {singleSelection?.type === 'tent' && toolMode === 'transform' && (tentData.points.length > 0 || tentData.poles.length > 0) && (
          groupRef.current && (
            <>
              <Gizmo
                object={groupRef.current} mode={transformSubMode} snap={snap} step={snapStep}
                axes={transformSubMode === 'translate' ? { x: true, y: false, z: true } : transformSubMode === 'rotate' ? { x: false, y: true, z: false } : undefined}
                onLive={setTentLive} onCommit={handleTentTransformEnd}
              />
              {tentLive && <Chip position={[tentCenter.x, 0.2, tentCenter.z]} tone="live">{tentLive}</Chip>}
            </>
          )
        )}
      </>
  );
};

const Viewer3D: React.FC<Viewer3DProps> = (props) => {
  return (
    <div className="w-full h-full bg-bg relative">
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        onCreated={({ gl, scene, camera }) => {
          props.onCanvasCreated(gl, scene, camera);
        }}
        camera={{ position: [30, 30, 30], fov: 45 }}
        onPointerMissed={() => props.onSelectionChange([])}
      >
        <color attach="background" args={[props.theme === 'light' ? '#ecece8' : '#0b0c0e']} />
        <ViewerScene {...props} />
      </Canvas>
    </div>
  );
};

export default Viewer3D;