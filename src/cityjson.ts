import type { BuildingElement, BuildingModel, Point2, RoofElement, RoofSide, SlabElement, Vec3, WallElement } from './domain/model';

/**
 * CityJSON 1.1 / 2.0 → Formwise model, for one LOD2 building.
 *
 * Reads the Building and its BuildingPart children, takes the highest LOD ≥ 2
 * with semantic surfaces, and maps WallSurface → profiled walls, RoofSurface →
 * roof polygons, GroundSurface → slab polygons, in local metres (offset kept
 * in `origin`). Ring winding is not mandated by CityJSON, so orientation is
 * decided once for the whole building from the sign of its enclosed volume.
 */

export const DEFAULTS = {
  wall: { thickness: 0.3, uValue: 1.4 },
  roof: { thickness: 0.25, uValue: 0.9 },
  slab: { thickness: 0.25, uValue: 1.1 },
};
const SUPPORTED_VERSIONS = ['1.1', '2.0'];
/** Walls may lean at most this much from vertical (|n_z| ≤ sin 10°). */
const MAX_WALL_TILT = Math.sin((10 * Math.PI) / 180);
const SNAP = 0.01; // m: base vertices within 1 cm of the wall bottom count as on it

export type CityJsonResult = { ok: true; model: BuildingModel; warnings: string[] } | { ok: false; error: string };

