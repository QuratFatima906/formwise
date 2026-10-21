import type { BuildingElement, BuildingModel, NumericField } from './domain/model';
import { editableFields, kindOf } from './domain/model';
import { envelopeArea, openingsOf, roofEave, wallAreas, wallLength } from './domain/geometry';
import { f2, FIELD_META, validate } from './domain/validate';
import { parseDecimal } from './draft';
import { KIND_COLOR } from './scene';
import { currentDraft, useEditor } from './store';

const TYPE_LABEL = { wall: 'Wall', window: 'Window', door: 'Door', roof: 'Roof face', slab: 'Slab' } as const;
const FIELD_LABEL: Partial<Record<NumericField, string>> = { offset: 'Offset along wall' };

export function Inspector() {
  const model = useEditor((s) => s.model);
  const selectedId = useEditor((s) => s.selectedId);
  const draft = useEditor((s) => s.draft);
  const lastApplied = useEditor((s) => s.lastApplied);
  const confirmDelete = useEditor((s) => s.confirmDelete);
  const d = useEditor(currentDraft);
  const act = useEditor.getState();

  const base = draft?.base ?? (selectedId ? model.elements[selectedId] : undefined);
  if (!base) return null;
  const isNew = !!draft?.isNew;
  // Derived values follow the proposed edit unless it is invalid; a new opening always previews.
  const shown: BuildingModel = d && (!d.blocked || isNew) ? d.candidate : model;
  const el = shown.elements[base.id] ?? base;
  const committed = model.elements[base.id];
  const kind = kindOf(base);
  const fields = editableFields(base);
  const num = (e: BuildingElement, k: NumericField) => (e as unknown as Record<string, number>)[k]!;
  const storey = model.storeys.find((s) => s.id === base.storeyId);

  return (
    <>
      <div className="insp-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="swatch" style={{ width: 10, height: 10, borderRadius: 2, background: KIND_COLOR[kind] }} />
          <span className="eyebrow">{TYPE_LABEL[kind]}</span>
          <span className="grow" />
          <span className="mono link" style={{ fontSize: 11.5 }}>{base.id}</span>
        </div>
        <div className="insp-title">{base.name}</div>
        <div className="insp-sub">{storey?.name} · {base.storeyId}</div>
        {isNew && <div className="notice info">New opening — previewed only, not in the model until added.</div>}
      </div>

      <div className="scroll" style={{ paddingBottom: 10 }}>
        {base.type === 'opening' && <OpeningHeader />}

        <div className="insp-section" style={{ paddingTop: 12 }}><span className="eyebrow">Properties</span></div>
        {fields.map((f) => {
          const has = draft?.values[f] !== undefined;
          const raw = has ? draft!.values[f]! : f2(num(base, f), FIELD_META[f].decimals);
          const parsed = parseDecimal(raw);
          const modified = has && !isNew && (parsed === null || Math.abs(parsed - num(base, f)) > 1e-6);
          const msg = d?.fieldMessages[f];
          const state = msg?.severity === 'error' ? 'error' : msg ? 'warn' : modified ? 'modified' : '';
          const label = FIELD_LABEL[f] ?? FIELD_META[f].label;
          return (
            <div key={f} className="field">
              <div className="field-row">
                <label htmlFor={`f-${f}`}>{label}{modified && <span className="pending-dot" title="Pending change" />}</label>
                <div className={`field-input ${state}`}>
                  <input
                    id={`f-${f}`}
                    inputMode="decimal"
                    value={raw}
                    aria-invalid={msg?.severity === 'error'}
                    onChange={(e) => act.setField(f, e.target.value)}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') act.apply();
                      if (e.key === 'Escape') { act.revert(); e.currentTarget.blur(); }
                    }}
                  />
                  <span className="unit">{FIELD_META[f].unit}</span>
                </div>
              </div>
              {modified && <div className="field-was">was {f2(num(base, f), FIELD_META[f].decimals)}</div>}
              {msg && (
                <div className={`notice ${msg.severity === 'error' ? 'error' : 'warn'}`} style={{ marginTop: 5 }} role={msg.severity === 'error' ? 'alert' : undefined}>
                  {msg.message}{msg.hint && <div className="notice-hint">{msg.hint}</div>}
                </div>
              )}
              {f === 'offset' && <div className="field-note">From the wall start point — left end, seen from outside.</div>}
            </div>
          );
        })}

        <div className="insp-section" style={{ alignItems: 'baseline' }}>
          <span className="eyebrow">Calculated</span><span className="muted" style={{ fontSize: 11 }}>read-only</span>
        </div>
        {derivedRows(model, shown, el, committed).map((r) => (
          <div key={r.label} className={`kv${r.was !== undefined ? ' changed' : ''}`}>
            <span>{r.label}</span>
            <span className="value">{r.value} <span className="unit">{r.unit}</span>{r.was !== undefined && <span className="was">was {r.was}</span>}</span>
          </div>
        ))}

        {base.type === 'wall' && <WallOpenings model={shown} wallId={base.id} />}

        {!draft && <Checks model={model} id={base.id} />}

        {base.type === 'opening' && !isNew && (
          <div style={{ padding: '18px 14px 0', display: 'flex', gap: 6, alignItems: 'center' }}>
            {confirmDelete ? (
              <>
                <span className="grow" style={{ fontSize: 12, color: 'var(--text-2)' }}>Remove {base.id} and close the wall?</span>
                <button className="btn small" style={{ height: 26 }} onClick={() => act.setConfirmDelete(false)}>Cancel</button>
                <button className="btn small danger" style={{ height: 26 }} onClick={act.deleteOpening} autoFocus>Delete</button>
              </>
            ) : (
              <button className="btn small danger-ghost" style={{ height: 26 }} onClick={() => act.setConfirmDelete(true)}>Delete opening…</button>
            )}
          </div>
        )}
      </div>

      <div className="insp-foot">
        {draft && d?.dirty ? (
          <>
            <span className={`grow ${d.blocked ? 'tone-error' : ''}`}>
              {d.blocked ? 'Fix the highlighted value to apply.' : isNew ? `Ready to add to ${base.type === 'opening' ? model.elements[base.hostWallId]?.name : ''}.` : `${d.changes.length} pending change${d.changes.length > 1 ? 's' : ''}`}
            </span>
            <button className="btn" onClick={act.revert} title="Esc">{isNew ? 'Cancel' : 'Revert'}</button>
            <button className={`btn ${d.blocked ? 'blocked' : 'primary'}`} disabled={d.blocked} onClick={act.apply} title={d.blocked ? 'Resolve errors first' : 'Apply (Enter)'}>
              {isNew ? 'Add opening' : 'Apply'}
            </button>
          </>
        ) : lastApplied?.id === base.id ? (
          <span className="tone-ok">✓ Applied · {lastApplied.text}</span>
        ) : (
          <span className="muted">Edit a value, then Apply or press Enter.</span>
        )}
      </div>
    </>
  );
}

