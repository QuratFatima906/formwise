import { describe, expect, it } from 'vitest';
import { sampleHouse } from './domain/model';
import { heatLossSummary } from './domain/geometry';
import { proposeEdit } from './domain/validate';
import { describeChanges, evaluateDraft, newOpeningFor, parseDecimal, type Draft } from './draft';

const m = sampleHouse();
const draftOf = (id: string, values: Draft['values'], extra: Partial<Draft> = {}): Draft => ({
  base: m.elements[id]!, isNew: false, values, order: Object.keys(values) as Draft['order'], ...extra,
});

describe('parseDecimal', () => {
  it('accepts point and comma decimals, rejects junk', () => {
    expect(parseDecimal('1.6')).toBe(1.6);
    expect(parseDecimal(' 1,6 ')).toBe(1.6);
    expect(parseDecimal('-0.1')).toBe(-0.1);
    expect(parseDecimal('.5')).toBe(0.5);
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('1.6m')).toBeNull();
    expect(parseDecimal('1e3')).toBeNull();
  });
});

describe('evaluateDraft', () => {
  it('a valid width change produces a candidate and an unblocked draft', () => {
    const r = evaluateDraft(m, draftOf('WN-02', { width: '1.6' }));
    expect(r.blocked).toBe(false);
    expect(r.changes).toEqual(['width']);
    expect(r.candidate.elements['WN-02']).toMatchObject({ width: 1.6 });
    expect(m.elements['WN-02']).toMatchObject({ width: 1.2 });
    expect(describeChanges(m.elements['WN-02']!, r.element, r.changes)).toBe('Width 1.20 → 1.60 m');
  });

  it('a window pushed past the wall end is blocked, flagged on width, and ghosted', () => {
    const r = evaluateDraft(m, draftOf('WN-02', { width: '2.6' }));
    expect(r.blocked).toBe(true);
    expect(r.fieldMessages.width).toMatchObject({ severity: 'error', message: expect.stringContaining('0.20 m beyond the end') });
    expect(r.ghost).toMatchObject({ id: 'WN-02', width: 2.6 });
  });

  it('a non-numeric value is blocked without a ghost', () => {
    const r = evaluateDraft(m, draftOf('WN-02', { width: 'abc' }));
    expect(r.blocked).toBe(true);
    expect(r.fieldMessages.width?.message).toBe('Enter a number in m.');
    expect(r.ghost).toBeNull();
  });

  it('lowering a wall below its windows names the affected window', () => {
    const r = evaluateDraft(m, draftOf('WL-EG-S', { height: '2' }));
    expect(r.blocked).toBe(true);
    expect(r.fieldMessages.height?.message).toMatch(/^Entrance door \(DR-01\): Top edge/);
  });

  it('a U-value change lowers H_T by ΔU × net wall area', () => {
    const r = evaluateDraft(m, draftOf('WL-EG-S', { uValue: '0.24' }));
    // South EG wall: 10 × 2.75 − (1.68 + 2.10 + 1.68) = 22.04 m² net.
    const delta = heatLossSummary(m).total - heatLossSummary(r.candidate).total;
    expect(delta).toBeCloseTo((1.4 - 0.24) * 22.04, 10);
  });

  it('changing only the opening type counts as a change', () => {
    const r = evaluateDraft(m, draftOf('WN-01', {}, { openingType: 'door' }));
    expect(r.dirty).toBe(true);
    expect(r.changes).toEqual(['openingType']);
  });
});

describe('newOpeningFor', () => {
  it('places a 1.00 m window in the first free gap of the south wall', () => {
    const o = newOpeningFor(m, 'WL-EG-S')!;
    expect(o).toMatchObject({ id: 'WN-13', hostWallId: 'WL-EG-S', offset: 2.7, width: 1, height: 1.4, sillHeight: 0.9 });
    expect(proposeEdit(m, o).blocked).toBe(false);
  });

  it('returns null for a non-wall', () => {
    expect(newOpeningFor(m, 'RF-S')).toBeNull();
  });
});