class ImportError extends Error {}
function fail(msg: string): never {
  throw new ImportError(msg);
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

interface Surface {
  kind: string | null;
  ring: number[];
  holes: number;
}

export function parseCityJson(d: Obj): CityJsonResult {
  try {
    return { ok: true, ...convert(d) };
  } catch (e) {
    if (e instanceof ImportError) return { ok: false, error: e.message };
    throw e;
  }
}

function convert(d: Obj): { model: BuildingModel; warnings: string[] } {
  if (d.type !== 'CityJSON') fail(`Expected "type": "CityJSON", found ${JSON.stringify(d.type)}.`);
  if (!SUPPORTED_VERSIONS.includes(d.version as string)) fail(`CityJSON version ${JSON.stringify(d.version)} is not supported; use 1.1 or 2.0 (cjio can upgrade older files).`);

  const t = d.transform;
  if (!isObj(t) || !isVec(t.scale) || !isVec(t.translate)) fail('CityJSON "transform" with numeric scale and translate is required.');
  const { scale, translate } = t as { scale: Vec3; translate: Vec3 };
  if (!Array.isArray(d.vertices) || !d.vertices.every(isVec)) fail('"vertices" must be an array of [x, y, z] numbers.');
  const vertices = (d.vertices as Vec3[]).map((v): Vec3 => [v[0] * scale[0] + translate[0], v[1] * scale[1] + translate[1], v[2] * scale[2] + translate[2]]);

  const objects = d.CityObjects;
  if (!isObj(objects)) fail('"CityObjects" must be an object.');
  const cos = objects as Record<string, unknown>;
  const buildings = Object.entries(cos).filter(([, o]) => isObj(o) && o.type === 'Building');
  if (buildings.length === 0) fail('The file contains no Building.');
  if (buildings.length > 1) fail(`The file contains ${buildings.length} buildings; Formwise imports one building per file.`);
  const [buildingId, building] = buildings[0]! as [string, Obj];

  const parts = [building, ...(Array.isArray(building.children) ? building.children : []).map((id) => cos[id as string]).filter((o): o is Obj => isObj(o) && o.type === 'BuildingPart')];
  const geometries = parts.flatMap((p) => (Array.isArray(p.geometry) ? p.geometry : [])).filter(isObj);
  const lods = geometries.filter((g) => isObj(g.semantics)).map((g) => parseFloat(String(g.lod))).filter((n) => Number.isFinite(n));
  const best = Math.max(...lods, -Infinity);
  if (!(best >= 2)) {
    const found = geometries.map((g) => String(g.lod)).filter((x) => x !== 'undefined');
    fail(`LOD2 geometry with semantic surfaces is required${found.length ? ` (found LOD ${[...new Set(found)].join(', ')})` : ''}.`);
  }

  const surfaces = geometries.filter((g) => isObj(g.semantics) && parseFloat(String(g.lod)) === best).flatMap(flatten);
  const used = new Set(surfaces.flatMap((s) => s.ring));
  for (const i of used) if (!vertices[i]) fail(`Vertex index ${i} is out of range.`);
  if (surfaces.some((s) => s.holes > 0)) fail('Surfaces with inner rings (holes) are not supported; Formwise imports LOD2 envelopes without openings.');

  // Local frame: shift so the building starts at x = y = 0 on its lowest point.
  const pts = [...used].map((i) => vertices[i]!);
  const offset: Vec3 = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.min(...pts.map((p) => p[2]))];
  if (Math.abs(offset[0]) <= 180 && Math.abs(offset[1]) <= 90 && Math.max(...pts.map((p) => p[0])) - offset[0] < 0.01) {
    fail('Coordinates look geographic (degrees); a projected CRS in metres is required.');
  }
  const local = (i: number): Vec3 => {
    const p = vertices[i]!;
    return [p[0] - offset[0], p[1] - offset[1], p[2] - offset[2]];
  };
  const rings = surfaces.map((s) => s.ring.map(local));
  const flip = enclosedVolume(rings) < 0 ? -1 : 1;

  const elements: Record<string, BuildingElement> = {};
  const warnings: string[] = [];
  const n = { wall: 0, roof: 0, slab: 0, skipped: 0, other: 0 };
  const id = (prefix: string, k: number) => `${prefix}-${String(k).padStart(2, '0')}`;
  surfaces.forEach((s, k) => {
    const ring = rings[k]!;
    const normal = scaleVec(newell(ring), flip);
    if (s.kind === 'WallSurface') {
      const w = toWall(ring, normal, id('WL', n.wall + 1));
      if (w === 'tilted') fail(`A wall surface leans more than 10° from vertical; Formwise models walls as vertical.`);
      if (!w) return void n.skipped++;
      n.wall++;
      elements[w.id] = w;
    } else if (s.kind === 'RoofSurface') {
      const r = toRoof(ring, normal, id('RF', n.roof + 1));
      if (!r) return void n.skipped++;
      n.roof++;
      elements[r.id] = r;
    } else if (s.kind === 'GroundSurface') {
      if (!(Math.hypot(normal[0], normal[1], normal[2]) > 0)) return void n.skipped++;
      n.slab++;
      const sid = id('SL', n.slab);
      elements[sid] = { id: sid, type: 'slab', storeyId: 'L0', name: `Ground slab ${n.slab}`, polygon: ring, ...DEFAULTS.slab } satisfies SlabElement;
    } else n.other++;
  });

  if (!n.wall) fail('No WallSurface found in the building geometry.');
  if (n.other) warnings.push(`${n.other} surface${n.other > 1 ? 's' : ''} of other or no semantic type (e.g. ClosureSurface) ignored.`);
  if (n.skipped) warnings.push(`${n.skipped} degenerate surface${n.skipped > 1 ? 's' : ''} (zero area) skipped.`);
  warnings.push(`Thicknesses and U-values are defaults (walls ${DEFAULTS.wall.uValue}, roof ${DEFAULTS.roof.uValue}, slab ${DEFAULTS.slab.uValue} W/m²K) — CityJSON does not carry them. Review before relying on H_T.`);

  const crs = isObj(d.metadata) && typeof d.metadata.referenceSystem === 'string' ? d.metadata.referenceSystem : null;
  return {
    model: { name: buildingId, storeys: [{ id: 'L0', name: 'Imported building', elevation: 0 }], elements, origin: { crs, offset } },
    warnings,
  };
}

const isVec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(isNum);

/** Flattens any supported geometry into surfaces with their semantic type. */
function flatten(g: Obj): Surface[] {
  const sem = g.semantics as Obj;
  const kinds = Array.isArray(sem.surfaces) ? sem.surfaces.map((x) => (isObj(x) && typeof x.type === 'string' ? x.type : null)) : fail('Semantic "surfaces" must be an array.');
  // Depth of `boundaries` above the surface level; `values` sits two levels shallower than boundaries.
  const depth = { MultiSurface: 0, CompositeSurface: 0, Solid: 1, MultiSolid: 2, CompositeSolid: 2 }[String(g.type)];
  if (depth === undefined) fail(`Geometry type ${JSON.stringify(g.type)} is not supported.`);
  const out: Surface[] = [];
  const walk = (b: unknown, v: unknown, level: number) => {
    if (!Array.isArray(b)) fail('Malformed "boundaries".');
    const bs = b as unknown[];
    if (level > 0) {
      bs.forEach((child, i) => walk(child, Array.isArray(v) ? v[i] : null, level - 1));
      return;
    }
    bs.forEach((surface, i) => {
      if (!Array.isArray(surface) || !surface.length || !surface.every((r) => Array.isArray(r) && r.length >= 3 && r.every((x) => Number.isInteger(x) && x >= 0))) fail('Malformed surface rings in "boundaries".');
      const idx = Array.isArray(v) ? v[i] : null;
      const kind = Number.isInteger(idx) ? (kinds[idx as number] ?? null) : null;
      const rs = surface as number[][];
      out.push({ kind, ring: rs[0]!, holes: rs.length - 1 });
    });
  };
  walk(g.boundaries, sem.values, depth!);
  return out;
}

