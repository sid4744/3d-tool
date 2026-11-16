import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import JSZip from 'jszip';
import { Loader2, Palette, ScanFace } from 'lucide-react';
import { Vector3 } from 'three';
import * as THREE from 'three';
import Viewer3D from './components/Viewer3D';
import { QuickHelp } from './components/QuickHelp';
import { Tour } from './components/Tour';
import { LibraryPanel, LIB_MIME, libDrag } from './components/LibraryPanel';
import type { ModelHit } from './components/Viewer3D';
import { useLibrary } from './hooks/useLibrary';
import { TopBar, ToolRail, ContextBar, TransformPanel, StatusBar, EmptyState, DropOverlay, Toasts, TOOLS, Toast } from './components/Shell';
import { Inspector, DepthSection, SelectionSection, LayersSection, LayoutPanel, TakeoffSection, PolesPanel, PaletteSection, OptionsSection, PanelCard, SitePanel, SunPanel, TurntablePanel, DepthSettings } from './components/Inspector';
import { useHeadTracking, trackingSettings } from './hooks/useHeadTracking';
import { cornerPoleSpecs, poleYawAt } from './utils/poles';
import { snapSteelHeight } from './components/PoleIcons';
import type { PoleStyle, TurntableState } from './types';
import type { SiteData, SiteColors, SiteAlign } from './utils/site';
import { SITE_PRESETS, NO_ALIGN, reversePlace } from './utils/site';
import { DEFAULT_SUN, sunAt, sunTimes, type SunSettings } from './utils/sun';
import { SiteDialog } from './components/SiteDialog';
import { AlignDialog } from './components/AlignDialog';
import { VariantBar } from './components/VariantBar';
import { scanFloor, buildingsOverlappingScan, scanPoseFromMap, type ScanRaster } from './utils/autoalign';
import { calculatePolygonArea, formatArea, getPolygonBounds, calculateFabricUsage } from './utils/geometry';
import { generateDXF, generateOBJ, generatePDF, downloadFile } from './utils/exporters';
import { generateLayout } from './services/layout';
import {
  ViewMode, ToolMode, TentData, LayerState, MeasurementState, ExternalModel, SelectionItem, MaterialReport, ModelKind,
} from './types';

const EXT_KIND: Record<string, ModelKind> = { glb: 'gltf', gltf: 'gltf', obj: 'obj', stl: 'stl', ply: 'ply', fbx: 'fbx' };
const MODEL_ACCEPT = '.glb,.gltf,.obj,.stl,.ply,.fbx,.zip';
const DEPTH_KEY = 'qtents.depth';
const POLES_KEY = 'qtents.poles';
const PALETTE_KEY = 'qtents.palette.v2'; // bumped so old saved extras are cleared
// The standard colours (matched from the Grasshopper swatches). Your own saved colours are added after these.
const DEFAULT_PALETTE = ['#fdfdfd', '#d0d0d0', '#b5936b', '#6b5a45', '#c8302c', '#141414'];
const STARTER_COLOURS: string[] = [];
const loadCustomColours = (): string[] => {
  try {
    const raw = localStorage.getItem(PALETTE_KEY);
    if (raw === null) return STARTER_COLOURS;
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((c) => typeof c === 'string') : STARTER_COLOURS;
  } catch { return STARTER_COLOURS; }
};
const DEFAULT_POLES: { offset: number; height: number; style: PoleStyle } = { offset: 0.3, height: 4, style: 'steel' };
const loadPoleDefaults = (): { offset: number; height: number; style: PoleStyle } => {
  try { return { ...DEFAULT_POLES, ...JSON.parse(localStorage.getItem(POLES_KEY) || '{}') }; } catch { return DEFAULT_POLES; }
};
const DEFAULT_DEPTH: DepthSettings = { strength: 1, diag: 15.6, fov: 65 };

const loadDepthSettings = (): DepthSettings => {
  try {
    return { ...DEFAULT_DEPTH, ...JSON.parse(localStorage.getItem(DEPTH_KEY) || '{}') };
  } catch {
    return DEFAULT_DEPTH;
  }
};

// A bad model file throws inside the canvas; catch it here instead of blanking the whole app.
class ModelBoundary extends React.Component<
  { resetKey: unknown; onError: (e: Error) => void; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: Error) { this.props.onError(e); }
  componentDidUpdate(prev: { resetKey: unknown }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() { return this.state.failed ? null : this.props.children; }
}