function OpeningHeader() {
  const model = useEditor((s) => s.model);
  const draft = useEditor((s) => s.draft);
  const selectedId = useEditor((s) => s.selectedId);
  const act = useEditor.getState();
  const base = draft?.base ?? model.elements[selectedId ?? ''];
  if (!base || base.type !== 'opening') return null;
  const type = draft?.openingType ?? base.openingType;
  const host = model.elements[base.hostWallId];
  return (
    <>
      <div className="field-row" style={{ padding: '10px 14px 2px' }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>Type</span>
        <div className="segmented inline" role="radiogroup" aria-label="Opening type">
          <button role="radio" aria-checked={type === 'window'} className={type === 'window' ? 'on' : ''} onClick={() => act.setOpeningType('window')}>Window</button>
          <button role="radio" aria-checked={type === 'door'} className={type === 'door' ? 'on' : ''} onClick={() => act.setOpeningType('door')}>Door</button>
        </div>
      </div>
      <div className="kv" style={{ padding: '8px 14px 2px', alignItems: 'center' }}>
        <span style={{ color: 'var(--text-2)' }}>Host wall</span>
        {host ? (
          <button className="text-btn" style={{ fontSize: 12.5, display: 'flex', gap: 6 }} onClick={() => act.select(host.id)}>
            {host.name} <span className="mono" style={{ fontSize: 11 }}>{host.id}</span>
          </button>
        ) : <span className="tone-error">Missing ({base.hostWallId})</span>}
      </div>
    </>
  );
}

interface DerivedRow { label: string; value: string; unit: string; was?: string }

function derivedRows(model: BuildingModel, shown: BuildingModel, el: BuildingElement, committed: BuildingElement | undefined): DerivedRow[] {
  const row = (label: string, value: string, unit: string, before?: string): DerivedRow =>
    ({ label, value, unit, was: before !== undefined && before !== value ? before : undefined });
  const c = committed && committed.type === el.type ? committed : undefined;

  if (el.type === 'wall') {
    const a = wallAreas(shown, el), b = c?.type === 'wall' ? wallAreas(model, c) : undefined;
    return [
      row('Length', f2(wallLength(el)), 'm'),
      ...(el.profile ? [row('Clear height (imported)', f2(el.height), 'm')] : []),
      row('Gross area', f2(a.gross), 'm²', b && f2(b.gross)),
      row(`Openings (${a.openingCount})`, f2(a.openings), 'm²', b && f2(b.openings)),
      row('Net opaque area', f2(a.net), 'm²', b && f2(b.net)),
      row('U · A (net)', f2(a.net * el.uValue), 'W/K', b && c && f2(b.net * c.uValue)),
      row('Start x, y, z', el.start.map((v) => f2(v)).join(', '), 'm'),
      row('End x, y, z', el.end.map((v) => f2(v)).join(', '), 'm'),
    ];
  }
  if (el.type === 'opening') {
    const host = shown.elements[el.hostWallId];
    const L = host?.type === 'wall' ? wallLength(host) : NaN;
    const o = c?.type === 'opening' ? c : undefined;
    return [
      row('Area', f2(el.width * el.height), 'm²', o && f2(o.width * o.height)),
      row('Head height', f2(el.sillHeight + el.height), 'm', o && f2(o.sillHeight + o.height)),
      row('Clear to wall end', f2(L - el.offset - el.width), 'm', o && f2(L - o.offset - o.width)),
      row('U · A', f2(el.width * el.height * el.uValue), 'W/K', o && f2(o.width * o.height * o.uValue)),
    ];
  }
  const a = envelopeArea(shown, el), before = c && f2(envelopeArea(model, c) * c.uValue);
  if (el.type === 'roof') {
    return [row('Area', f2(a), 'm²'), row('Pitch', f2(el.pitch, 0), '°'), row('Eave height', f2(roofEave(shown, el)), 'm'), row('U · A', f2(a * el.uValue), 'W/K', before)];
  }
  return [row('Area (footprint)', f2(a), 'm²'), row('U · A', f2(a * el.uValue), 'W/K', before)];
}

function WallOpenings({ model, wallId }: { model: BuildingModel; wallId: string }) {
  const draft = useEditor((s) => s.draft);
  const act = useEditor.getState();
  const ops = openingsOf(model, wallId);
  return (
    <>
      <div className="insp-section">
        <span className="eyebrow">Openings on this wall</span>
        <button className="btn small" onClick={act.addOpening} disabled={!!draft} title={draft ? 'Apply or revert the pending edit first' : 'Add a window to this wall'}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 1v8M1 5h8" /></svg>Add opening
        </button>
      </div>
      {ops.map((o) => (
        <div key={o.id} className="clickable-row" onClick={() => act.select(o.id)}>
          <span className="swatch" style={{ background: KIND_COLOR[o.openingType] }} />
          <span>{o.name} <span className="mono link" style={{ fontSize: 11 }}>{o.id}</span></span>
          <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>{f2(o.width)} × {f2(o.height)} m</span>
        </div>
      ))}
      {!ops.length && <div className="muted" style={{ padding: '4px 14px', fontSize: 12 }}>No openings.</div>}
    </>
  );
}

function Checks({ model, id }: { model: BuildingModel; id: string }) {
  const issues = validate(model).filter((i) => i.elementId === id);
  return (
    <>
      <div className="insp-section"><span className="eyebrow">Checks</span></div>
      {issues.map((i, n) => (
        <div key={n} className={`notice ${i.severity === 'error' ? 'error' : 'warn'}`} style={{ margin: '2px 14px' }}>
          {i.message}<div className="notice-hint">{i.hint}</div>
        </div>
      ))}
      {!issues.length && (
        <div className="tone-ok" style={{ padding: '2px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 7.5l2.5 2.5L11 4" /></svg>
          All checks pass for this element
        </div>
      )}
    </>
  );
}
