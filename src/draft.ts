import type { BuildingElement, BuildingModel, NumericField, OpeningElement, OpeningType } from './domain/model';
import { editableFields } from './domain/model';
import { EPS, openingsOf, wallLength } from './domain/geometry';
import { f2, FIELD_META, proposeEdit, type Issue } from './domain/validate';

/** Uncommitted inspector edit. Values stay raw strings until applied. */
export interface Draft {
  /** Element as it was when editing started (or the new opening). */
  base: BuildingElement;
  isNew: boolean;
  values: Partial<Record<NumericField, string>>;
  openingType?: OpeningType;
  /** Edited fields, most recent first — issues attach to these first. */
  order: NumericField[];
}

export interface FieldMessage {
  severity: Issue['severity'];
  message: string;
  hint: string;
}

export interface DraftResult {
  element: BuildingElement;
  candidate: BuildingModel;
  issues: Issue[];
  fieldMessages: Partial<Record<NumericField, FieldMessage>>;
  blocked: boolean;
  dirty: boolean;
  changes: (NumericField | 'openingType')[];
  /** Outline of a blocked opening edit, drawn over the last valid geometry. */
  ghost: OpeningElement | null;
}

/** Accepts "1.6" and "1,6"; returns null for anything that is not a finite number. */
export function parseDecimal(raw: string): number | null {
  const t = raw.trim().replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  return Number(t);
}

export function evaluateDraft(model: BuildingModel, draft: Draft): DraftResult {
  const el = { ...draft.base } as BuildingElement & Record<string, unknown>;
  const fields = editableFields(draft.base);
  const changes: DraftResult['changes'] = [];
  const parseErrors: Partial<Record<NumericField, FieldMessage>> = {};

  for (const k of fields) {
    const raw = draft.values[k];
    if (raw === undefined) continue;
    const v = parseDecimal(raw);
    if (v === null) {
      parseErrors[k] = { severity: 'error', message: `Enter a number in ${FIELD_META[k].unit}.`, hint: '' };
      continue;
    }
    el[k] = v;
    if (Math.abs(v - (draft.base as unknown as Record<string, number>)[k]!) > EPS) changes.push(k);
  }
  if (el.type === 'opening' && draft.openingType && draft.base.type === 'opening') {
    el.openingType = draft.openingType;
    if (draft.openingType !== draft.base.openingType) changes.push('openingType');
  }

  const { candidate, issues, blocked: invalid } = proposeEdit(model, el);
  const fieldMessages: DraftResult['fieldMessages'] = {};
  for (const i of issues) {
    const f = i.fields.find((x) => draft.order.includes(x) && fields.includes(x)) ?? i.fields.find((x) => fields.includes(x)) ?? fields[0]!;
    const related = i.elementId !== el.id ? model.elements[i.elementId] : undefined;
    const message = related ? `${related.name} (${related.id}): ${i.message}` : i.message;
    const prev = fieldMessages[f];
    if (!prev || (i.severity === 'error' && prev.severity !== 'error')) fieldMessages[f] = { severity: i.severity, message, hint: i.hint };
  }
  Object.assign(fieldMessages, parseErrors);

  const hasParseErrors = Object.keys(parseErrors).length > 0;
  const blocked = hasParseErrors || invalid;
  const ghost = blocked && !hasParseErrors && el.type === 'opening' && el.width > 0 && el.height > 0 ? el : null;
  return { element: el, candidate, issues, fieldMessages, blocked, dirty: draft.isNew || changes.length > 0, changes, ghost };
}

/** Human-readable change list, e.g. "Width 1.20 → 1.60 m". */
export function describeChanges(base: BuildingElement, el: BuildingElement, changes: DraftResult['changes']): string {
  const num = (e: BuildingElement, k: NumericField) => (e as unknown as Record<string, number>)[k]!;
  return changes
    .map((k) => {
      if (k === 'openingType') return `Type → ${el.type === 'opening' ? el.openingType : ''}`;
      const { label, unit, decimals } = FIELD_META[k];
      return `${label} ${f2(num(base, k), decimals)} → ${f2(num(el, k), decimals)} ${unit}`;
    })
    .join(', ');
}

/**
 * Proposes a default 1.00 × 1.40 m window for a wall: the first gap of at
 * least 1.00 m (plus 0.30 m clearance) between existing openings, outside the
 * corner zones. Falls back to the first position after the corner zone, which
 * validation will then flag if it collides.
 */
export function newOpeningFor(model: BuildingModel, wallId: string): OpeningElement | null {
  const w = model.elements[wallId];
  if (!w || w.type !== 'wall') return null;
  const L = wallLength(w), width = 1.0, gap = 0.3;
  let cursor = w.thickness + gap, offset: number | null = null;
  for (const o of openingsOf(model, w.id)) {
    if (o.offset - gap - cursor >= width) { offset = cursor; break; }
    cursor = Math.max(cursor, o.offset + o.width + gap);
  }
  if (offset === null && L - w.thickness - gap - cursor >= width) offset = cursor;
  offset ??= w.thickness + gap;

  const n = Math.max(0, ...Object.keys(model.elements).filter((k) => k.startsWith('WN-')).map((k) => Number(k.slice(3)) || 0)) + 1;
  const id = `WN-${String(n).padStart(2, '0')}`;
  return {
    id, type: 'opening', storeyId: w.storeyId, name: `Window ${id.slice(3)}`, hostWallId: w.id, openingType: 'window',
    offset: Math.round(offset * 100) / 100, width, height: 1.4, sillHeight: 0.9, uValue: 2.8,
  };
}
