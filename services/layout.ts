import { FurnitureItem } from '../types';
import { Vector3 } from 'three';

// ---------------------------------------------------------------------------
// LOCAL LAYOUT ENGINE — no API keys required
// Parses natural-language prompts and places furniture within the tent bounds.
// ---------------------------------------------------------------------------

interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface ParsedItem {
  name: string;
  type: 'box' | 'cylinder';
  width: number;
  depth: number;
  height: number;
  count: number;
}

// ---- Number word → digit mapping ----
const WORD_TO_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  a: 1, an: 1,
};

function parseNumber(token: string): number | null {
  const n = parseInt(token, 10);
  if (!isNaN(n)) return n;
  return WORD_TO_NUM[token.toLowerCase()] ?? null;
}

// ---- Keyword tables ----
const CYLINDER_KEYWORDS = [
  'round', 'circular', 'circle', 'cylinder', 'cylindrical',
  'drum', 'barrel', 'column', 'pillar',
];

const ITEM_PRESETS: Record<string, Omit<ParsedItem, 'count'>> = {
  // Seating / Tables
  'chair':           { name: 'Chair',            type: 'box',      width: 0.5,  depth: 0.5,  height: 0.9 },
  'stool':           { name: 'Stool',             type: 'cylinder', width: 0.4,  depth: 0.4,  height: 0.75 },
  'barstool':        { name: 'Bar Stool',         type: 'cylinder', width: 0.4,  depth: 0.4,  height: 1.0 },
  'sofa':            { name: 'Sofa',              type: 'box',      width: 2.0,  depth: 0.9,  height: 0.85 },
  'couch':           { name: 'Sofa',              type: 'box',      width: 2.0,  depth: 0.9,  height: 0.85 },
  'bench':           { name: 'Bench',             type: 'box',      width: 1.8,  depth: 0.5,  height: 0.45 },
  'armchair':        { name: 'Armchair',          type: 'box',      width: 0.8,  depth: 0.8,  height: 1.0 },
  // Tables
  'table':           { name: 'Table',             type: 'box',      width: 1.2,  depth: 0.8,  height: 0.75 },
  'desk':            { name: 'Desk',              type: 'box',      width: 1.4,  depth: 0.7,  height: 0.75 },
  'roundtable':      { name: 'Round Table',       type: 'cylinder', width: 1.0,  depth: 1.0,  height: 0.75 },
  'coffeetable':     { name: 'Coffee Table',      type: 'box',      width: 1.0,  depth: 0.6,  height: 0.45 },
  'diningtable':     { name: 'Dining Table',      type: 'box',      width: 2.0,  depth: 1.0,  height: 0.75 },
  'foldingtable':    { name: 'Folding Table',     type: 'box',      width: 1.8,  depth: 0.75, height: 0.75 },
  'trestle':         { name: 'Trestle Table',     type: 'box',      width: 1.8,  depth: 0.75, height: 0.75 },
  // Shelving / Storage
  'shelf':           { name: 'Shelf',             type: 'box',      width: 1.0,  depth: 0.4,  height: 1.8 },
  'shelving':        { name: 'Shelving Unit',     type: 'box',      width: 1.0,  depth: 0.4,  height: 1.8 },
  'cabinet':         { name: 'Cabinet',           type: 'box',      width: 0.9,  depth: 0.5,  height: 1.8 },
  'wardrobe':        { name: 'Wardrobe',          type: 'box',      width: 1.2,  depth: 0.6,  height: 2.0 },
  'rack':            { name: 'Rack',              type: 'box',      width: 1.0,  depth: 0.5,  height: 1.8 },
  // Event / Exhibition
  'booth':           { name: 'Booth',             type: 'box',      width: 2.0,  depth: 1.0,  height: 2.0 },
  'stand':           { name: 'Display Stand',     type: 'box',      width: 1.0,  depth: 1.0,  height: 1.0 },
  'display':         { name: 'Display',           type: 'box',      width: 1.0,  depth: 0.5,  height: 2.0 },
  'counter':         { name: 'Counter',           type: 'box',      width: 2.0,  depth: 0.6,  height: 1.0 },
  'bar':             { name: 'Bar',               type: 'box',      width: 3.0,  depth: 0.6,  height: 1.1 },
  'podium':          { name: 'Podium',            type: 'box',      width: 0.6,  depth: 0.5,  height: 1.2 },
  'lectern':         { name: 'Lectern',           type: 'box',      width: 0.6,  depth: 0.5,  height: 1.2 },
  'stage':           { name: 'Stage',             type: 'box',      width: 4.0,  depth: 2.0,  height: 0.5 },
  // Kitchen / Catering
  'fridge':          { name: 'Fridge',            type: 'box',      width: 0.7,  depth: 0.7,  height: 1.8 },
  'refrigerator':    { name: 'Fridge',            type: 'box',      width: 0.7,  depth: 0.7,  height: 1.8 },
  'oven':            { name: 'Oven',              type: 'box',      width: 0.6,  depth: 0.6,  height: 0.9 },
  'cooler':          { name: 'Cooler',            type: 'box',      width: 0.9,  depth: 0.5,  height: 0.6 },
  'sink':            { name: 'Sink',              type: 'box',      width: 0.6,  depth: 0.5,  height: 0.9 },
  // Misc
  'plant':           { name: 'Plant',             type: 'cylinder', width: 0.5,  depth: 0.5,  height: 1.0 },
  'pot':             { name: 'Plant Pot',         type: 'cylinder', width: 0.4,  depth: 0.4,  height: 0.6 },
  'bin':             { name: 'Bin',               type: 'cylinder', width: 0.4,  depth: 0.4,  height: 0.7 },
  'trash':           { name: 'Bin',               type: 'cylinder', width: 0.4,  depth: 0.4,  height: 0.7 },
  'box':             { name: 'Box',               type: 'box',      width: 0.6,  depth: 0.6,  height: 0.6 },
  'crate':           { name: 'Crate',             type: 'box',      width: 0.6,  depth: 0.6,  height: 0.5 },
  'pallet':          { name: 'Pallet',            type: 'box',      width: 1.2,  depth: 0.8,  height: 0.15 },
  'screen':          { name: 'Screen',            type: 'box',      width: 1.5,  depth: 0.1,  height: 1.0 },
  'monitor':         { name: 'Monitor',           type: 'box',      width: 0.6,  depth: 0.1,  height: 0.4 },
  'speaker':         { name: 'Speaker',           type: 'box',      width: 0.3,  depth: 0.3,  height: 0.6 },
  'generator':       { name: 'Generator',         type: 'box',      width: 1.2,  depth: 0.7,  height: 0.8 },
};