const newell = (p: Vec3[]): Vec3 => {
  const n: Vec3 = [0, 0, 0];
  p.forEach((a, i) => {
    const b = p[(i + 1) % p.length]!;
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  });
  return n; // length = 2 × area
};
const scaleVec = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];

/** Divergence theorem: positive when ring normals point outward. */
export function enclosedVolume(rings: Vec3[][]): number {
  return rings.reduce((sum, r) => {
    const n = newell(r);
    const c = r.reduce((a, p) => [a[0] + p[0] / r.length, a[1] + p[1] / r.length, a[2] + p[2] / r.length], [0, 0, 0]);
    return sum + (c[0] * n[0] + c[1] * n[1] + c[2] * n[2]) / 6;
  }, 0);
}

function toWall(ring: Vec3[], n: Vec3, id: string): WallElement | 'tilted' | null {
  const len = Math.hypot(...n);
  if (len < 1e-9) return null;
  if (Math.abs(n[2] / len) > MAX_WALL_TILT) return 'tilted';
  const h = Math.hypot(n[0], n[1]);
  // Exterior on the right when walking start → end: d = (−n_y, n_x).
  const d: [number, number] = [-n[1] / h, n[0] / h];
  const zMin = Math.min(...ring.map((p) => p[2]));
  const us = ring.map((p) => p[0] * d[0] + p[1] * d[1]);
  const uMin = Math.min(...us), L = Math.max(...us) - uMin;
  const profile: Point2[] = ring.map((p, i) => {
    const v = p[2] - zMin;
    return [us[i]! - uMin, v < SNAP ? 0 : v];
  });
  // ponytail: clear height = lowest non-base vertex; exact for gables and stepped tops,
  // too generous for walls whose base is not flat. Compute the inscribed rectangle if that matters.
  const height = Math.min(...profile.filter(([, v]) => v > 0).map(([, v]) => v));
  if (!(L > SNAP) || !(height > SNAP)) return null;
  // Plan points on the wall line are q + u·d; recover q from any ring point.
  const q = [ring[0]![0] - us[0]! * d[0], ring[0]![1] - us[0]! * d[1]] as const;
  const at = (u: number): Vec3 => [round(q[0] + u * d[0]), round(q[1] + u * d[1]), round(zMin)];
  const area = len / 2;
  const isRect = Math.abs(area - L * height) < 1e-6 * Math.max(1, area);
  return {
    id, type: 'wall', storeyId: 'L0', name: `Wall ${id.slice(3)}`, start: at(uMin), end: at(uMin + L),
    height: round(height), ...DEFAULTS.wall, ...(isRect ? {} : { profile: profile.map(([u, v]): Point2 => [round(u), round(v)]) }),
  };
}

function toRoof(ring: Vec3[], n: Vec3, id: string): RoofElement | null {
  const len = Math.hypot(...n);
  if (len < 1e-9) return null;
  const pitch = (Math.acos(Math.min(1, Math.abs(n[2]) / len)) * 180) / Math.PI;
  // Compass side the face drains to; flat roofs default to S.
  const face: RoofSide = Math.hypot(n[0], n[1]) < 1e-6 ? 'S' : Math.abs(n[0]) > Math.abs(n[1]) ? (n[0] > 0 ? 'E' : 'W') : n[1] > 0 ? 'N' : 'S';
  return { id, type: 'roof', storeyId: 'L0', name: `Roof face ${id.slice(3)} (${face})`, face, pitch: round(pitch), polygon: ring, ...DEFAULTS.roof };
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;
