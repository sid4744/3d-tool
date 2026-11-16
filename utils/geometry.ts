import { Vector3 } from 'three';
import { FabricPanel, MaterialReport } from '../types';

/**
 * Calculates the area of a polygon defined by an array of Vector3 points
 * projected onto the XZ plane (Shoelace formula).
 */
export const calculatePolygonArea = (points: Vector3[]): number => {
  if (points.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].z;
    area -= points[j].x * points[i].z;
  }
  return Math.abs(area / 2);
};

export const formatArea = (area: number): string => {
  return area.toFixed(2);
};

export const getPolygonBounds = (points: Vector3[]) => {
  if (points.length === 0) return { minX: -10, maxX: 10, minZ: -10, maxZ: 10, width: 20, depth: 20 };
  
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  points.forEach(p => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  });
  
  return { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ };
};

/**
 * Raycasting algorithm to check if a point is inside a polygon (XZ plane).
 */
export const isPointInPolygon = (point: Vector3, polygon: Vector3[]): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].z;
    const xj = polygon[j].x, yj = polygon[j].z;
    
    const intersect = ((yi > point.z) !== (yj > point.z))
        && (point.x < (xj - xi) * (point.z - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

/**
 * Calculates fabric usage by slicing the polygon into 1.5m strips (with 25mm overlap).
 * Generates rectangular panels that fully bound the shape within each strip.
 */
export const calculateFabricUsage = (rawPoints: Vector3[], edge?: number): MaterialReport => {
  if (rawPoints.length < 3) return { totalArea: 0, wasteArea: 0, panelCount: 0, panels: [] };

  // Panels run parallel to the chosen reference edge: work in a frame where that edge is the +x axis.
  let ang = 0;
  if (edge !== undefined && edge >= 0 && edge < rawPoints.length - 1) {
    const a = rawPoints[edge], b = rawPoints[edge + 1];
    if (a.distanceTo(b) > 1e-6) ang = Math.atan2(b.z - a.z, b.x - a.x);
  }
  const useEdge = ang !== 0;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const points = useEdge ? rawPoints.map((p) => new Vector3(p.x * ca + p.z * sa, p.y, -p.x * sa + p.z * ca)) : rawPoints;

  const bounds = getPolygonBounds(points);
  const PANEL_WIDTH = 1.5;
  const SEAM_OVERLAP = 0.025;
  const EFFECTIVE_WIDTH = PANEL_WIDTH - SEAM_OVERLAP;

  // Determine Orientation: Run strips along the longest dimension
  // If Width > Depth, strips run along X (stacked along Z)
  // If Depth > Width, strips run along Z (stacked along X)
  const isLandscape = useEdge ? true : bounds.width > bounds.depth;
  
  const panels: FabricPanel[] = [];
  let totalMaterialArea = 0;

  // Helper to find the min and max extents of the polygon within a specific strip range.
  // This creates a bounding box for the slice.
  const getStripBounds = (stripStart: number, stripEnd: number, axis: 'x' | 'z') => {
    let minVal = Infinity;
    let maxVal = -Infinity;
    let found = false;

    // 1. Check vertices that fall inside the strip
    points.forEach(p => {
        const pPos = axis === 'x' ? p.x : p.z; // Position along the stacking axis
        const pVal = axis === 'x' ? p.z : p.x; // Value along the length axis
        
        // Use a small epsilon for inclusion to handle edge cases
        if (pPos >= stripStart && pPos <= stripEnd) {
            if (pVal < minVal) minVal = pVal;
            if (pVal > maxVal) maxVal = pVal;
            found = true;
        }
    });

    // 2. Check intersections with strip boundaries
    const checkIntersection = (pos: number) => {
        for (let i = 0; i < points.length; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % points.length];
            
            const v1 = axis === 'x' ? p1.x : p1.z;
            const v2 = axis === 'x' ? p2.x : p2.z;
            const val1 = axis === 'x' ? p1.z : p1.x;
            const val2 = axis === 'x' ? p2.z : p2.x;

            // Check if edge crosses 'pos'
            // We look for straddling or exact touch
            if (((v1 <= pos && v2 >= pos) || (v2 <= pos && v1 >= pos))) {
                 if (v1 !== v2) {
                     const t = (pos - v1) / (v2 - v1);
                     const intersectVal = val1 + t * (val2 - val1);
                     if (intersectVal < minVal) minVal = intersectVal;
                     if (intersectVal > maxVal) maxVal = intersectVal;
                     found = true;
                 } else if (v1 === pos) {
                     // Edge is exactly on the boundary line
                     if (val1 < minVal) minVal = val1;
                     if (val1 > maxVal) maxVal = val1;
                     if (val2 < minVal) minVal = val2;
                     if (val2 > maxVal) maxVal = val2;
                     found = true;
                 }
            }
        }
    };

    checkIntersection(stripStart);
    checkIntersection(stripEnd);

    if (!found) return null;
    return { min: minVal, max: maxVal };
  };

  if (isLandscape) {
    // Strips run along X, stacked along Z
    // Iterate from minZ to maxZ
    for (let z = bounds.minZ; z < bounds.maxZ; z += EFFECTIVE_WIDTH) {
      const stripStart = z;
      const stripEnd = stripStart + PANEL_WIDTH; // Physical panel width
      
      const range = getStripBounds(stripStart, stripEnd, 'z');
      
      if (range) {
        const length = range.max - range.min;
        const panelArea = length * PANEL_WIDTH;
        totalMaterialArea += panelArea;

        panels.push({
          id: panels.length,
          position: new Vector3((range.min + range.max) / 2, 0.05 + (panels.length * 0.002), (stripStart + stripEnd) / 2),
          width: length, // Visual X dimension
          length: PANEL_WIDTH, // Visual Z dimension
          rotation: 0 
        });
      }
    }
  } else {
    // Strips run along Z, stacked along X
    for (let x = bounds.minX; x < bounds.maxX; x += EFFECTIVE_WIDTH) {
      const stripStart = x;
      const stripEnd = stripStart + PANEL_WIDTH;

      const range = getStripBounds(stripStart, stripEnd, 'x');

      if (range) {
        const length = range.max - range.min;
        const panelArea = length * PANEL_WIDTH;
        totalMaterialArea += panelArea;

        panels.push({
          id: panels.length,
          position: new Vector3((stripStart + stripEnd) / 2, 0.05 + (panels.length * 0.002), (range.min + range.max) / 2),
          width: PANEL_WIDTH,
          length: length,
          rotation: 0
        });
      }
    }
  }

  if (useEdge) {
    // back to world space
    panels.forEach((pn) => {
      const u = pn.position.x, v = pn.position.z;
      pn.position = new Vector3(u * ca - v * sa, pn.position.y, u * sa + v * ca);
      pn.rotation = -ang;
    });
  }

  const floorArea = calculatePolygonArea(points);

  return {
    totalArea: totalMaterialArea,
    wasteArea: Math.max(0, totalMaterialArea - floorArea),
    panelCount: panels.length,
    panels
  };
};