// Extract an inline dimension like (1m), (2x1m), (1.5m x 0.5m)
function extractDimensions(tokens: string[], startIdx: number): { width?: number; depth?: number; consumed: number } {
  // Look ahead up to 6 tokens for a parenthesised or bare dimension pattern
  const slice = tokens.slice(startIdx, startIdx + 8).join(' ');
  
  // Pattern: (WxD) or (W x D) — either 1m or 1.5
  const twoD = slice.match(/\(?\s*(\d+(?:\.\d+)?)\s*(?:m|meters?)?\s*[xX×]\s*(\d+(?:\.\d+)?)\s*(?:m|meters?)?\s*\)?/);
  if (twoD) {
    const raw = twoD[0];
    const consumed = raw.split(' ').filter(Boolean).length;
    return { width: parseFloat(twoD[1]), depth: parseFloat(twoD[2]), consumed };
  }
  
  // Pattern: (W) — single dimension (square / diameter)
  const oneD = slice.match(/\(?\s*(\d+(?:\.\d+)?)\s*(?:m|meters?)?\s*\)?/);
  if (oneD) {
    const raw = oneD[0];
    const consumed = raw.split(' ').filter(Boolean).length;
    return { width: parseFloat(oneD[1]), depth: parseFloat(oneD[1]), consumed };
  }
  
  return { consumed: 0 };
}

