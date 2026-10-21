import type { BuildingElement, BuildingModel, NumericField, OpeningElement, WallElement } from './model';
import { EPS, wallLength } from './geometry';

export const FIELD_META: Record<NumericField, { label: string; unit: string; decimals: number }> = {
  height: { label: 'Height', unit: 'm', decimals: 2 },
  thickness: { label: 'Thickness', unit: 'm', decimals: 3 },
  uValue: { label: 'U-value', unit: 'W/m²K', decimals: 2 },
  width: { label: 'Width', unit: 'm', decimals: 2 },
  sillHeight: { label: 'Sill height', unit: 'm', decimals: 2 },
  offset: { label: 'Offset', unit: 'm', decimals: 2 },
};

export const U_MIN = 0.01;
export const U_MAX = 10;

export type Severity = 'error' | 'warning';
export type IssueCode = 'dimension' | 'u-value' | 'missing-host' | 'out-of-bounds' | 'above-wall' | 'overlap' | 'corner' | 'storey-level';

export interface Issue {
  severity: Severity;
  code: IssueCode;
  elementId: string;
  /** Inspector fields the user can change to resolve the issue. */
  fields: NumericField[];
  message: string;
  hint: string;
  /** Another element involved (host wall, overlapping opening). */
  relatedId?: string;
}

export const f2 = (v: number, n = 2) => (Number.isFinite(v) ? v.toFixed(n) : '—');

/** Every geometry and property check on the model. Pure; order is stable. */
export function validate(m: BuildingModel): Issue[] {
  const out: Issue[] = [];
  const els = Object.values(m.elements);
  const add = (severity: Severity, code: IssueCode, e: BuildingElement, fields: NumericField[], message: string, hint: string, relatedId?: string) =>
    out.push({ severity, code, elementId: e.id, fields, message, hint, relatedId });

  const positive = (e: BuildingElement, k: NumericField, v: number) => {
    if (!(v > 0)) {
      add('error', 'dimension', e, [k], `${FIELD_META[k].label} must be greater than 0.`, `Enter a positive value in ${FIELD_META[k].unit}.`);
    }
  };
  const uValueOk = (e: BuildingElement) => {
    if (!(e.uValue >= U_MIN && e.uValue <= U_MAX)) {
      add('error', 'u-value', e, ['uValue'], `U-value must be between ${f2(U_MIN)} and ${f2(U_MAX)} W/m²K.`, 'Typical envelope values range from 0.10 to 6.00 W/m²K.');
    }
  };

  for (const e of els) {
    if (e.type === 'wall') { positive(e, 'height', e.height); positive(e, 'thickness', e.thickness); uValueOk(e); }
    if (e.type === 'roof' || e.type === 'slab') { positive(e, 'thickness', e.thickness); uValueOk(e); }
  }

  const openings = els.filter((e): e is OpeningElement => e.type === 'opening');
  for (const o of openings) {
    const w = m.elements[o.hostWallId];
    if (!w || w.type !== 'wall') {
      add('error', 'missing-host', o, ['offset'], `Host wall ${o.hostWallId} does not exist.`, 'Delete this opening; it cannot be placed without a host wall.');
      continue;
    }
    positive(o, 'width', o.width); positive(o, 'height', o.height); uValueOk(o);
    if (!(o.sillHeight >= 0)) add('error', 'dimension', o, ['sillHeight'], 'Sill height cannot be negative.', 'Enter 0.00 m or more.');
    checkPlacement(o, w, add);
  }

  const byHost = new Map<string, OpeningElement[]>();
  for (const o of openings) byHost.set(o.hostWallId, [...(byHost.get(o.hostWallId) ?? []), o]);
  for (const list of byHost.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!, b = list[j]!;
      const h = Math.min(a.offset + a.width, b.offset + b.width) - Math.max(a.offset, b.offset);
      const v = Math.min(a.sillHeight + a.height, b.sillHeight + b.height) - Math.max(a.sillHeight, b.sillHeight);
      if (h > EPS && v > EPS) {
        add('error', 'overlap', a, ['offset', 'width'], `Overlaps ${b.name} (${b.id}) by ${f2(h)} m.`, 'Move or resize one of the openings so they no longer intersect.', b.id);
      }
    }
  }

  checkStoreyLevels(m, els, add);
  return out;
}

