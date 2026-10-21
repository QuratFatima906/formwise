import { describe, expect, it } from 'vitest';
import type { BuildingModel, OpeningElement, RoofElement, SlabElement, WallElement } from './model';
import { editableFields, sampleHouse } from './model';
import { envelopeArea, heatLossSummary, polygonArea2, roofEave, roofFaces, wallAreas, wallLength, wallOutline } from './geometry';
import { proposeEdit, validate } from './validate';

const wall = (over: Partial<WallElement> = {}): WallElement => ({
  id: 'W1', type: 'wall', storeyId: 'S0', name: 'Test wall',
  start: [0, 0, 0], end: [5, 0, 0], height: 2.75, thickness: 0.3, uValue: 0.5, ...over,
});
const opening = (over: Partial<OpeningElement> = {}): OpeningElement => ({
  id: 'O1', type: 'opening', storeyId: 'S0', name: 'Test window', hostWallId: 'W1',
  openingType: 'window', offset: 1, sillHeight: 0.9, width: 1.2, height: 1.4, uValue: 1.3, ...over,
});
const model = (...els: (WallElement | OpeningElement)[]): BuildingModel => ({
  name: 'Test', storeys: [{ id: 'S0', name: 'Ground', elevation: 0 }], elements: Object.fromEntries(els.map((e) => [e.id, e])),
});
const codes = (m: BuildingModel) => validate(m).map((i) => `${i.code}:${i.elementId}`);

describe('areas (hand-computed, spec §8)', () => {
  it('wall 5 m × 2.75 m has gross face area 13.75 m²', () => {
    const w = wall();
    expect(wallLength(w)).toBe(5);
    expect(wallAreas(model(w), w).gross).toBeCloseTo(13.75, 10);
  });

  it('window 1.2 × 1.4 m is 1.68 m²; net opaque wall area is 12.07 m²', () => {
    const w = wall(), o = opening();
    const m = model(w, o);
    expect(envelopeArea(m, o)).toBeCloseTo(1.68, 10);
    expect(wallAreas(m, w)).toMatchObject({ openingCount: 1 });
    expect(wallAreas(m, w).net).toBeCloseTo(12.07, 10);
  });

  it('U 0.5 W/m²K × A 10 m² contributes 5 W/K', () => {
    const w = wall({ end: [5, 0, 0], height: 2 });
    expect(heatLossSummary(model(w)).total).toBeCloseTo(5, 10);
  });

  it('does not double-count openings: wall net + opening area = gross', () => {
    const w = wall(), o = opening();
    const s = heatLossSummary(model(w, o));
    expect(s.area).toBeCloseTo(13.75, 10);
    expect(s.total).toBeCloseTo(12.07 * 0.5 + 1.68 * 1.3, 10);
  });

  it('hipped roof of the 10 × 8 m sample at 30° covers footprint / cos 30°', () => {
    const m = sampleHouse();
    const { faces, eave, ridge } = roofFaces(m);
    expect(eave).toBeCloseTo(5.5, 10);
    expect(ridge).toBeCloseTo(5.5 + 4 * Math.tan(Math.PI / 6), 10);
    const slope = 4 / Math.cos(Math.PI / 6);
    expect(envelopeArea(m, m.elements['RF-S']!)).toBeCloseTo(((10 + 2) / 2) * slope, 10);
    expect(envelopeArea(m, m.elements['RF-E']!)).toBeCloseTo((8 * slope) / 2, 10);
    expect(Object.keys(faces)).toHaveLength(4);
  });

  it('sample house H_T matches the hand calculation (476.93 W/K)', () => {
    // walls 198 m² gross − 2.10 door − 18.02 windows = 177.88 m² × 1.4
    // + windows 18.02 × 2.8 + door 2.10 × 3.0 + roof 80/cos30° × 0.9 + slab 80 × 1.1
    const expected = 177.88 * 1.4 + 18.02 * 2.8 + 2.1 * 3 + (80 / Math.cos(Math.PI / 6)) * 0.9 + 80 * 1.1;
    const s = heatLossSummary(sampleHouse());
    expect(s.total).toBeCloseTo(expected, 8);
    expect(s.total).toBeCloseTo(476.93, 2);
    expect(s.groups.find((g) => g.kind === 'window')).toMatchObject({ count: 12 });
    expect(s.total).toBeCloseTo(s.rows.reduce((a, r) => a + r.ua, 0), 10);
  });
});

describe('validation', () => {
  it('sample house passes all checks', () => {
    expect(validate(sampleHouse())).toEqual([]);
  });

  it('flags an opening beyond the end of its host wall', () => {
    expect(codes(model(wall(), opening({ offset: 4 })))).toContain('out-of-bounds:O1');
    expect(codes(model(wall(), opening({ offset: -0.1 })))).toContain('out-of-bounds:O1');
  });

  it('flags an opening above the wall top', () => {
    expect(codes(model(wall(), opening({ sillHeight: 1.5 })))).toContain('above-wall:O1');
  });

  it('flags overlapping openings but not side-by-side ones', () => {
    const a = opening(), b = opening({ id: 'O2', offset: 2 });
    expect(codes(model(wall(), a, b))).toContain('overlap:O1');
    expect(codes(model(wall(), a, { ...b, offset: 2.2 }))).not.toContain('overlap:O1');
  });

  it('flags non-positive dimensions and out-of-range U-values', () => {
    expect(codes(model(wall({ height: 0 })))).toContain('dimension:W1');
    expect(codes(model(wall(), opening({ width: -1 })))).toContain('dimension:O1');
    expect(codes(model(wall({ uValue: 0 })))).toContain('u-value:W1');
    expect(codes(model(wall({ uValue: 12 })))).toContain('u-value:W1');
  });

  it('flags an opening whose host wall is missing', () => {
    expect(codes(model(opening({ hostWallId: 'nope' })))).toEqual(['missing-host:O1']);
  });

  it('warns when an opening edge sits in the corner zone', () => {
    const issues = validate(model(wall(), opening({ offset: 0.1 })));
    expect(issues).toMatchObject([{ code: 'corner', severity: 'warning' }]);
  });
});

