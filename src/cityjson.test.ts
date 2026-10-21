import { describe, expect, it } from 'vitest';
import type { WallElement } from './domain/model';
import { envelopeArea, heatLossSummary, wallAreas } from './domain/geometry';
import { validate } from './domain/validate';
import { enclosedVolume, parseCityJson } from './cityjson';
import { parseImportBytes } from './importFile';
import SAMPLE from '../samples/gable-house.city.json?raw';

// Synthetic sample: 10 × 8 m gable house, eaves 6 m, ridge 9 m along x, RD New coordinates.
const sample = () => JSON.parse(SAMPLE);
const ok = (d: unknown) => {
  const r = parseCityJson(d as Record<string, unknown>);
  if (!r.ok) throw new Error(r.error);
  return r;
};
const err = (d: unknown) => {
  const r = parseCityJson(d as Record<string, unknown>);
  return r.ok ? null : r.error;
};

describe('CityJSON sample import', () => {
  const { model, warnings } = ok(sample());
  const walls = Object.values(model.elements).filter((e): e is WallElement => e.type === 'wall');

  it('maps semantic surfaces to 4 walls, 2 roof faces and 1 slab in local metres', () => {
    expect(walls).toHaveLength(4);
    expect(Object.values(model.elements).filter((e) => e.type === 'roof')).toHaveLength(2);
    expect(Object.values(model.elements).filter((e) => e.type === 'slab')).toHaveLength(1);
    expect(model.origin).toEqual({ crs: 'https://www.opengis.net/def/crs/EPSG/0/7415', offset: [155000, 463000, 0] });
    expect(model.name).toBe('FW-GABLE-HOUSE');
  });

  it('orients walls with the exterior on the right (south wall runs east)', () => {
    const south = walls.find((w) => w.start[1] === 0 && w.end[1] === 0)!;
    expect(south).toMatchObject({ start: [0, 0, 0], end: [10, 0, 0], height: 6 });
    expect(south.profile).toBeUndefined(); // plain rectangle
  });

  it('keeps gable walls as profiles with the eave as clear height', () => {
    const gables = walls.filter((w) => w.profile);
    expect(gables).toHaveLength(2);
    for (const g of gables) {
      expect(g.height).toBe(6);
      expect(wallAreas(model, g).gross).toBeCloseTo(60, 6);
    }
  });

  it('computes areas and H_T by hand: 240 m² walls, 100 m² roof, 80 m² slab → 514 W/K', () => {
    const s = heatLossSummary(model);
    expect(s.groups.find((g) => g.kind === 'wall')!.area).toBeCloseTo(240, 6);
    expect(s.groups.find((g) => g.kind === 'roof')!.area).toBeCloseTo(100, 6);
    expect(s.groups.find((g) => g.kind === 'slab')!.area).toBeCloseTo(80, 6);
    expect(s.total).toBeCloseTo(514, 6);
    const roof = Object.values(model.elements).find((e) => e.type === 'roof')!;
    expect(roof).toMatchObject({ pitch: 36.8699 });
    expect(envelopeArea(model, roof)).toBeCloseTo(50, 6);
  });

  it('passes validation and warns that U-values are defaults', () => {
    expect(validate(model)).toEqual([]);
    expect(warnings.join(' ')).toMatch(/defaults/);
  });

  it('gives the same result when every ring is wound clockwise', () => {
    const d = sample();
    for (const shell of d.CityObjects['FW-GABLE-HOUSE-0'].geometry[0].boundaries) for (const surface of shell) for (const ring of surface) ring.reverse();
    expect(heatLossSummary(ok(d).model).total).toBeCloseTo(514, 6);
    expect(Object.values(ok(d).model.elements).find((e) => e.type === 'wall' && e.start[1] === 0)).toMatchObject({ start: [0, 0, 0], end: [10, 0, 0] });
  });

  it('accepts the same surfaces as a MultiSurface on the Building itself', () => {
    const d = sample();
    const part = d.CityObjects['FW-GABLE-HOUSE-0'];
    d.CityObjects = { B: { type: 'Building', geometry: [{ type: 'MultiSurface', lod: '2', boundaries: part.geometry[0].boundaries[0], semantics: { surfaces: part.geometry[0].semantics.surfaces, values: part.geometry[0].semantics.values[0] } }] } };
    expect(heatLossSummary(ok(d).model).total).toBeCloseTo(514, 6);
  });
});

describe('CityJSON rejections', () => {
  it('rejects unsupported versions, missing transform and non-buildings', () => {
    expect(err({ ...sample(), version: '1.0' })).toMatch(/version "1.0" is not supported/);
    expect(err({ ...sample(), transform: undefined })).toMatch(/"transform"/);
    expect(err({ ...sample(), CityObjects: { R: { type: 'Road' } } })).toMatch(/no Building/);
  });

  it('rejects files with more than one building', () => {
    const d = sample();
    d.CityObjects.OTHER = { type: 'Building' };
    expect(err(d)).toMatch(/2 buildings; Formwise imports one building per file/);
  });

  it('rejects LOD1-only buildings and names the LOD found', () => {
    const d = sample();
    d.CityObjects['FW-GABLE-HOUSE-0'].geometry[0].lod = '1.2';
    expect(err(d)).toMatch(/LOD2 geometry with semantic surfaces is required \(found LOD 1.2\)/);
  });

  it('rejects inner rings, bad vertex indices and tilted walls', () => {
    const holes = sample();
    holes.CityObjects['FW-GABLE-HOUSE-0'].geometry[0].boundaries[0][1].push([0, 1, 2]);
    expect(err(holes)).toMatch(/inner rings/);
    const range = sample();
    range.CityObjects['FW-GABLE-HOUSE-0'].geometry[0].boundaries[0][1][0][0] = 999;
    expect(err(range)).toMatch(/Vertex index 999 is out of range/);
    const tilt = sample();
    tilt.CityObjects['FW-GABLE-HOUSE-0'].geometry[0].semantics.values[0][5] = 1; // a roof plane labelled as wall
    expect(err(tilt)).toMatch(/leans more than 10°/);
  });

  it('rejects unsupported geometry types and malformed boundaries', () => {
    const t = sample();
    t.CityObjects['FW-GABLE-HOUSE-0'].geometry[0].type = 'GeometryInstance';
    expect(err(t)).toMatch(/GeometryInstance" is not supported/);
    const b = sample();
    b.CityObjects['FW-GABLE-HOUSE-0'].geometry[0].boundaries = [[[[0, 1]]]];
    expect(err(b)).toMatch(/Malformed surface rings/);
  });

  it('flows through the file gate, which rejects CityJSON feature streams', () => {
    expect(parseImportBytes(new TextEncoder().encode(SAMPLE).buffer as ArrayBuffer)).toMatchObject({ ok: true, format: 'cityjson', issues: 0 });
    const feature = new TextEncoder().encode('{"type":"CityJSONFeature"}').buffer as ArrayBuffer;
    expect(parseImportBytes(feature)).toMatchObject({ ok: false, error: expect.stringMatching(/feature streams/) });
  });
});

describe('enclosedVolume', () => {
  it('is +V for outward (CCW-from-outside) unit cube faces and −V when reversed', () => {
    const c: [number, number, number][][] = [
      [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
      [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], [[1, 1, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1]],
      [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]],
    ];
    expect(enclosedVolume(c)).toBeCloseTo(1, 10);
    expect(enclosedVolume(c.map((r) => [...r].reverse()))).toBeCloseTo(-1, 10);
  });
});
