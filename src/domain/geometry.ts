import type { BuildingElement, BuildingModel, ElementKind, OpeningElement, RoofSide, Vec3, WallElement } from './model';
import { kindOf } from './model';

export const EPS = 1e-6;

export const wallLength = (w: WallElement) => Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]);

export const openingArea = (o: OpeningElement) => o.width * o.height;

export const openingsOf = (m: BuildingModel, wallId: string): OpeningElement[] =>
  Object.values(m.elements)
    .filter((e): e is OpeningElement => e.type === 'opening' && e.hostWallId === wallId)
    .sort((a, b) => a.offset - b.offset);

const wallsOf = (m: BuildingModel, storeyId: string) =>
  Object.values(m.elements).filter((e): e is WallElement => e.type === 'wall' && e.storeyId === storeyId);

/** Plan-view bounding box of a storey's wall baselines. */
export function storeyBounds(m: BuildingModel, storeyId: string) {
  const ws = wallsOf(m, storeyId);
  if (!ws.length) return null;
  const xs = ws.flatMap((w) => [w.start[0], w.end[0]]);
  const ys = ws.flatMap((w) => [w.start[1], w.end[1]]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), walls: ws };
}

/**
 * Hipped roof over the top storey's bounding box, ridge along x. Faces are
 * named after the side they drain to. Vertices are
 * counter-clockwise seen from outside/above.
 */
export function roofFaces(m: BuildingModel): { faces: Partial<Record<RoofSide, Vec3[]>>; eave: number; ridge: number } {
  const top = m.storeys[m.storeys.length - 1];
  const b = top && storeyBounds(m, top.id);
  if (!b) return { faces: {}, eave: 0, ridge: 0 };
  const roof = Object.values(m.elements).find((e) => e.type === 'roof');
  const pitch = roof && roof.type === 'roof' ? roof.pitch : 30;
  const eave = Math.max(...b.walls.map((w) => w.start[2] + w.height));
  const half = Math.min(b.x1 - b.x0, b.y1 - b.y0) / 2;
  const ridge = eave + half * Math.tan((pitch * Math.PI) / 180);
  const sw: Vec3 = [b.x0, b.y0, eave], se: Vec3 = [b.x1, b.y0, eave];
  const ne: Vec3 = [b.x1, b.y1, eave], nw: Vec3 = [b.x0, b.y1, eave];
  // ponytail: assumes the footprint is wider (x) than deep (y), true for the
  // sample; footprints are not editable. Add the rotated case with a second fixture.
  const r1: Vec3 = [b.x0 + half, b.y0 + half, ridge], r2: Vec3 = [b.x1 - half, b.y0 + half, ridge];
  return { faces: { S: [sw, se, r2, r1], E: [se, ne, r2], N: [ne, nw, r1, r2], W: [nw, sw, r1] }, eave, ridge };
}

/** Area of a planar 3D polygon (Newell's method). */
export function polygonArea(p: Vec3[]): number {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!, b = p[(i + 1) % p.length]!;
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return 0.5 * Math.hypot(x, y, z);
}

export interface WallAreas {
  gross: number;
  openings: number;
  openingCount: number;
  net: number;
}

/** Gross face area (length × height), opening area, and net opaque area. */
export function wallAreas(m: BuildingModel, w: WallElement): WallAreas {
  const gross = wallLength(w) * w.height;
  const os = openingsOf(m, w.id);
  const openings = os.reduce((s, o) => s + openingArea(o), 0);
  return { gross, openings, openingCount: os.length, net: gross - openings };
}

/**
 * Heat-transfer area of an element: net opaque area for walls (openings are
 * counted on their own, never twice), opening area, roof face area, and slab
 * footprint area.
 */