// ---- Main parser ----
export function parsePrompt(prompt: string): ParsedItem[] {
  const results: ParsedItem[] = [];
  // Normalise text: lowercase, remove punctuation except x and .
  const clean = prompt.toLowerCase().replace(/[,;:!?'"]/g, ' ');
  const tokens = clean.split(/\s+/).filter(Boolean);
  
  let i = 0;
  while (i < tokens.length) {
    // Try to find a count
    const count = parseNumber(tokens[i]);
    
    if (count !== null) {
      i++; // consume count token
      
      // Optional adjective tokens (round, rectangular, small, large…)
      let forceCylinder = false;
      let forceBox = false;
      let customWidth: number | undefined;
      let customDepth: number | undefined;
      
      while (i < tokens.length) {
        const tok = tokens[i];
        if (CYLINDER_KEYWORDS.includes(tok)) { forceCylinder = true; i++; continue; }
        if (['rectangular', 'square', 'flat', 'long'].includes(tok)) { forceBox = true; i++; continue; }
        if (['small', 'big', 'large', 'huge', 'tiny', 'medium'].includes(tok)) { i++; continue; }
        // Inline dimensions e.g. (2x1m)
        if (tok.startsWith('(') || /\d/.test(tok)) {
          const dims = extractDimensions(tokens, i);
          if (dims.consumed > 0 && (dims.width || dims.depth)) {
            customWidth = dims.width;
            customDepth = dims.depth;
            i += dims.consumed;
            continue;
          }
        }
        break;
      }
      
      if (i >= tokens.length) break;
      
      // Now find the item keyword
      let matched = false;
      
      // Try two-word compound ("round table", "coffee table", "dining table", "bar stool")
      if (i + 1 < tokens.length) {
        const compound = tokens[i] + tokens[i + 1];
        if (ITEM_PRESETS[compound]) {
          const preset = { ...ITEM_PRESETS[compound] };
          if (forceCylinder) preset.type = 'cylinder';
          if (forceBox)      preset.type = 'box';
          if (customWidth !== undefined) { preset.width = customWidth; if (!customDepth) preset.depth = customWidth; }
          if (customDepth !== undefined) preset.depth = customDepth;
          results.push({ ...preset, count });
          i += 2;
          matched = true;
        }
      }
      
      if (!matched && ITEM_PRESETS[tokens[i]]) {
        const preset = { ...ITEM_PRESETS[tokens[i]] };
        if (forceCylinder) preset.type = 'cylinder';
        if (forceBox)      preset.type = 'box';
        if (customWidth !== undefined) { preset.width = customWidth; if (!customDepth) preset.depth = customWidth; }
        if (customDepth !== undefined) preset.depth = customDepth;
        results.push({ ...preset, count });
        i++;
        matched = true;
      }
      
      if (!matched) {
        // Unknown item — create a generic box labelled with the word
        const name = tokens[i].charAt(0).toUpperCase() + tokens[i].slice(1);
        results.push({
          name,
          type: forceCylinder ? 'cylinder' : 'box',
          width: customWidth ?? 1.0,
          depth: customDepth ?? 1.0,
          height: 0.9,
          count,
        });
        i++;
      }
    } else {
      i++; // skip non-count token
    }
  }
  
  return results;
}

// ---- Placement engine ----
// Tries to place items in a grid-like pattern within the tent bounds,
// with a small margin from the edges. Falls back to random if needed.

function placeItems(items: ParsedItem[], bounds: Bounds): FurnitureItem[] {
  const margin = 0.5; // metres from wall
  const usableW = bounds.maxX - bounds.minX - margin * 2;
  const usableD = bounds.maxZ - bounds.minZ - margin * 2;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;

  const result: FurnitureItem[] = [];
  const padding = 0.3; // gap between items

  // Flatten items into a single list
  const flat: Omit<ParsedItem, 'count'>[] = [];
  for (const item of items) {
    for (let n = 0; n < item.count; n++) {
      flat.push({ name: item.name, type: item.type, width: item.width, depth: item.depth, height: item.height });
    }
  }

  if (flat.length === 0) return result;

  // Simple row-based placement — works left to right, then wraps
  let curX = bounds.minX + margin;
  let curZ = bounds.minZ + margin;
  let rowMaxDepth = 0;

  for (const item of flat) {
    // Wrap to next row if needed
    if (curX + item.width > bounds.maxX - margin) {
      curX = bounds.minX + margin;
      curZ += rowMaxDepth + padding;
      rowMaxDepth = 0;
    }

    if (curZ + item.depth > bounds.maxZ - margin) {
      // Out of space — place randomly within bounds as fallback
      const rx = bounds.minX + margin + Math.random() * Math.max(0, usableW - item.width);
      const rz = bounds.minZ + margin + Math.random() * Math.max(0, usableD - item.depth);
      result.push({
        id: `local-${Date.now()}-${result.length}`,
        name: item.name,
        type: item.type,
        width: item.width,
        depth: item.depth,
        height: item.height,
        position: new Vector3(rx, 0, rz),
        rotation: 0,
      });
      continue;
    }

    result.push({
      id: `local-${Date.now()}-${result.length}`,
      name: item.name,
      type: item.type,
      width: item.width,
      depth: item.depth,
      height: item.height,
      position: new Vector3(curX + item.width / 2, 0, curZ + item.depth / 2),
      rotation: 0,
    });

    curX += item.width + padding;
    rowMaxDepth = Math.max(rowMaxDepth, item.depth + padding);
  }

  return result;
}

// ---- Public API ----

export function generateLayout(
  prompt: string,
  bounds: Bounds
): FurnitureItem[] {
  try {
    const parsed = parsePrompt(prompt);
    if (parsed.length === 0) return [];
    return placeItems(parsed, bounds);
  } catch (err) {
    console.error('Local layout engine error:', err);
    return [];
  }
}