const App = () => {
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [modelKind, setModelKind] = useState<ModelKind>('gltf');
  const [modelName, setModelName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('orbit');
  const [toolMode, setToolMode] = useState<ToolMode>('view');
  const [transformSubMode, setTransformSubMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
  const [snap, setSnap] = useState(true);
  const [customColours, setCustomColours] = useState<string[]>(loadCustomColours);
  useEffect(() => {
    try { localStorage.setItem(PALETTE_KEY, JSON.stringify(customColours)); } catch { /* storage unavailable */ }
  }, [customColours]);
  const palette = useMemo(() => [...DEFAULT_PALETTE, ...customColours.filter((c) => !DEFAULT_PALETTE.includes(c))], [customColours]);

  // Data
  const [tentData, setTentData] = useState<TentData>({ points: [], poles: [], furniture: [], area: 0, isClosed: false });
  const [externalModels, setExternalModels] = useState<ExternalModel[]>([]);
  const [history, setHistory] = useState<TentData[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(() => {
    try { return localStorage.getItem('qtents.tour.seen') !== '1'; } catch { return false; }   // first visit: start the demo tour
  });
  const closeTour = () => { setTourOpen(false); try { localStorage.setItem('qtents.tour.seen', '1'); } catch { /* ignore */ } };
  const [libraryOpen, setLibraryOpen] = useState(false);
  const library = useLibrary();
  const groundPickRef = useRef<((x?: number, y?: number) => Vector3 | null) | null>(null);
  const modelHitRef = useRef<((x: number, y: number) => ModelHit | null) | null>(null);
  const [swapPreview, setSwapPreview] = useState<{ center: Vector3; size: Vector3; rot: Vector3; id: string } | null>(null);
  const swapRaf = useRef(0);
  const [turntable, setTurntableState] = useState<TurntableState | null>(null);
  const setTurntable = (p: Partial<TurntableState>) => setTurntableState((t) => (t ? { ...t, ...p } : t));
  const toggleTurntable = () => {
    if (turntable) { setTurntableState(null); return; }
    if (viewMode !== 'orbit') setViewMode('orbit');
    setToolMode('view');
    setTurntableState({ picking: true, origin: null, base: 20, zoom: 1, elev: 30, speed: 12, reverse: false, playing: false });
  };
  const [future, setFuture] = useState<TentData[]>([]); // undone states, for redo
  // Sketch options: the active one lives in tentData/history; the others are parked here.
  type Variant = { id: string; name: string; data: TentData; history: TentData[] };
  const EMPTY_TENT: TentData = { points: [], poles: [], furniture: [], area: 0, isClosed: false };
  const [variants, setVariants] = useState<Variant[]>([{ id: 'v1', name: 'Option A', data: EMPTY_TENT, history: [] }]);
  const [activeVariant, setActiveVariant] = useState('v1');
  const nextVariantNo = useRef(2);
  const [poleHeight, setPoleHeight] = useState<number>(() => loadPoleDefaults().height);
  const [poleOffset, setPoleOffset] = useState<number>(() => loadPoleDefaults().offset);
  const [poleStyle, setPoleStyleState] = useState<PoleStyle>(() => loadPoleDefaults().style);
  const [previewCorners, setPreviewCorners] = useState(false);
  useEffect(() => {
    try { localStorage.setItem(POLES_KEY, JSON.stringify({ offset: poleOffset, height: poleHeight, style: poleStyle })); } catch { /* storage unavailable */ }
  }, [poleOffset, poleHeight, poleStyle]);
  const [selections, setSelections] = useState<SelectionItem[]>([]);
  const [tentColorPick, setTentColor] = useState<string | null>(null);
  const [measureState, setMeasureState] = useState<MeasurementState>({ points: [], distance: null, done: [] });
  const [layoutPrompt, setLayoutPrompt] = useState('');
  const [layers, setLayers] = useState<LayerState>({
    model: true, sketch: true, grid: true, poles: true, measurements: true, furniture: true, imports: true, fabric: false, guyLines: true, site: true,
  });
  const [site, setSite] = useState<SiteData | null>(() => {
    try { return JSON.parse(localStorage.getItem('qtents.site') || 'null'); } catch { return null; }
  });
  const [siteDialog, setSiteDialog] = useState(false);

  // Alignment of the map to a loaded scan.
  // The map stays fixed and north-up; this is how the SCAN is moved/turned onto it (offset of its centre, turn, scale).
  const [siteAlign, setSiteAlign] = useState<SiteAlign>(NO_ALIGN);
  const [alignMode, setAlignMode] = useState<'translate' | 'rotate' | null>(null);
  const [autoAlignOpen, setAutoAlignOpen] = useState(false);
  // Vertical: the scan floor often sits below the map floor. scanY lifts the whole scan.
  const [scanY, setScanY] = useState(0);
  const [floorLift, setFloorLift] = useState(0.15);
  // Height of the real floor (the scan's floor when a scan is loaded, else the map at 0): sketches always sit on it.
  const [groundY, setGroundY] = useState(0);
  const [pickingEdge, setPickingEdge] = useState(false);
  const [polesOpen, setPolesOpen] = useState(false);
  const [sketchBarOpen, setSketchBarOpen] = useState(false); // the options/shapes bar stays until the tick is pressed
  const [furnitureOpen, setFurnitureOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [sunOpen, setSunOpen] = useState(false);
  const [coloursHidden, setColoursHidden] = useState(false); // dismissed with the X until the next selection
  const [depthHidden, setDepthHidden] = useState(false);
  const prevGround = useRef(0);
  const [buildingMode, setBuildingMode] = useState<'all' | 'clear' | 'none'>('clear'); // auto-hide buildings the scan runs into
  const [showHidden, setShowHidden] = useState(false); // bring those auto-hidden buildings back
  const [overlap, setOverlap] = useState<Set<number> | null>(null);
  const probeRef = useRef<((raw?: boolean) => ScanRaster | null) | null>(null);
  const [modelBounds, setModelBounds] = useState<{ x: number; z: number } | null>(null);

  // Map colours: a preset (or Auto = follows light/dark) plus any per-element overrides.
  const [siteStyle, setSiteStyle] = useState<{ preset: string; custom: Partial<SiteColors> }>(() => {
    try { return { preset: 'auto', custom: {}, ...JSON.parse(localStorage.getItem('qtents.siteStyle') || '{}') }; } catch { return { preset: 'auto', custom: {} }; }
  });
  useEffect(() => {
    try { localStorage.setItem('qtents.siteStyle', JSON.stringify(siteStyle)); } catch { /* storage unavailable */ }
  }, [siteStyle]);
  // Sun: real position for the site's latitude/longitude (Utrecht when there is no site).
  const [sun, setSun] = useState<SunSettings>(() => {
    try { return { ...DEFAULT_SUN(), ...JSON.parse(localStorage.getItem('qtents.sun') || '{}') }; } catch { return DEFAULT_SUN(); }
  });
  useEffect(() => {
    try { localStorage.setItem('qtents.sun', JSON.stringify(sun)); } catch { /* storage unavailable */ }
  }, [sun]);
  const [sunPlaying, setSunPlaying] = useState(false);
  useEffect(() => {
    if (!sunPlaying) return;
    const id = setInterval(() => setSun((s) => ({ ...s, minutes: (s.minutes + 6) % 1440 })), 60);
    return () => clearInterval(id);
  }, [sunPlaying]);
  const sunLat = site?.lat ?? 52.0907, sunLon = site?.lon ?? 5.1214;
  const sunPos = useMemo(() => sunAt(sun, sunLat, sunLon), [sun, sunLat, sunLon]);
  const sunDay = useMemo(() => sunTimes(sun, sunLat, sunLon), [sun.date, sun.utcOffset, sunLat, sunLon]);
  useEffect(() => {
    try { site ? localStorage.setItem('qtents.site', JSON.stringify(site)) : localStorage.removeItem('qtents.site'); }
    catch { /* too large or storage unavailable: the site just won't be remembered */ }
  }, [site]);

  // A saved site can carry a name from an earlier search that no longer matches its coordinates: re-label it once.
  useEffect(() => {
    if (!site) return;
    const key = `${site.lat.toFixed(5)},${site.lon.toFixed(5)}`;
    let done = false;
    try { done = localStorage.getItem('qtents.siteNameChecked') === key; } catch { /* ignore */ }
    if (done) return;
    let live = true;
    reversePlace(site.lat, site.lon).then((label) => {
      if (!live) return;
      try { localStorage.setItem('qtents.siteNameChecked', key); } catch { /* ignore */ }
      if (label && label !== site.name) setSite((s) => (s && `${s.lat.toFixed(5)},${s.lon.toFixed(5)}` === key ? { ...s, name: label } : s));
    }).catch(() => { /* offline: try again next time */ });
    return () => { live = false; };
  }, [site?.lat, site?.lon]);

  // Depth view
  const [depth, setDepth] = useState<DepthSettings>(loadDepthSettings);
  const [showCamera, setShowCamera] = useState(false);
  const tracking = useHeadTracking(viewMode === 'depth');
  useEffect(() => {
    trackingSettings.strength = depth.strength;
    trackingSettings.diagInches = depth.diag;
    trackingSettings.hfovDeg = depth.fov;
    try { localStorage.setItem(DEPTH_KEY, JSON.stringify(depth)); } catch { /* storage unavailable */ }
  }, [depth]);

  // UI
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dragging, setDragging] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('qtents.theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch { /* storage unavailable */ }
    return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('qtents.theme', theme); } catch { /* storage unavailable */ }
  }, [theme]);
  const siteColors: SiteColors = useMemo(() => {
    const id = siteStyle.preset === 'auto' ? (theme === 'light' ? 'paper' : 'night') : siteStyle.preset;
    const base = (SITE_PRESETS.find((p) => p.id === id) ?? SITE_PRESETS[0]).colors;
    return { ...base, ...siteStyle.custom };
  }, [siteStyle, theme]);

  const toggleTheme = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  // Default outline colour contrasts with the viewport; a colour the user picked wins.
  const tentColor = tentColorPick ?? (theme === 'light' ? '#22252b' : '#ffffff');
  const [inspectorOpen, setInspectorOpen] = useState(false); // hidden until there is something to report
  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 3500);
  }, []);

  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const modelFileInput = useRef<HTMLInputElement>(null);
  const objFileInput = useRef<HTMLInputElement>(null);
  const urlRef = useRef<string | null>(null);

  const handleCanvasCreated = (gl: THREE.WebGLRenderer) => { glRef.current = gl; };

  // -- history --
  const updateTentData = (newData: TentData) => {
    setHistory((prev) => [...prev, tentData]);
    setFuture([]);
    setTentData(newData);
  };
  const handleUndo = () => {
    if (history.length === 0) return;
    setFuture((f) => [...f, tentData]);
    setTentData(history[history.length - 1]);
    setHistory((prev) => prev.slice(0, -1));
    setSelections([]);
  };
  const handleRedo = () => {
    if (future.length === 0) return;
    setHistory((prev) => [...prev, tentData]);
    setTentData(future[future.length - 1]);
    setFuture((f) => f.slice(0, -1));
    setSelections([]);
  };

  const parkActive = (vs: Variant[]) => vs.map((v) => (v.id === activeVariant ? { ...v, data: tentData, history } : v));
  const switchVariant = (id: string) => {
    if (id === activeVariant) return;
    const target = variants.find((v) => v.id === id);
    if (!target) return;
    setVariants(parkActive(variants));
    setTentData(target.data); setHistory(target.history); setFuture([]); setActiveVariant(id); setSelections([]);
    setPickingEdge(false); setPolesOpen(false);
    if (target.data.points.length === 0 && !target.data.shapes?.length) changeToolMode('draw'); // an empty option is for drawing
  };
  const addVariant = (copy: boolean) => {
    const n = nextVariantNo.current++;
    const v: Variant = {
      id: `v${n}`, name: copy ? `${variants.find((x) => x.id === activeVariant)?.name ?? 'Option'} copy` : `Option ${String.fromCharCode(64 + n)}`,
      data: copy ? { ...tentData, points: [...tentData.points], poles: [...tentData.poles], furniture: [...tentData.furniture] } : EMPTY_TENT,
      history: [],
    };
    setVariants([...parkActive(variants), v]);
    setTentData(v.data); setHistory([]); setFuture([]); setActiveVariant(v.id); setSelections([]);
    setPickingEdge(false); setPolesOpen(false);
    if (!copy) changeToolMode('draw');
  };
  const deleteVariant = (id: string) => {
    if (variants.length < 2) return;
    const rest = variants.filter((v) => v.id !== id);
    if (id === activeVariant) {
      const nxt = rest[Math.max(0, variants.findIndex((v) => v.id === id) - 1)];
      setVariants(rest); setTentData(nxt.data); setHistory(nxt.history); setFuture([]); setActiveVariant(nxt.id); setSelections([]);
    } else setVariants(rest);
  };

  // -- several shapes in one option --
  type Shape = { points: Vector3[]; isClosed: boolean; panelEdge?: number };
  const allShapes = (t: TentData): Shape[] => {
    const rest = t.shapes ?? [];
    const at = Math.min(t.activeShape ?? rest.length, rest.length);
    return [...rest.slice(0, at), { points: t.points, isClosed: t.isClosed, panelEdge: t.panelEdge }, ...rest.slice(at)];
  };
  const withActive = (t: TentData, list: Shape[], j: number): TentData => ({
    ...t, points: list[j].points, isClosed: list[j].isClosed, panelEdge: list[j].panelEdge,
    shapes: list.filter((_, i) => i !== j), activeShape: j,
  });
  const shapeCount = (tentData.shapes?.length ?? 0) + 1;
  const activeShape = Math.min(tentData.activeShape ?? shapeCount - 1, shapeCount - 1);
  const handleAddShape = () => {
    if (tentData.points.length === 0) { toast('Draw the current shape first.', 'error'); return; }
    let t = tentData;
    if (!t.isClosed) {
      if (t.points.length < 3) { toast('Finish the current shape (3+ corners) before starting another.', 'error'); return; }
      t = { ...t, points: [...t.points, t.points[0]], isClosed: true };
    }
    const list = allShapes(t);
    list.push({ points: [], isClosed: false });
    setPickingEdge(false);
    updateTentData(withActive(t, list, list.length - 1));
    setSelections([]); setToolMode('draw');
  };
  const handleSelectShape = (j: number) => {
    if (j === activeShape) return;
    updateTentData(withActive(tentData, allShapes(tentData), j));
    setSelections([]);
  };
  const handleDeleteShape = () => {
    const list = allShapes(tentData);
    if (list.length < 2) return;
    const next = list.filter((_, i) => i !== activeShape);
    updateTentData(withActive(tentData, next, Math.min(activeShape, next.length - 1)));
    setSelections([]);
  };

  // Every closed shape gets its own panelling; the quote is the sum, with the split kept per shape.
  const shapeStats = useMemo(() => allShapes(tentData).flatMap((s, i) => (
    s.isClosed && s.points.length > 2
      ? [{ index: i, area: calculatePolygonArea(s.points), report: calculateFabricUsage(s.points, s.panelEdge), edge: s.panelEdge }]
      : []
  )), [tentData.points, tentData.isClosed, tentData.shapes, tentData.panelEdge, tentData.activeShape]);
  const materialReport: MaterialReport = useMemo(() => ({
    totalArea: shapeStats.reduce((a, s) => a + s.report.totalArea, 0),
    wasteArea: shapeStats.reduce((a, s) => a + s.report.wasteArea, 0),
    panelCount: shapeStats.reduce((a, s) => a + s.report.panelCount, 0),
    panels: shapeStats.flatMap((s) => s.report.panels.map((p) => ({ ...p, id: s.index * 1000 + p.id }))),
  }), [shapeStats]);

  // The details panel opens by itself the moment a shape is completed.
  const hadShapes = useRef(false);
  useEffect(() => {
    const has = shapeStats.length > 0;
    if (has && !hadShapes.current) setInspectorOpen(true);
    hadShapes.current = has;
  }, [shapeStats.length]);

  // Each saved option's totals, for the options slider (the active one is read live).
  const optionStats = useMemo(() => variants.map((v) => {
    const t = v.id === activeVariant ? tentData : v.data;
    const stats = allShapes(t).filter((sh) => sh.isClosed && sh.points.length > 2);
    return {
      id: v.id, name: v.name, shapes: stats.length,
      area: stats.reduce((a, sh) => a + calculatePolygonArea(sh.points), 0),
      fabric: stats.reduce((a, sh) => a + calculateFabricUsage(sh.points, sh.panelEdge).totalArea, 0),
    };
  }), [variants, activeVariant, tentData]);

  // A second option means there is something to compare: open the panel with the options slider.
  useEffect(() => { if (variants.length > 1) setInspectorOpen(true); }, [variants.length]);

  useEffect(() => { if (toolMode === 'draw') setSketchBarOpen(true); }, [toolMode]);

  // Right-click menu on a shape
  const [shapeMenu, setShapeMenu] = useState<{ index: number; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!shapeMenu) return;
    const close = () => setShapeMenu(null);
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    addEventListener('pointerdown', close); addEventListener('keydown', k); addEventListener('wheel', close);
    return () => { removeEventListener('pointerdown', close); removeEventListener('keydown', k); removeEventListener('wheel', close); };
  }, [shapeMenu]);
  const editShapeDirection = (i: number) => {
    if (i !== activeShape) updateTentData(withActive(tentData, allShapes(tentData), i));
    setSelections([]); setToolMode('view'); setPickingEdge(true);
  };
  const redrawShape = (i: number) => {
    const t = i === activeShape ? tentData : withActive(tentData, allShapes(tentData), i);
    updateTentData({ ...t, points: [], isClosed: false, panelEdge: undefined });
    setSelections([]); setPickingEdge(false); setToolMode('draw');
  };
  const deleteShapeAt = (i: number) => {
    const list = allShapes(tentData);
    if (list.length < 2) { redrawShape(i); return; }
    const next = list.filter((_, j) => j !== i);
    updateTentData(withActive(tentData, next, Math.min(i, next.length - 1)));
    setSelections([]);
  };

  // Recalculate area and fabric whenever the outline changes
  useEffect(() => {
    const extra = (tentData.shapes ?? []).reduce((a, s) => a + (s.isClosed && s.points.length > 2 ? calculatePolygonArea(s.points) : 0), 0);
    if (tentData.points.length > 2 && tentData.isClosed) {
      setTentData((prev) => ({ ...prev, area: calculatePolygonArea(tentData.points) + extra }));
      setLayers((prev) => (prev.fabric ? prev : { ...prev, fabric: true }));
    } else {
      setTentData((prev) => ({ ...prev, area: extra }));
    }
  }, [tentData.points, tentData.isClosed, tentData.shapes, tentData.panelEdge]);

  // -- files --
  const setModel = (url: string, kind: ModelKind, name: string) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
    setModelUrl(url);
    setModelKind(kind);
    setModelName(name);
  };

  const openModelFile = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    try {
      if (ext === 'zip') {
        setLoading(true);
        const zip = await JSZip.loadAsync(file);
        let entry: JSZip.JSZipObject | null = null;
        zip.forEach((_, e) => { if (/\.(glb|gltf)$/i.test(e.name)) entry = e; });
        if (!entry) { setLoading(false); toast('That zip has no .glb or .gltf inside.', 'error'); return; }
        const blob = await (entry as JSZip.JSZipObject).async('blob');
        setModel(URL.createObjectURL(blob), 'gltf', (entry as JSZip.JSZipObject).name.split('/').pop() || file.name);
      } else if (EXT_KIND[ext]) {
        setLoading(true);
        setModel(URL.createObjectURL(file), EXT_KIND[ext], file.name);
      } else {
        toast(`.${ext || 'this'} files aren't supported. Try .glb, .obj, .stl, .ply, .fbx or .zip.`, 'error');
      }
    } catch (err) {
      console.error(err);
      setLoading(false);
      toast('That file could not be read.', 'error');
    }
  };

  const handleModelError = (e: Error) => {
    console.error(e);
    setLoading(false);
    setModelUrl(null);
    setModelName(null);
    toast(
      modelKind === 'gltf'
        ? "Couldn't load that model. A .gltf that needs separate texture files won't work; use .glb instead."
        : "Couldn't load that model.",
      'error',
    );
  };

  const handleImportObj = (file: File) => {
    if (!/\.obj$/i.test(file.name)) { toast('Only .obj files can be added as objects.', 'error'); return; }
    const model: ExternalModel = {
      id: `ext-${Date.now()}`, url: URL.createObjectURL(file), name: file.name,
      position: new Vector3(0, 0, 0), rotation: new Vector3(0, 0, 0), scale: new Vector3(1, 1, 1),
      color: palette[externalModels.length % palette.length],
    };
    setExternalModels((m) => [...m, model]);
    setSelections([{ type: 'model', id: model.id }]);
  };

  // Add objects from the linked library folder: at a drop point, or at the middle of the view.
  const swapWithLibraryObject = async (targetId: string, libId: string) => {
    const old = externalModels.find((m) => m.id === targetId);
    const it = library.items.find((i) => i.id === libId);
    if (!old || !it) return false;
    try {
      const file: File = await it.handle.getFile();
      const hit = modelHitRef.current && swapPreview?.id === targetId ? swapPreview : null;
      const sz = library.sizes[libId];
      const next: ExternalModel = {
        ...old, id: `ext-${Date.now()}-${Math.floor(Math.random() * 1e4)}`, url: URL.createObjectURL(file), name: file.name,
        scale: new Vector3(1, 1, 1), dropNonce: 1,
        position: hit && sz ? hit.center.clone().setY(hit.center.y - hit.size.y / 2 + sz[1] / 2) : old.position.clone(),
      };
      setExternalModels((m) => m.map((x) => (x.id === targetId ? next : x)));
      setSelections([{ type: 'model', id: next.id }]);
      toast(`Swapped ${old.name} for ${file.name}`);
      return true;
    } catch { toast(`Couldn't read ${it.name}.`, 'error'); return false; }
  };

  const addLibraryObjects = async (ids: string[], x?: number, y?: number) => {
    const items = ids.map((id) => library.items.find((i) => i.id === id)).filter(Boolean) as typeof library.items;
    if (!items.length) return;
    const at = groundPickRef.current?.(x, y) ?? new Vector3(0, groundY, 0);
    const made: ExternalModel[] = [];
    for (let k = 0; k < items.length; k++) {
      try {
        const file: File = await items[k].handle.getFile();
        made.push({
          id: `ext-${Date.now()}-${k}-${Math.floor(Math.random() * 1e4)}`, url: URL.createObjectURL(file), name: file.name,
          position: new Vector3(at.x + k * 1.5, groundY + 1.5, at.z), rotation: new Vector3(0, 0, 0), scale: new Vector3(1, 1, 1),
          dropNonce: 1, color: palette[(externalModels.length + k) % palette.length],
        });
      } catch { toast(`Couldn't read ${items[k].name}.`, 'error'); }
    }
    if (!made.length) return;
    setExternalModels((m) => [...m, ...made]);
    setSelections(made.map((m) => ({ type: 'model' as const, id: m.id })));
    toast(made.length === 1 ? `Added ${made[0].name}` : `Added ${made.length} objects`);
  };

  // drag & drop anywhere
  useEffect(() => {
    let depthCount = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types?.includes('Files');
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depthCount++; setDragging(true); } };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const leave = (e: DragEvent) => { if (hasFiles(e) && --depthCount <= 0) { depthCount = 0; setDragging(false); } };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depthCount = 0; setDragging(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) openModelFile(f);
    };
    addEventListener('dragenter', enter); addEventListener('dragover', over);
    addEventListener('dragleave', leave); addEventListener('drop', drop);
    return () => {
      removeEventListener('dragenter', enter); removeEventListener('dragover', over);
      removeEventListener('dragleave', leave); removeEventListener('drop', drop);
    };
  });

  // -- editing --
  const handleCloseLoop = () => {
    if (tentData.points.length < 3 || tentData.isClosed) return;
    updateTentData({ ...tentData, points: [...tentData.points, tentData.points[0]], isClosed: true, panelEdge: undefined });
    setToolMode('view');
    setPickingEdge(true);
    setPolesOpen(true);
  };

  // Tick button: finish drawing this option (closes the outline if needed), then offer corner poles.
  const handleFinishOption = () => {
    if (tentData.points.length === 0) return;
    if (!tentData.isClosed) {
      if (tentData.points.length < 3) { toast('Add at least 3 corners to finish the outline.', 'error'); return; }
      handleCloseLoop();
      setSketchBarOpen(false);
      return;
    }
    setToolMode('view'); setPolesOpen(true); setPickingEdge(false); setSketchBarOpen(false);
    const optName = variants.find((v) => v.id === activeVariant)?.name ?? 'Option';
    toast(`${optName} finished: ${shapeCount} shape${shapeCount > 1 ? 's' : ''}, ${formatArea(tentData.area)} m² floor.`);
  };

  const handleDeleteSelections = () => {
    const poleIdx = selections.filter((s) => s.type === 'pole').map((s) => s.id as number);
    const furnIds = selections.filter((s) => s.type === 'furniture').map((s) => s.id as string);
    const modelIds = selections.filter((s) => s.type === 'model').map((s) => s.id as string);
    const measureIdx = selections.filter((s) => s.type === 'measure').map((s) => s.id as number);
    if (measureIdx.length) deleteMeasurements(measureIdx);
    if (!poleIdx.length && !furnIds.length && !modelIds.length) { if (measureIdx.length) setSelections([]); return; }
    updateTentData({
      ...tentData,
      poles: tentData.poles.filter((_, i) => !poleIdx.includes(i)),
      furniture: tentData.furniture.filter((f) => !furnIds.includes(f.id)),
    });
    setExternalModels((m) => m.filter((x) => !modelIds.includes(x.id)));
    setSelections([]);
  };

  // Choosing a style sets it for new poles, and restyles any poles you currently have selected.
  const setPoleStyle = (style: PoleStyle) => {
    setPoleStyleState(style);
    const idx = selections.filter((s) => s.type === 'pole').map((s) => s.id as number);
    if (style === 'steel') setPoleHeight((h) => snapSteelHeight(h));
    if (idx.length) updateTentData({ ...tentData, poles: tentData.poles.map((p, i) => (idx.includes(i) ? { ...p, style, height: style === 'steel' ? snapSteelHeight(p.height) : p.height } : p)) });
  };
  useEffect(() => { if (poleStyle === 'steel') setPoleHeight((h) => snapSteelHeight(h)); }, [poleStyle]);
  const handleSelectedPoleStyle = (style: PoleStyle) => {
    const idx = selections.filter((s) => s.type === 'pole').map((s) => s.id as number);
    if (!idx.length) return;
    updateTentData({ ...tentData, poles: tentData.poles.map((p, i) => (idx.includes(i) ? { ...p, style, height: style === 'steel' ? snapSteelHeight(p.height) : p.height } : p)) });
  };
  const handleSelectedPoleHeight = (height: number) => {
    if (selections.length !== 1 || selections[0].type !== 'pole') return;
    const idx = selections[0].id as number;
    const poles = [...tentData.poles];
    poles[idx] = { ...poles[idx], height };
    updateTentData({ ...tentData, poles });
  };

  // Poles at every corner of the closed outline, pushed outward by the default offset.
  const cornerSpecs = useMemo(
    () => (tentData.isClosed ? cornerPoleSpecs(tentData.points, poleOffset) : []),
    [tentData.points, tentData.isClosed, poleOffset],
  );
  const corners = useMemo(() => cornerSpecs.map((c) => c.position), [cornerSpecs]);
  // Closed outlines of every shape: what "away from the tent" is measured against.
  const outlines = () => [tentData.points, ...(tentData.shapes ?? []).map((s) => s.points)].filter((pts) => pts.length > 2);
  const handleSelectedPoleYaw = (deg: number) => {
    if (selections.length !== 1 || selections[0].type !== 'pole') return;
    const idx = selections[0].id as number;
    const poles = [...tentData.poles];
    poles[idx] = { ...poles[idx], yaw: (deg * Math.PI) / 180 };
    updateTentData({ ...tentData, poles });
  };
  const handleSelectedPoleFaceOut = () => {
    if (selections.length !== 1 || selections[0].type !== 'pole') return;
    const idx = selections[0].id as number;
    const poles = [...tentData.poles];
    poles[idx] = { ...poles[idx], yaw: poleYawAt(poles[idx].position, outlines()) };
    updateTentData({ ...tentData, poles });
  };
  const handleAddCornerPoles = () => {
    const fresh = cornerSpecs.filter((c) => !tentData.poles.some((p) => p.position.distanceTo(c.position) < 0.1));
    if (fresh.length === 0) { toast('Every corner already has a pole.'); return; }
    const first = tentData.poles.length;
    updateTentData({
      ...tentData,
      poles: [...tentData.poles, ...fresh.map((c) => ({ position: c.position, height: poleStyle === 'steel' ? snapSteelHeight(poleHeight) : poleHeight, style: poleStyle, yaw: c.yaw }))],
    });
    setSelections(fresh.map((_, i) => ({ type: 'pole' as const, id: first + i })));
    toast(`Added ${fresh.length} corner pole${fresh.length > 1 ? 's' : ''}, ${poleOffset} m off the membrane.`);
  };

  const handleDropToGround = () => {
    const ids = selections.filter((s) => s.type === 'model').map((s) => s.id);
    setExternalModels((m) => m.map((x) => (ids.includes(x.id) ? { ...x, dropNonce: (x.dropNonce ?? 0) + 1 } : x)));
  };

  const handleClearLayer = (key: keyof LayerState) => {
    if (key === 'furniture') updateTentData({ ...tentData, furniture: [] });
    else if (key === 'poles') updateTentData({ ...tentData, poles: [] });
    else if (key === 'sketch') updateTentData({ ...tentData, points: [], isClosed: false, area: 0, shapes: undefined, activeShape: undefined, panelEdge: undefined });
    else if (key === 'imports') setExternalModels([]);
    setSelections([]);
  };

  const handleClearSketch = () => {
    updateTentData({ points: [], poles: [], furniture: [], area: 0, isClosed: false });
    setSelections([]);
  };

  // Measurements accumulate: click two points, get a dimension that stays until cleared.
  const handleMeasurePoint = (p: Vector3) => {
    setMeasureState((m) => {
      if (m.points.length === 1) {
        const a = m.points[0];
        return { points: [], distance: a.distanceTo(p), done: [...m.done, [a, p]] };
      }
      return { ...m, points: [p] };
    });
  };
  const deleteMeasurements = (idx: number[]) => setMeasureState((m) => {
    const done = m.done.filter((_, i) => !idx.includes(i));
    const last = done[done.length - 1];
    return { ...m, done, distance: last ? last[0].distanceTo(last[1]) : null };
  });
  const clearMeasurements = () => setMeasureState({ points: [], distance: null, done: [] });

  const handleGenerateLayout = () => {
    if (!layoutPrompt.trim() || tentData.points.length < 3) return;
    try {
      const items = generateLayout(layoutPrompt, getPolygonBounds(tentData.points));
      if (items.length > 0) {
        updateTentData({ ...tentData, furniture: [...tentData.furniture, ...items] });
        toast(`Placed ${items.length} item${items.length > 1 ? 's' : ''}.`);
        setLayoutPrompt('');
      } else {
        toast("Couldn't find any items in that. Try “3 round tables (1m) and 10 chairs”.", 'error');
      }
    } catch (err) {
      console.error(err);
      toast('Layout failed. Try rephrasing.', 'error');
    }
  };

  // -- exports --
  const handleExportDXF = () => downloadFile(generateDXF(tentData.points, tentData.poles), 'qtents_design.dxf', 'application/dxf');
  const handleExportOBJ = () => downloadFile(generateOBJ(tentData.points, tentData.poles), 'qtents_design.obj', 'text/plain');
  const handleExportPDF = () => { if (glRef.current) generatePDF(glRef.current.domElement, tentData, formatArea(tentData.area)); };

  const changeToolMode = (mode: ToolMode) => {
    setToolMode(mode);
    setSelections(mode === 'transform' && selections.length === 0 ? [{ type: 'tent', id: 0 }] : []);
    setMeasureState((m) => (m.points.length ? { ...m, points: [] } : m)); // drop any half-finished measurement
    if (mode === 'draw' && viewMode !== 'top') setViewMode('top');
  };

  // -- keyboard --
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el && (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
        || (el.tagName === 'INPUT' && /^(text|number|search|email|url|tel|password)$/.test((el as HTMLInputElement).type)));
      // Ctrl/Cmd+Z undoes the sketch, except while typing in a text field (where it undoes the text).
      if (!typing && (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); handleUndo(); return; }
      if (!typing && (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); handleRedo(); return; }
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { handleDeleteSelections(); return; }
      if (e.key === 'Escape') {
        if (measureState.points.length) { setMeasureState((m) => ({ ...m, points: [] })); return; }
        setSelections([]); setToolMode('view'); return;
      }
      if (toolMode === 'transform') {
        const k = e.key.toLowerCase();
        if (k === 'g') { setTransformSubMode('translate'); return; }
        if (k === 'r') { setTransformSubMode('rotate'); return; }
        if (k === 'e') { setTransformSubMode('scale'); return; }
        if (k === 'x') { setSnap((v) => !v); return; }
      }
      if (e.key.toLowerCase() === 'l') { toggleTheme(); return; }
      if (e.key.toLowerCase() === 'i') { setInspectorOpen((o) => !o); return; }
      const tool = TOOLS.find((t) => t.key.toLowerCase() === e.key.toLowerCase());
      if (tool) changeToolMode(tool.id);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  const selectedModelIds = selections.filter((s) => s.type === 'model').map((s) => s.id as string);
  const modelSelKey = selectedModelIds.join('|');
  useEffect(() => { if (modelSelKey) setColoursHidden(false); }, [modelSelKey]);
  // Picking an object means you want to move it: drop straight into transform mode.
  useEffect(() => {
    if (modelSelKey && (toolMode === 'view' || toolMode === 'box-select')) setToolMode('transform');
  }, [modelSelKey]);
  useEffect(() => { if (viewMode === 'depth') setDepthHidden(false); }, [viewMode]);
  const paintSelected = (color: string | undefined) => {
    if (!selectedModelIds.length) return;
    setExternalModels((ms) => ms.map((m) => (selectedModelIds.includes(m.id) ? { ...m, color } : m)));
  };

  const transformTarget: string | null = (() => {
    if (selections.length !== 1) return selections.length > 1 ? 'Select one item' : null;
    const s = selections[0];
    if (s.type === 'tent') return 'Whole tent';
    if (s.type === 'model') return externalModels.find((m) => m.id === s.id)?.name ?? 'Object';
    if (s.type === 'furniture') return tentData.furniture.find((f) => f.id === s.id)?.name ?? 'Furniture';
    return 'Poles move with the select tool';
  })();

  // A newly opened scan starts un-moved.
  useEffect(() => { setSiteAlign(NO_ALIGN); setScanY(0); setOverlap(null); }, [modelUrl]);

  const dropScanFloor = (raster?: ScanRaster | null) => {
    const r = raster ?? probeRef.current?.();
    const floor = r ? scanFloor(r) : null;
    if (floor === null) { toast("Couldn't read the scan's floor. Is the scan loaded and visible?", 'error'); return false; }
    setScanY((y) => y - floor + floorLift);
    return true;
  };
  // "Clear scan area": hide map buildings that overlap the scan; recomputed when the alignment moves.
  useEffect(() => {
    if (buildingMode !== 'clear' || !site) { setOverlap(null); return; }
    const t = setTimeout(() => {
      const r = probeRef.current?.();
      setOverlap(r ? buildingsOverlappingScan(site, NO_ALIGN, r) : null); // the scan is already drawn in map space
    }, 250);
    return () => clearTimeout(t);
  }, [buildingMode, site, siteAlign, scanY, modelUrl]);

  useEffect(() => {
    const t = setTimeout(() => {
      const r = modelUrl ? probeRef.current?.() : null;
      const f = r ? scanFloor(r) : null;
      setGroundY(f !== null && f !== undefined ? +f.toFixed(3) : 0);
    }, 300);
    return () => clearTimeout(t);
  }, [modelUrl, scanY, siteAlign, modelBounds]);
  // When the floor height changes, carry every sketch (all options) with it.
  useEffect(() => {
    const d = groundY - prevGround.current;
    prevGround.current = groundY;
    if (Math.abs(d) < 1e-6) return;
    const lift = (t: TentData): TentData => ({
      ...t,
      points: t.points.map((p) => new Vector3(p.x, p.y + d, p.z)),
      poles: t.poles.map((p) => ({ ...p, position: new Vector3(p.position.x, p.position.y + d, p.position.z) })),
      furniture: t.furniture.map((f) => ({ ...f, position: new Vector3(f.position.x, f.position.y + d, f.position.z) })),
    });
    setTentData((t) => lift(t));
    setHistory((h) => h.map(lift));
    setFuture([]);
    setVariants((vs) => vs.map((v) => ({ ...v, data: lift(v.data), history: v.history.map(lift) })));
  }, [groundY]);

  const hasContent =
    !!modelUrl || !!site || tentData.points.length > 0 || tentData.poles.length > 0 || tentData.furniture.length > 0 || externalModels.length > 0;
  const tool = TOOLS.find((t) => t.id === toolMode)!;
  const layoutReason = tentData.points.length < 3 ? 'Sketch the outline first' : null;

  return (
    <div className="h-full flex flex-col bg-bg text-ink">
      {autoAlignOpen && site && (
        <AlignDialog
          site={site} probe={probeRef} onClose={() => setAutoAlignOpen(false)}
          onAligned={(a, r, scan) => {
            setSiteAlign(scanPoseFromMap(a, scan.pivotX ?? scan.cx, scan.pivotZ ?? scan.cz)); setAutoAlignOpen(false); setAlignMode(null);
            dropScanFloor(scan);
            const clear = r.score - Math.max(r.runnerUp, 0);
            toast(r.score > 0.35 && clear > 0.06 ? 'Aligned. Use Align scan to map to fine-tune.'
              : r.score > 0.18 ? 'Aligned, but the match is only fair. Check it, then nudge by hand.'
              : 'Weak match. Try a tighter loop around the buildings, or align by hand.');
          }}
        />
      )}
      {siteDialog && (
        <SiteDialog
          initial={site} onClose={() => setSiteDialog(false)}
          onBuilt={(s) => { setSite(s); setSiteDialog(false); setLayers((l) => ({ ...l, site: true })); toast(`Site built: ${s.buildings.length} buildings, ${s.roads.length} roads.`); }}
        />
      )}
      <input ref={modelFileInput} type="file" accept={MODEL_ACCEPT} hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) openModelFile(f); e.target.value = ''; }} />
      <input ref={objFileInput} type="file" accept=".obj" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportObj(f); e.target.value = ''; }} />

      {helpOpen && <QuickHelp onClose={() => setHelpOpen(false)} />}
      {tourOpen && <Tour onClose={closeTour} onTool={changeToolMode} onView={setViewMode} />}
      <TopBar
        projectName={modelName}
        onOpen={() => modelFileInput.current?.click()}
        viewMode={viewMode} onViewMode={setViewMode}
        canUndo={history.length > 0} onUndo={handleUndo} canRedo={future.length > 0} onRedo={handleRedo}
        theme={theme} onToggleTheme={toggleTheme}
        onSite={() => setSiteDialog(true)} hasSite={!!site}
        helpOpen={helpOpen} onHelp={() => setHelpOpen((o) => !o)}
        tourOpen={tourOpen} onTour={() => { setHelpOpen(false); (tourOpen ? closeTour() : setTourOpen(true)); }}
        inspectorOpen={inspectorOpen} onToggleInspector={() => setInspectorOpen((o) => !o)}
        canExport={tentData.points.length > 0}
        onExportDXF={handleExportDXF} onExportOBJ={handleExportOBJ} onExportPDF={handleExportPDF}
      />

      <div className="flex-1 flex min-h-0">
        <ToolRail tool={toolMode} onTool={changeToolMode} onAddObj={() => objFileInput.current?.click()}
          onCornerPoles={() => setPolesOpen((o) => !o)} polesOpen={polesOpen}
          onFurniture={() => setFurnitureOpen((o) => !o)} furnitureOpen={furnitureOpen}
          onMap={() => setMapOpen((o) => !o)} mapOpen={mapOpen}
          onSun={() => setSunOpen((o) => !o)} sunOpen={sunOpen} onTurntable={toggleTurntable} turntableOpen={!!turntable} onLibrary={() => setLibraryOpen((o) => !o)} libraryOpen={libraryOpen} />

        <main
          className="flex-1 relative min-w-0 bg-bg"
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(LIB_MIME)) return;
            e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
            const { clientX, clientY } = e;
            cancelAnimationFrame(swapRaf.current);
            swapRaf.current = requestAnimationFrame(() => {
              const h = modelHitRef.current?.(clientX, clientY);
              const sz = libDrag.ids[0] ? library.sizes[libDrag.ids[0]] : null;
              if (!h) { setSwapPreview((p) => (p ? null : p)); return; }
              const old = externalModels.find((m) => m.id === h.id);
              const size = sz ? new Vector3(sz[0], sz[1], sz[2]) : h.size;
              const center = h.center.clone(); center.y = h.center.y - h.size.y / 2 + size.y / 2;
              setSwapPreview((p) => (p && p.id === h.id && p.size.equals(size) ? p : { id: h.id, center, size, rot: old ? old.rotation.clone() : new Vector3() }));
            });
          }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { cancelAnimationFrame(swapRaf.current); setSwapPreview(null); } }}
          onDrop={(e) => {
            const raw = e.dataTransfer.getData(LIB_MIME);
            if (!raw) return;
            e.preventDefault();
            cancelAnimationFrame(swapRaf.current);
            const { clientX, clientY } = e;
            try {
              const ids = JSON.parse(raw) as string[];
              const h = modelHitRef.current?.(clientX, clientY);
              if (h) {
                swapWithLibraryObject(h.id, ids[0]).then(() => { if (ids.length > 1) addLibraryObjects(ids.slice(1), clientX, clientY); });
              } else addLibraryObjects(ids, clientX, clientY);
            } catch { /* bad payload */ }
            libDrag.ids = [];
            setSwapPreview(null);
          }}
        >
          <ModelBoundary resetKey={modelUrl} onError={handleModelError}>
            <Viewer3D
              modelUrl={modelUrl}
              modelKind={modelKind}
              onModelLoaded={() => setLoading(false)}
              onCloseLoop={handleCloseLoop}
              ghostPoles={previewCorners && corners.length ? corners : null}
              externalModels={externalModels}
              setExternalModels={setExternalModels}
              viewMode={viewMode}
              toolMode={toolMode}
              tentData={tentData}
              setTentData={updateTentData}
              layers={layers}
              onCanvasCreated={handleCanvasCreated}
              currentPoleHeight={poleHeight} currentPoleStyle={poleStyle}
              selections={selections}
              onSelectionChange={setSelections}
              measureState={measureState}
              onMeasurePoint={handleMeasurePoint}
              turntable={turntable} groundPickRef={groundPickRef} modelHitRef={modelHitRef} swapPreview={swapPreview}
              onTurntableOrigin={(origin, base, elev) => setTurntable({ origin, base, elev, zoom: 1, picking: false, playing: true })}
              onDeleteMeasure={(i) => { deleteMeasurements([i]); setSelections([]); }}
              tentColor={tentColor}
              theme={theme}
              fabricPanels={materialReport.panels}
              transformSubMode={transformSubMode}
              site={site}
              siteColors={siteColors}
              siteAlign={siteAlign} alignMode={alignMode} onSiteAlign={setSiteAlign} probeRef={probeRef} scanY={scanY} groundY={groundY}
              onShapeMenu={(index, x, y) => setShapeMenu({ index, x, y })}
              onShapePick={(i) => { if (polesOpen && i !== activeShape) handleSelectShape(i); }}
              pickingEdge={pickingEdge} onPickEdge={(i) => { updateTentData({ ...tentData, panelEdge: i }); setPickingEdge(false); toast(`Panels now run along edge ${i + 1}.`); }}
              hiddenBuildings={buildingMode === 'none' ? 'all' : buildingMode === 'clear' && !showHidden ? overlap : null}
              onModelBounds={(c) => setModelBounds({ x: c.x, z: c.z })}
              sun={sun.on ? { pos: sunPos, north: site ? 0 : sun.north } : null}
              snap={snap}
            />
          </ModelBoundary>

          {pickingEdge && tentData.isClosed && (
            <div className="absolute top-3 left-3 right-[236px] mx-auto w-fit max-w-full z-30 flex items-center gap-3 rounded-lg border border-accent bg-panel/95 px-3 py-2 shadow-lg animate-rise">
              <span className="text-sm text-ink">Click an edge to set the <b>panelling direction</b>. Panels will run parallel to it.</span>
              <button className="h-7 px-2.5 rounded-md text-xs text-muted hover:text-ink hover:bg-hover" onClick={() => setPickingEdge(false)}>Skip (auto)</button>
            </div>
          )}
          <div className="absolute top-3 right-3 bottom-3 z-20 flex flex-col items-end gap-2 overflow-y-auto overflow-x-hidden [&>*]:shrink-0 pointer-events-none [&>*]:pointer-events-auto" style={{ scrollbarWidth: 'thin' }}>
          <LayersSection
            layers={layers}
            onToggle={(k) => setLayers((p) => ({ ...p, [k]: !p[k] }))}
            counts={{
              sketch: tentData.points.length, poles: tentData.poles.length,
              furniture: tentData.furniture.length, imports: externalModels.length, site: site ? site.buildings.length : 0,
            }}
            onClear={handleClearLayer}
          />
            {libraryOpen && (
              <LibraryPanel
                supported={library.supported} status={library.status} folder={library.folder} items={library.items} thumbs={library.thumbs}
                onChoose={library.chooseFolder} onReconnect={library.reconnect} onRefresh={library.refresh}
                onAdd={(ids) => addLibraryObjects(ids)} onClose={() => setLibraryOpen(false)}
              />
            )}
            {viewMode === 'depth' && !depthHidden && (
              <PanelCard title="Depth view" icon={<ScanFace size={13} />} onClose={() => setDepthHidden(true)}>
                <DepthSection settings={depth} onChange={setDepth} tracking={tracking} preview={showCamera} onPreview={setShowCamera} />
              </PanelCard>
            )}
            {selectedModelIds.length > 0 && !coloursHidden && (
              <PanelCard title="Colours" icon={<Palette size={13} />} onClose={() => setColoursHidden(true)}>
      <PaletteSection
                    palette={palette} custom={customColours}
                    onAdd={(c) => { const v = c.toLowerCase(); if (!palette.includes(v)) setCustomColours((p) => [...p, v]); paintSelected(v); }}
                    onRemove={(c) => setCustomColours((p) => p.filter((x) => x !== c))}
                    onReset={() => setCustomColours(STARTER_COLOURS)}
                    targetCount={selectedModelIds.length}
                    activeColor={externalModels.find((m) => m.id === selectedModelIds[0])?.color}
                    onPick={paintSelected}
                    />
              </PanelCard>
            )}
            {selectedModelIds.length > 0 && (
              <TransformPanel
                target={transformTarget} subMode={transformSubMode} onSubMode={setTransformSubMode}
                snap={snap} onSnap={setSnap} onDelete={handleDeleteSelections} onDropToGround={handleDropToGround}
              />
            )}
            {turntable && (
              <TurntablePanel t={turntable} onChange={setTurntable} onPick={() => setTurntable({ picking: true, playing: false })} onClose={() => setTurntableState(null)} />
            )}
            {sunOpen && (
          <SunPanel
                sun={sun} onChange={setSun}
                altitudeDeg={(sunPos.altitude * 180) / Math.PI} azimuthDeg={((sunPos.azimuth * 180) / Math.PI + 360) % 360}
                rise={sunDay.rise} set={sunDay.set}
                where={site ? `Sun for ${site.name}` : 'No site picked, using Utrecht, NL'}
                northLocked={!!site} playing={sunPlaying} onPlay={setSunPlaying}
                onClose={() => setSunOpen(false)}
              />
            )}
            {mapOpen && (
          <SitePanel
                site={site} onOpen={() => setSiteDialog(true)} onRemove={() => { setSite(null); toast('Site removed.'); }}
                colors={siteColors} preset={siteStyle.preset}
                align={siteAlign} onAlign={setSiteAlign}
                alignMode={alignMode}
                onAlignMode={(m) => { setAlignMode(m); if (m && viewMode !== 'top') setViewMode('top'); }}
                onAuto={() => setAutoAlignOpen(true)}
                scanY={scanY} onScanY={setScanY} lift={floorLift} onLift={setFloorLift}
                onDrop={() => { if (dropScanFloor()) toast('Scan floor dropped to the map.'); }}
                buildingMode={buildingMode} onBuildingMode={setBuildingMode}
                showHidden={showHidden} onShowHidden={setShowHidden} hiddenCount={overlap?.size ?? 0}
                canCentre={!!modelBounds} onCentre={() => modelBounds && setSiteAlign((a) => ({ ...a, x: -modelBounds.x, z: -modelBounds.z }))}
                onPreset={(id) => setSiteStyle({ preset: id, custom: {} })}
                onColor={(k, c) => setSiteStyle((s) => ({ ...s, custom: { ...s.custom, [k]: c } }))}
                onClose={() => setMapOpen(false)}
              />
            )}
            {furnitureOpen && (
              <LayoutPanel
                prompt={layoutPrompt} onPrompt={setLayoutPrompt} onGenerate={handleGenerateLayout}
                disabled={tentData.points.length < 3} reason={layoutReason}
                onClose={() => setFurnitureOpen(false)}
              />
            )}
            {polesOpen && (
              <PolesPanel
                offset={poleOffset} onOffset={setPoleOffset}
                height={poleHeight} onHeight={setPoleHeight} poleStyle={poleStyle} onPoleStyle={setPoleStyle}
                shapeCount={shapeCount} activeShape={activeShape} onShape={handleSelectShape}
                closed={tentData.isClosed} cornerCount={corners.length}
                onAdd={() => { handleAddCornerPoles(); setPolesOpen(false); setPreviewCorners(false); }}
                onPreview={setPreviewCorners}
                onClose={() => { setPolesOpen(false); setPreviewCorners(false); }}
              />
            )}
          </div>
          {shapeMenu && (
            <div
              className="fixed z-50 min-w-[190px] rounded-lg border border-line bg-panel shadow-xl p-1 animate-rise"
              style={{ left: Math.min(shapeMenu.x, innerWidth - 200), top: Math.min(shapeMenu.y, innerHeight - 170) }}
              onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}
            >
              <div className="px-2.5 py-1 text-2xs uppercase tracking-wide text-faint">Shape {shapeMenu.index + 1}</div>
              {([
                ['Change panel direction', () => editShapeDirection(shapeMenu.index)],
                ['Redraw shape', () => redrawShape(shapeMenu.index)],
                ['Delete shape', () => deleteShapeAt(shapeMenu.index)],
              ] as const).map(([label, fn]) => (
                <button key={label} onClick={() => { setShapeMenu(null); fn(); }}
                  className={'w-full text-left h-7 px-2.5 rounded-md text-sm hover:bg-hover ' + (label === 'Delete shape' ? 'text-danger' : 'text-ink')}>
                  {label}
                </button>
              ))}
            </div>
          )}
          {sketchBarOpen && <VariantBar
            variants={variants} activeId={activeVariant}
            onSwitch={switchVariant} onAdd={() => addVariant(false)} onDuplicate={() => addVariant(true)}
            onRename={(id, name) => setVariants((vs) => vs.map((v) => (v.id === id ? { ...v, name } : v)))}
            onDelete={deleteVariant}
            shapeCount={shapeCount} activeShape={activeShape}
            onShape={handleSelectShape} onAddShape={handleAddShape} onDeleteShape={handleDeleteShape}
            onFinish={handleFinishOption} canFinish={tentData.points.length > 0}
          />}

          <ContextBar
            tool={toolMode === 'transform' && selectedModelIds.length > 0 ? 'view' : toolMode}
            poleHeight={poleHeight} onPoleHeight={setPoleHeight} poleStyle={poleStyle} onPoleStyle={setPoleStyle}
            canClose={toolMode === 'draw' && tentData.points.length > 2 && !tentData.isClosed}
            onClose={handleCloseLoop}
            tentColor={tentColor} onTentColor={setTentColor}
            subMode={transformSubMode} onSubMode={setTransformSubMode}
            snap={snap} onSnap={setSnap}
            target={transformTarget}
            measureDistance={measureState.distance}
            measureCount={measureState.done.length}
            measurePending={measureState.points.length === 1}
            onClearMeasures={clearMeasurements}
          />

          {!hasContent && !loading && (
            <EmptyState
              onOpen={() => modelFileInput.current?.click()}
              onSketch={() => changeToolMode('draw')}
            />
          )}

          {loading && (
            <div className="absolute inset-0 z-30 grid place-items-center bg-bg/70 pointer-events-none">
              <div className="flex items-center gap-2.5 text-sm text-muted">
                <Loader2 size={16} className="animate-spin text-accent" /> Loading model…
              </div>
            </div>
          )}

          {dragging && <DropOverlay />}
          <Toasts toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
        </main>

        {inspectorOpen && <Inspector onClearAll={handleClearSketch} canClear={tentData.points.length + tentData.poles.length + tentData.furniture.length > 0}>
          {variants.length > 1 && <OptionsSection options={optionStats} activeId={activeVariant} onSwitch={switchVariant} />}
          {selections.some((s) => s.type !== 'model') && (
            <SelectionSection
              selections={selections} tentData={tentData}
              onPoleHeight={handleSelectedPoleHeight} onPoleYaw={handleSelectedPoleYaw} onPoleFaceOut={handleSelectedPoleFaceOut} onPoleStyle={handleSelectedPoleStyle} guyLines={layers.guyLines} onToggleGuyLines={() => setLayers((p) => ({ ...p, guyLines: !p.guyLines }))} onDelete={handleDeleteSelections} onDropToGround={handleDropToGround}
            />
          )}
          {shapeStats.length > 0 && <TakeoffSection tentData={tentData} report={materialReport} shapes={shapeStats} onPickEdge={editShapeDirection} />}
        </Inspector>}
      </div>

      <StatusBar tool={toolMode} viewMode={viewMode} tracking={tracking} hint={tool.hint} />
    </div>
  );
};

export default App;