export function envelopeArea(m: BuildingModel, e: BuildingElement): number {
  switch (e.type) {
    case 'wall': return wallAreas(m, e).net;
    case 'opening': return openingArea(e);
    case 'roof': {
      const p = roofFaces(m).faces[e.face];
      return p ? polygonArea(p) : 0;
    }
    case 'slab': {
      const b = storeyBounds(m, e.storeyId);
      return b ? (b.x1 - b.x0) * (b.y1 - b.y0) : 0;
    }
  }
}

export interface SummaryRow {
  kind: ElementKind;
  id: string;
  name: string;
  storeyId: string;
  area: number;
  uValue: number;
  ua: number;
}

export interface SummaryGroup {
  kind: ElementKind;
  label: string;
  count: number;
  area: number;
  ua: number;
}

export interface HeatLossSummary {
  rows: SummaryRow[];
  groups: SummaryGroup[];
  area: number;
  /** H_T = Σ(U_i × A_i) in W/K. */
  total: number;
}

const GROUP_LABELS: Record<ElementKind, string> = {
  wall: 'Walls, net opaque',
  window: 'Windows',
  door: 'Doors',
  roof: 'Roof faces',
  slab: 'Ground slab',
};

export function heatLossSummary(m: BuildingModel): HeatLossSummary {
  const rows: SummaryRow[] = Object.values(m.elements).map((e) => {
    const area = envelopeArea(m, e);
    return { kind: kindOf(e), id: e.id, name: e.name, storeyId: e.storeyId, area, uValue: e.uValue, ua: area * e.uValue };
  });
  const groups = (Object.keys(GROUP_LABELS) as ElementKind[]).map((kind) => {
    const rs = rows.filter((r) => r.kind === kind);
    return { kind, label: GROUP_LABELS[kind], count: rs.length, area: sum(rs.map((r) => r.area)), ua: sum(rs.map((r) => r.ua)) };
  });
  return { rows, groups, area: sum(rows.map((r) => r.area)), total: sum(rows.map((r) => r.ua)) };
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

export type Point2 = [number, number];

/**
 * Wall elevation outline in wall-local 2D coordinates (u along the wall from
 * its start, v up from its base), ready for extrusion through the thickness.
 * Openings touching the base (doors) or the top become notches in the outer
 * contour; all others become holes. Openings outside the wall are skipped —
 * validation reports them, the mesh just stays closed.
 */
export function wallOutline(w: WallElement, openings: OpeningElement[]): { outer: Point2[]; holes: Point2[][] } {
  const L = wallLength(w), H = w.height;
  const fits = openings
    .filter((o) => o.width > 0 && o.height > 0 && o.offset >= -EPS && o.offset + o.width <= L + EPS && o.sillHeight >= 0 && o.sillHeight + o.height <= H + EPS)
    .sort((a, b) => a.offset - b.offset);
  const atBase = (o: OpeningElement) => o.sillHeight <= EPS;
  const atTop = (o: OpeningElement) => !atBase(o) && o.sillHeight + o.height >= H - EPS;

  const outer: Point2[] = [[0, 0]];
  for (const o of fits.filter(atBase)) {
    outer.push([o.offset, 0], [o.offset, o.height], [o.offset + o.width, o.height], [o.offset + o.width, 0]);
  }
  outer.push([L, 0], [L, H]);
  for (const o of fits.filter(atTop).reverse()) {
    outer.push([o.offset + o.width, H], [o.offset + o.width, o.sillHeight], [o.offset, o.sillHeight], [o.offset, H]);
  }
  outer.push([0, H]);

  const holes = fits
    .filter((o) => !atBase(o) && !atTop(o))
    .map((o): Point2[] => [
      [o.offset, o.sillHeight],
      [o.offset, o.sillHeight + o.height],
      [o.offset + o.width, o.sillHeight + o.height],
      [o.offset + o.width, o.sillHeight],
    ]);
  return { outer, holes };
}

/** Area of a simple 2D polygon (shoelace). */
export function polygonArea2(p: Point2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!, b = p[(i + 1) % p.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}
