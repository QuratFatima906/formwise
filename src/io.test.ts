import { describe, expect, it } from 'vitest';
import { sampleHouse } from './domain/model';
import { heatLossSummary } from './domain/geometry';
import { f2 } from './domain/validate';
import { summaryCsv, summaryJson } from './export';
import { parseModel } from './persistence';

describe('summary exports', () => {
  const m = sampleHouse();
  const s = heatLossSummary(m);

  it('CSV has a header, one row per element, and a TOTAL matching the UI', () => {
    const lines = summaryCsv(m).trim().split('\n');
    expect(lines[0]).toBe('element_type,element_id,name,storey,area_m2,u_value_W_m2K,ua_W_K');
    expect(lines).toHaveLength(1 + Object.keys(m.elements).length + 1);
    expect(lines).toContain('wall,WL-EG-S,South wall,EG,22.04,1.40,30.86');
    expect(lines).toContain('window,WN-02,Window 02,EG,1.68,2.80,4.70');
    expect(lines.at(-1)).toBe(`TOTAL,,,,${f2(s.area)},,${f2(s.total)}`);
    expect(lines.at(-1)).toBe('TOTAL,,,,370.38,,476.93');
  });

  it('CSV quotes names containing commas or quotes', () => {
    const x = sampleHouse();
    x.elements['WN-01']!.name = 'Window "A", left';
    expect(summaryCsv(x)).toContain('window,WN-01,"Window ""A"", left",EG');
  });

  it('JSON totals equal the summary panel values', () => {
    const j = JSON.parse(summaryJson(m, new Date('2026-10-21T00:00:00Z')));
    expect(j.totals.H_T_W_K).toBeCloseTo(s.total, 3);
    expect(j.totals.area_m2).toBeCloseTo(s.area, 3);
    expect(j.elements).toHaveLength(26);
    expect(j.method).toMatch(/not an official GEG\/DIN V 18599/);
  });
});

describe('parseModel', () => {
  it('round-trips a saved model', () => {
    const m = sampleHouse();
    expect(parseModel(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });

  it('rejects malformed data', () => {
    const m = JSON.parse(JSON.stringify(sampleHouse()));
    expect(parseModel(null)).toBeNull();
    expect(parseModel({ ...m, storeys: [] })).toBeNull();
    expect(parseModel({ ...m, elements: { ...m.elements, 'WN-01': { ...m.elements['WN-01'], width: '1.2' } } })).toBeNull();
    expect(parseModel({ ...m, elements: { ...m.elements, X: { ...m.elements['WN-01'] } } })).toBeNull();
    expect(parseModel({ ...m, elements: { ...m.elements, 'SL-01': { ...m.elements['SL-01'], type: 'beam' } } })).toBeNull();
  });
});