describe('proposeEdit', () => {
  it('blocks an out-of-bounds edit and leaves the model untouched', () => {
    const m = model(wall(), opening());
    const r = proposeEdit(m, opening({ width: 5 }));
    expect(r.blocked).toBe(true);
    expect(r.issues.map((i) => i.code)).toContain('out-of-bounds');
    expect((m.elements.O1 as OpeningElement).width).toBe(1.2);
  });

  it('reports errors an edit causes on related elements (wall made lower than its window)', () => {
    const r = proposeEdit(model(wall(), opening()), wall({ height: 2 }));
    expect(r.blocked).toBe(true);
    expect(r.issues).toMatchObject([{ code: 'above-wall', elementId: 'O1' }]);
  });

  it('does not block on errors that already existed before the edit', () => {
    const m = model(wall(), opening({ offset: 4 }));
    expect(proposeEdit(m, wall({ uValue: 0.24 })).blocked).toBe(false);
  });
});

describe('wallOutline', () => {
  it('cuts a window as a hole and a door as a base notch', () => {
    const w = wall(), win = opening(), door = opening({ id: 'D1', openingType: 'door', offset: 3, sillHeight: 0, width: 1, height: 2.1 });
    const { outer, holes } = wallOutline(w, [door, win]);
    expect(holes).toEqual([[[1, 0.9], [1, 2.3], [2.2, 2.3], [2.2, 0.9]]]);
    expect(outer.slice(0, 5)).toEqual([[0, 0], [3, 0], [3, 2.1], [4, 2.1], [4, 0]]);
    const solid = polygonArea2(outer) - holes.reduce((s, h) => s + polygonArea2(h), 0);
    expect(solid).toBeCloseTo(13.75 - 1.68 - 2.1, 10);
  });

  it('leaves the wall closed for an opening that does not fit', () => {
    const { outer, holes } = wallOutline(wall(), [opening({ offset: 4.5 })]);
    expect(holes).toEqual([]);
    expect(polygonArea2(outer)).toBeCloseTo(13.75, 10);
  });
});

describe('imported geometry (profiles and polygons)', () => {
  // 6 m gable wall: eaves at 3 m, ridge at 5 m → 6 × 3 + 6 × 2 / 2 = 24 m².
  const gable = wall({ end: [6, 0, 0], height: 3, profile: [[0, 0], [6, 0], [6, 3], [3, 5], [0, 3]] });

  it('uses the profile area as gross wall area', () => {
    expect(wallAreas(model(gable), gable).gross).toBeCloseTo(24, 10);
    expect(wallAreas(model(gable, opening()), gable).net).toBeCloseTo(24 - 1.68, 10);
  });

  it('notches a door into the profile bottom edge and holes everything else', () => {
    const door = opening({ id: 'D1', openingType: 'door', offset: 2, sillHeight: 0, width: 1, height: 2.1 });
    const top = opening({ id: 'O2', offset: 4, sillHeight: 1.6, width: 1, height: 1.4 }); // reaches the 3 m clear height
    const { outer, holes } = wallOutline(gable, [door, top]);
    expect(outer.slice(0, 6)).toEqual([[0, 0], [2, 0], [2, 2.1], [3, 2.1], [3, 0], [6, 0]]);
    expect(holes).toHaveLength(1);
    const solid = polygonArea2(outer) - polygonArea2(holes[0]!);
    expect(solid).toBeCloseTo(24 - 2.1 - 1.4, 10);
  });

  it('makes a profiled wall height read-only and skips storey alignment for it', () => {
    expect(editableFields(gable)).toEqual(['thickness', 'uValue']);
    expect(editableFields(wall())).toEqual(['height', 'thickness', 'uValue']);
    const short = { ...gable, id: 'W2', height: 2 };
    expect(validate(model(gable, short))).toEqual([]);
  });

  it('uses explicit roof and slab polygons for areas', () => {
    // 4 × 5 m roof plane rising 3 m over its 4 m run → slope 5 m → 25 m².
    const roof: RoofElement = { id: 'R1', type: 'roof', storeyId: 'S0', name: 'Roof', face: 'S', thickness: 0.2, pitch: 36.87, uValue: 1, polygon: [[0, 0, 0], [5, 0, 0], [5, 4, 3], [0, 4, 3]] };
    const slab: SlabElement = { id: 'G1', type: 'slab', storeyId: 'S0', name: 'Ground', thickness: 0.2, uValue: 1, polygon: [[0, 0, 0], [4, 0, 0], [4, 2, 0], [2, 2, 0], [2, 4, 0], [0, 4, 0]] };
    const m = { ...model(wall()), elements: { ...model(wall()).elements, R1: roof, G1: slab } };
    expect(envelopeArea(m, roof)).toBeCloseTo(25, 10);
    expect(roofEave(m, roof)).toBe(0);
    expect(envelopeArea(m, slab)).toBeCloseTo(12, 10); // L-shape: 16 − 4
  });
});
