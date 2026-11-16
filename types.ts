import { Vector3 } from 'three';

export type ViewMode = 'orbit' | 'top' | 'front' | 'right' | 'depth';
export type ModelKind = 'gltf' | 'obj' | 'stl' | 'ply' | 'fbx';
export type ToolMode = 'view' | 'draw' | 'pole' | 'transform' | 'measure' | 'box-select';

export type PoleStyle = 'wood' | 'steel';

export interface TentPole {
  position: Vector3;
  height: number;
  style?: PoleStyle;
  yaw?: number;
  guy?: boolean; // wooden poles: false hides this pole's guy line; // radians about +Y: the way the pole leans (steel) / its guy line runs (wood)
}

export interface FurnitureItem {
  id: string;
  name: string;
  type: 'box' | 'cylinder';
  width: number;
  depth: number;
  height: number;
  position: Vector3;
  rotation: number; // Y-axis rotation in radians
}

export interface ExternalModel {
  id: string;
  url: string;
  name: string;
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
  dropNonce?: number; // bump to make the model fall to the ground plane
  color?: string; // palette colour; undefined keeps the OBJ's own look
}

export interface FabricPanel {
  id: number;
  position: Vector3; // Center point
  width: number;
  length: number;
  rotation: number; // Y rotation
}

export interface MaterialReport {
  totalArea: number; // Raw material area
  wasteArea: number; // Material - Floor Area
  panelCount: number;
  panels: FabricPanel[];
}

export interface TentData {
  points: Vector3[];
  poles: TentPole[];
  furniture: FurnitureItem[];
  area: number;
  isClosed: boolean;
  /** Other outlines in this option. points/isClosed above is the shape being edited. */
  shapes?: Array<{ points: Vector3[]; isClosed: boolean; panelEdge?: number }>;
  /** Position of the edited shape among all shapes (others live in `shapes`, in order). */
  activeShape?: number;
  /** Which edge of the edited shape (points[i] to points[i+1]) the fabric panels run parallel to. */
  panelEdge?: number;
}

export interface LayerState {
  model: boolean;
  sketch: boolean;
  grid: boolean;
  poles: boolean;
  measurements: boolean;
  furniture: boolean;
  imports: boolean;
  fabric: boolean; // New layer for fabric visualization
  guyLines: boolean; // guy lines of wooden poles
  site: boolean; // OpenStreetMap context around the picked location
}

export interface GroundingFile {
  name: string;
  url: string;
  type: 'model' | 'other';
}

/** Turntable camera: orbits a chosen point at a steady speed. */
export interface TurntableState {
  picking: boolean;          // waiting for the user to click the centre
  origin: Vector3 | null;
  base: number;              // camera distance when the centre was picked
  zoom: number;              // distance multiplier on base
  elev: number;              // camera tilt above the horizon, degrees
  speed: number;             // degrees per second
  reverse: boolean;
  playing: boolean;
}

export interface MeasurementState {
  points: Vector3[];            // the measurement in progress (0 or 1 point)
  distance: number | null;      // most recent finished measurement
  done: Array<[Vector3, Vector3]>;
}

export interface SelectionItem {
  type: 'pole' | 'furniture' | 'model' | 'tent' | 'measure';
  id: string | number;
}