type Add = (severity: Severity, code: IssueCode, e: BuildingElement, fields: NumericField[], message: string, hint: string, relatedId?: string) => void;

function checkPlacement(o: OpeningElement, w: WallElement, add: Add) {
  const L = wallLength(w), host = `${w.name} (${w.id})`;
  if (o.offset < -EPS) {
    add('error', 'out-of-bounds', o, ['offset'], `Starts ${f2(-o.offset)} m before the start of ${host}.`, 'Offset must be 0.00 m or more.', w.id);
  } else if (o.offset + o.width > L + EPS) {
    add('error', 'out-of-bounds', o, ['width', 'offset'], `Extends ${f2(o.offset + o.width - L)} m beyond the end of ${host}.`, `Max width at offset ${f2(o.offset)} m: ${f2(Math.max(0, L - o.offset))} m.`, w.id);
  } else if (o.width > 0 && (o.offset < w.thickness - EPS || o.offset + o.width > L - w.thickness + EPS)) {
    // The adjoining wall occupies the first/last `thickness` metres of the exterior face run.
    add('warning', 'corner', o, ['offset', 'width'], `Edge lies inside the ${f2(w.thickness, 3)} m corner zone where the adjoining wall meets.`, `Keep the opening between ${f2(w.thickness, 3)} m and ${f2(L - w.thickness, 3)} m along the wall.`, w.id);
  }
  if (o.sillHeight + o.height > w.height + EPS) {
    add('error', 'above-wall', o, ['height', 'sillHeight'], `Top edge at ${f2(o.sillHeight + o.height)} m is above the ${f2(w.height)} m wall height.`, `Max height at sill ${f2(o.sillHeight)} m: ${f2(Math.max(0, w.height - o.sillHeight))} m.`, w.id);
  }
}

function checkStoreyLevels(m: BuildingModel, els: BuildingElement[], add: Add) {
  const wallsOf = (id: string) => els.filter((e): e is WallElement => e.type === 'wall' && e.storeyId === id);
  m.storeys.forEach((s, i) => {
    const ws = wallsOf(s.id);
    if (!ws.length) return;
    const next = m.storeys[i + 1];
    if (next) {
      const above = wallsOf(next.id);
      if (!above.length) return;
      const base = Math.min(...above.map((w) => w.start[2]));
      for (const w of ws) {
        const top = w.start[2] + w.height, d = top - base;
        if (Math.abs(d) > EPS) {
          add('warning', 'storey-level', w, ['height'], `Top at ${f2(top)} m ${d < 0 ? `leaves a ${f2(-d)} m gap below` : `overlaps by ${f2(d)} m`} the ${next.name.toLowerCase()} at ${f2(base)} m.`, `Use the same height for every wall on this storey (${f2(base - w.start[2])} m).`);
        }
      }
    } else {
      const eave = Math.max(...ws.map((w) => w.start[2] + w.height));
      for (const w of ws) {
        const d = eave - (w.start[2] + w.height);
        if (d > EPS) add('warning', 'storey-level', w, ['height'], `Top is ${f2(d)} m below the roof eave at ${f2(eave)} m.`, 'Match the other walls on this storey to close the gap.');
      }
    }
  });
}

export interface EditResult {
  /** Model with the edited element in place — committed only if not blocked. */
  candidate: BuildingModel;
  /** Issues on the element or caused by it on related elements. */
  issues: Issue[];
  /** True when the edit introduces an error the current model does not have. */
  blocked: boolean;
}

const issueKey = (i: Issue) => `${i.code}|${i.elementId}|${i.relatedId ?? ''}`;

/** Validates a proposed element replacement/insertion without mutating `m`. */
export function proposeEdit(m: BuildingModel, el: BuildingElement): EditResult {
  const candidate: BuildingModel = { ...m, elements: { ...m.elements, [el.id]: el } };
  const issues = validate(candidate).filter((i) => i.elementId === el.id || i.relatedId === el.id);
  const existing = new Set(validate(m).filter((i) => i.severity === 'error').map(issueKey));
  return { candidate, issues, blocked: issues.some((i) => i.severity === 'error' && !existing.has(issueKey(i))) };
}
