/**
 * Canonical building model. All lengths in metres, U-values in W/m²K.
 *
 * Coordinates are Z-up: +x east, +y north, +z up. A wall runs from `start`
 * to `end` along its exterior face, at the base elevation `start[2]`; the
 * exterior is on the right-hand side when walking start → end (the sample
 * footprint is counter-clockwise seen from above). Openings are stored relative to
 * their host wall: `offset` is measured from the wall start along the wall,
 * `sillHeight` from the wall base.
 */
export type Vec3 = [number, number, number];
export type RoofSide = 'S' | 'E' | 'N' | 'W';
export type OpeningType = 'window' | 'door';

export interface Storey {
  id: string;
  name: string;
  elevation: number;
}

interface BaseElement {
  id: string;
  storeyId: string;
  name: string;
  uValue: number;
}

export interface WallElement extends BaseElement {
  type: 'wall';
  start: Vec3;
  end: Vec3;
  height: number;
  thickness: number;
}

export interface OpeningElement extends BaseElement {
  type: 'opening';
  hostWallId: string;
  openingType: OpeningType;
  offset: number;
  sillHeight: number;
  width: number;
  height: number;
}

/** Hipped-roof face; its polygon is derived from the top storey's walls. */
export interface RoofElement extends BaseElement {
  type: 'roof';
  face: RoofSide;
  thickness: number;
  pitch: number;
}

/** Ground slab; its outline is the ground storey's wall bounding box. */
export interface SlabElement extends BaseElement {
  type: 'slab';
  thickness: number;
}

export type BuildingElement = WallElement | OpeningElement | RoofElement | SlabElement;
export type ElementType = BuildingElement['type'];
/** Element category used for colours, legend and summary grouping. */
export type ElementKind = 'wall' | OpeningType | 'roof' | 'slab';

export interface BuildingModel {
  name: string;
  storeys: Storey[];
  elements: Record<string, BuildingElement>;
}

export const kindOf = (e: BuildingElement): ElementKind => (e.type === 'opening' ? e.openingType : e.type);

/** Editable numeric properties per element type, in inspector order. */
export const EDITABLE_FIELDS = {
  wall: ['height', 'thickness', 'uValue'],
  opening: ['width', 'height', 'sillHeight', 'offset', 'uValue'],
  roof: ['thickness', 'uValue'],
  slab: ['thickness', 'uValue'],
} as const satisfies Record<ElementType, readonly string[]>;

export type NumericField = (typeof EDITABLE_FIELDS)[ElementType][number];

const SIDES: [RoofSide, string][] = [
  ['S', 'South'],
  ['E', 'East'],
  ['N', 'North'],
  ['W', 'West'],
];

/** Deterministic two-storey 10 × 8 m sample house with a hipped roof. */
export function sampleHouse(): BuildingModel {
  const X = 10, Y = 8, H = 2.75, T = 0.365;
  const footprint: [number, number][] = [[0, 0], [X, 0], [X, Y], [0, Y]];
  const storeys: Storey[] = [
    { id: 'EG', name: 'Ground floor', elevation: 0 },
    { id: 'OG', name: 'Upper floor', elevation: H },
  ];
  const elements: Record<string, BuildingElement> = {};
  const add = (e: BuildingElement) => (elements[e.id] = e);

  for (const s of storeys) {
    SIDES.forEach(([side, label], i) => {
      const a = footprint[i]!, b = footprint[(i + 1) % 4]!;
      add({
        id: `WL-${s.id}-${side}`, type: 'wall', storeyId: s.id, name: `${label} wall`,
        start: [a[0], a[1], s.elevation], end: [b[0], b[1], s.elevation],
        height: H, thickness: T, uValue: 1.4,
      });
    });
  }

  add({
    id: 'DR-01', type: 'opening', storeyId: 'EG', name: 'Entrance door', hostWallId: 'WL-EG-S',
    openingType: 'door', offset: 4.5, width: 1.0, height: 2.1, sillHeight: 0, uValue: 3.0,
  });
  const windows: [string, string, number, number, number, number][] = [
    ['WN-01', 'WL-EG-S', 1.2, 1.2, 1.4, 0.9], ['WN-02', 'WL-EG-S', 7.6, 1.2, 1.4, 0.9],
    ['WN-03', 'WL-EG-E', 3.5, 1.0, 1.4, 0.9], ['WN-04', 'WL-EG-N', 2.0, 0.9, 1.0, 1.2],
    ['WN-05', 'WL-EG-N', 6.4, 1.2, 1.4, 0.9], ['WN-06', 'WL-EG-W', 3.5, 1.0, 1.4, 0.9],
    ['WN-07', 'WL-OG-S', 1.2, 1.2, 1.4, 0.9], ['WN-08', 'WL-OG-S', 4.4, 1.2, 1.4, 0.9],
    ['WN-09', 'WL-OG-S', 7.6, 1.2, 1.4, 0.9], ['WN-10', 'WL-OG-E', 3.5, 1.0, 1.4, 0.9],
    ['WN-11', 'WL-OG-N', 4.4, 1.2, 1.2, 1.0], ['WN-12', 'WL-OG-W', 3.5, 1.0, 1.4, 0.9],
  ];
  for (const [id, host, offset, width, height, sillHeight] of windows) {
    add({
      id, type: 'opening', storeyId: host.split('-')[1]!, name: `Window ${id.slice(3)}`, hostWallId: host,
      openingType: 'window', offset, width, height, sillHeight, uValue: 2.8,
    });
  }

  for (const [face, label] of SIDES) {
    add({ id: `RF-${face}`, type: 'roof', storeyId: 'OG', name: `${label} roof face`, face, thickness: 0.22, uValue: 0.9, pitch: 30 });
  }
  add({ id: 'SL-01', type: 'slab', storeyId: 'EG', name: 'Ground slab', thickness: 0.25, uValue: 1.1 });

  return { name: 'Sample house', storeys, elements };
}
