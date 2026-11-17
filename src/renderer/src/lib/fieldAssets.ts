/**
 * Field pictures and AprilTag maps. The 2024-2026 fields ship inside the app
 * (WPILib's field images and tag layouts, see THIRD_PARTY_NOTICES.md) so the
 * 2D field works offline. A picture comes with the pixel positions of the
 * playable area's corners, which is what lines robot poses up with it. Teams
 * can also load their own picture in the same format (WPILib / PathWeaver
 * field JSON next to its image).
 */
import manifest from '../assets/fields/fields.json';
import img2024 from '../assets/fields/2024.webp';
import img2025 from '../assets/fields/2025.webp';
import img2026 from '../assets/fields/2026.webp';
import tags2024 from '../assets/fields/tags-2024-default.json';
import tags2025w from '../assets/fields/tags-2025-welded.json';
import tags2025a from '../assets/fields/tags-2025-andymark.json';
import tags2026w from '../assets/fields/tags-2026-welded.json';
import tags2026a from '../assets/fields/tags-2026-andymark.json';
import { parseFieldJson, type AprilTag } from '@core/field';

export interface FieldPicture {
  url: string;
  /** Pixel positions, in the image, of the playable area's top-left and bottom-right corners. */
  topLeft: [number, number];
  bottomRight: [number, number];
  /** Playable area in meters: [length, width]. */
  fieldSize: [number, number];
  game: string;
}

interface ManifestEntry {
  game: string;
  topLeft: number[];
  bottomRight: number[];
  fieldSize: number[];
}

const URLS: Record<string, string> = { '2024': img2024, '2025': img2025, '2026': img2026 };
const TAGS: Record<string, Partial<Record<'welded' | 'andymark' | 'default', unknown>>> = {
  '2024': { default: tags2024 },
  '2025': { welded: tags2025w, andymark: tags2025a },
  '2026': { welded: tags2026w, andymark: tags2026a },
};

const custom = new Map<string, FieldPicture>();
const listeners = new Set<() => void>();

export function bundledPicture(seasonId: string): FieldPicture | undefined {
  const m = (manifest as Record<string, ManifestEntry>)[seasonId];
  if (!m || !URLS[seasonId]) return undefined;
  return {
    url: URLS[seasonId],
    topLeft: [m.topLeft[0], m.topLeft[1]],
    bottomRight: [m.bottomRight[0], m.bottomRight[1]],
    fieldSize: [m.fieldSize[0], m.fieldSize[1]],
    game: m.game,
  };
}

export function fieldPicture(seasonId: string): FieldPicture | undefined {
  return custom.get(seasonId) ?? bundledPicture(seasonId);
}

/** Seasons with two tag maps (the welded and AndyMark fields differ slightly). */
export function hasTagVariants(seasonId: string): boolean {
  return !!TAGS[seasonId]?.welded && !!TAGS[seasonId]?.andymark;
}

const tagCache = new Map<string, AprilTag[]>();
export function bundledTags(seasonId: string, variant: 'welded' | 'andymark'): AprilTag[] {
  const k = `${seasonId}:${variant}`;
  let t = tagCache.get(k);
  if (!t) {
    const src = TAGS[seasonId];
    const json = src ? (src[variant] ?? src.default ?? src.welded) : undefined;
    t = json ? parseFieldJson(json).tags : [];
    tagCache.set(k, t);
  }
  return t;
}

// ---------------------------------------------------------------------------
// Decoded images for the canvases

const images = new Map<string, HTMLImageElement | 'loading' | 'failed'>();

/** The decoded picture, or null while it loads (subscribers are told when it is ready). */
export function pictureImage(url: string): HTMLImageElement | null {
  const cur = images.get(url);
  if (cur instanceof HTMLImageElement) return cur;
  if (cur) return null;
  images.set(url, 'loading');
  const img = new Image();
  img.onload = () => {
    images.set(url, img);
    for (const l of listeners) l();
  };
  img.onerror = () => images.set(url, 'failed');
  img.src = url;
  return null;
}

export function onFieldAssets(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// ---------------------------------------------------------------------------
// Custom fields (WPILib / PathWeaver field JSON + image)

const UNIT_M: Record<string, number> = {
  meter: 1,
  meters: 1,
  metre: 1,
  metres: 1,
  m: 1,
  cm: 0.01,
  centimeter: 0.01,
  centimeters: 0.01,
  mm: 0.001,
  millimeter: 0.001,
  millimeters: 0.001,
  inch: 0.0254,
  inches: 0.0254,
  in: 0.0254,
  foot: 0.3048,
  feet: 0.3048,
  ft: 0.3048,
  yard: 0.9144,
  yards: 0.9144,
  yd: 0.9144,
};

export interface CustomFieldMeta {
  id: string;
  name: string;
  length: number;
  width: number;
}

/** Read a field JSON; throws with a readable reason when it is not one. */
export function parseFieldImageJson(text: string): {
  game: string;
  image: string;
  topLeft: [number, number];
  bottomRight: [number, number];
  fieldSize: [number, number];
} {
  const j = JSON.parse(text) as Record<string, unknown>;
  const corners = j['field-corners'] as { 'top-left'?: number[]; 'bottom-right'?: number[] } | undefined;
  const size = j['field-size'] as number[] | undefined;
  const unit = String(j['field-unit'] ?? 'meter').toLowerCase();
  const k = UNIT_M[unit];
  if (typeof j['field-image'] !== 'string') throw new Error('it has no "field-image" entry');
  if (!corners?.['top-left'] || !corners['bottom-right'] || corners['top-left'].length < 2 || corners['bottom-right'].length < 2)
    throw new Error('it has no "field-corners"');
  if (!size || size.length < 2 || !(size[0] > 0) || !(size[1] > 0)) throw new Error('it has no "field-size"');
  if (!k) throw new Error(`the unit “${unit}” is not one of meter, cm, mm, inch, foot, yard`);
  return {
    game: typeof j.game === 'string' && j.game ? j.game : 'Custom field',
    image: j['field-image'],
    topLeft: [corners['top-left'][0], corners['top-left'][1]],
    bottomRight: [corners['bottom-right'][0], corners['bottom-right'][1]],
    fieldSize: [size[0] * k, size[1] * k],
  };
}

/** Register a custom field picture (bytes come from the main process). Returns what the season list needs. */
export function addCustomField(id: string, jsonText: string, image: ArrayBuffer, mime: string): CustomFieldMeta {
  const j = parseFieldImageJson(jsonText);
  const old = custom.get(id);
  if (old) URL.revokeObjectURL(old.url);
  const url = URL.createObjectURL(new Blob([image], { type: mime }));
  custom.set(id, { url, topLeft: j.topLeft, bottomRight: j.bottomRight, fieldSize: j.fieldSize, game: j.game });
  for (const l of listeners) l();
  return { id, name: j.game, length: j.fieldSize[0], width: j.fieldSize[1] };
}

export function removeCustomField(id: string): void {
  const old = custom.get(id);
  if (old) URL.revokeObjectURL(old.url);
  custom.delete(id);
  for (const l of listeners) l();
}

/** Lets a canvas redraw when a picture finishes loading (shaped like a store for useCanvas). */
export const fieldAssetTicker = {
  get: () => ({}),
  set: () => undefined,
  subscribe: (l: (s: object) => void) => onFieldAssets(() => l({})),
};
