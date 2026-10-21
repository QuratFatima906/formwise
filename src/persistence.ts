import type { BuildingElement, BuildingModel, Storey } from './domain/model';

/** Projects persist to this browser's localStorage only — no backend yet. */
export const STORAGE_KEY = 'formwise.project.sample-house.v1';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isVec3 = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(isNum);

function isElement(e: unknown): e is BuildingElement {
  if (typeof e !== 'object' || e === null) return false;
  const x = e as Record<string, unknown>;
  if (!isStr(x.id) || !isStr(x.storeyId) || !isStr(x.name) || !isNum(x.uValue)) return false;
  switch (x.type) {
    case 'wall': return isVec3(x.start) && isVec3(x.end) && isNum(x.height) && isNum(x.thickness);
    case 'opening': return isStr(x.hostWallId) && (x.openingType === 'window' || x.openingType === 'door') && [x.offset, x.sillHeight, x.width, x.height].every(isNum);
    case 'roof': return ['S', 'E', 'N', 'W'].includes(x.face as string) && isNum(x.thickness) && isNum(x.pitch);
    case 'slab': return isNum(x.thickness);
    default: return false;
  }
}

/** Returns the model if `data` has the exact shape of a BuildingModel, else null. */
export function parseModel(data: unknown): BuildingModel | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (!isStr(d.name) || !Array.isArray(d.storeys) || typeof d.elements !== 'object' || d.elements === null) return null;
  const storeysOk = d.storeys.every((s: unknown) => {
    const x = s as Record<string, unknown>;
    return typeof s === 'object' && s !== null && isStr(x.id) && isStr(x.name) && isNum(x.elevation);
  });
  if (!storeysOk || !d.storeys.length) return null;
  const entries = Object.entries(d.elements as Record<string, unknown>);
  if (!entries.every(([k, e]) => isElement(e) && e.id === k)) return null;
  return { name: d.name, storeys: d.storeys as Storey[], elements: Object.fromEntries(entries) as Record<string, BuildingElement> };
}

export type LoadResult = { status: 'none' } | { status: 'loaded'; model: BuildingModel } | { status: 'corrupt' | 'unavailable'; reason: string };

export function loadProject(): LoadResult {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    return { status: 'unavailable', reason: (e as Error).message };
  }
  if (raw === null) return { status: 'none' };
  try {
    const model = parseModel(JSON.parse(raw));
    return model ? { status: 'loaded', model } : { status: 'corrupt', reason: 'Saved data does not match the project format.' };
  } catch {
    return { status: 'corrupt', reason: 'Saved data is not valid JSON.' };
  }
}

/** Throws if storage is unavailable or full; the caller reports it. */
export function saveProject(model: BuildingModel) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
}
