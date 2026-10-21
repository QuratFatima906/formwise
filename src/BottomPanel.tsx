import type { BuildingModel } from './domain/model';
import { heatLossSummary } from './domain/geometry';
import { f2, validate, type Issue } from './domain/validate';
import { KIND_COLOR } from './scene';
import { currentDraft, useEditor } from './store';

const CHECKS = 'Positive dimensions · U-values · host references · within host wall · no overlaps · corner clearance · storey alignment';

export function BottomPanel({ baseline }: { baseline?: BuildingModel }) {
  const model = useEditor((s) => s.model);
  const draft = useEditor((s) => s.draft);
  const selectedId = useEditor((s) => s.selectedId);
  const open = useEditor((s) => s.bottomOpen);
  const d = useEditor(currentDraft);
  const { select, toggleBottom } = useEditor.getState();

  const committed = validate(model);
  const pending = draft && d ? d.issues : [];
  const all = [...committed, ...pending];
  const errors = all.filter((i) => i.severity === 'error').length, warnings = all.length - errors;

  const sum = heatLossSummary(model);
  const delta = baseline ? sum.total - heatLossSummary(baseline).total : 0;

  const issueRow = (i: Issue, isPending: boolean, n: number) => {
    const el = (d?.candidate ?? model).elements[i.elementId];
    const err = i.severity === 'error';
    return (
      <button key={`${isPending ? 'p' : 'c'}${n}`} className={`v-issue clickable-row${i.elementId === selectedId ? ' current' : ''}`} onClick={() => select(i.elementId)}>
        <span className={`v-icon ${err ? 'error' : 'warn'}`} aria-label={i.severity}>{err ? '×' : '!'}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5 }}><span style={{ fontWeight: 600 }}>{el?.name ?? i.elementId}</span> — {i.message}</div>
          <div className="v-sub">{i.hint}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isPending && <span className="tag" style={{ fontSize: 10.5, lineHeight: '16px' }}>Pending edit</span>}
          <span className="mono link" style={{ fontSize: 11 }}>{i.elementId}</span>
        </div>
      </button>
    );
  };

  return (
    <section className="bottom" data-screen-label="Validation and summary" style={{ height: open ? 236 : 31 }}>
      <div className="bottom-col">
        <div className="bottom-head">
          <span className="eyebrow">Validation</span>
          {errors > 0 && <span className="badge error">{errors} error{errors > 1 ? 's' : ''}</span>}
          {warnings > 0 && <span className="badge warn">{warnings} warning{warnings > 1 ? 's' : ''}</span>}
          {!all.length && <span className="badge ok">No issues</span>}
        </div>
        {open && (
          <div className="scroll">
            {pending.length > 0 && (
              <>
                <div className="v-group">Pending edit on {draft!.base.id} — not applied to the model</div>
                {pending.map((i, n) => issueRow(i, true, n))}
              </>
            )}
            {committed.length > 0 ? (
              <>
                <div className="v-group">Model</div>
                {committed.map((i, n) => issueRow(i, false, n))}
              </>
            ) : (
              <div className="v-ok">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#2f7a4b" strokeWidth="1.6" style={{ flex: 'none', marginTop: 1 }}><path d="M3 7.5l2.5 2.5L11 4" /></svg>
                <div><div style={{ fontSize: 12.5 }}>Model passes all 7 geometry checks</div><div className="v-sub muted">{CHECKS}</div></div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bottom-col">
        <div className="bottom-head">
          <span className="eyebrow">Heat-loss summary</span>
          <span className="grow" />
          <span className="mono" style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>H<sub>T</sub> {f2(sum.total, 1)} W/K</span>
          <button className="icon-btn" onClick={toggleBottom} title={open ? 'Collapse panel' : 'Expand panel'} aria-expanded={open}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" style={{ transform: `rotate(${open ? 0 : 180}deg)`, transition: 'transform 160ms var(--ease-out)' }}><path d="M3 4.5l3 3 3-3" /></svg>
          </button>
        </div>
        {open && (
          <div className="sum-body">
            <div className="sum-row head"><span>Element</span><span>n</span><span>A m²</span><span>U·A W/K</span></div>
            {sum.groups.map((g) => (
              <div key={g.kind} className="sum-row">
                <span><span className="swatch" style={{ background: KIND_COLOR[g.kind] }} />{g.label}</span>
                <span style={{ color: 'var(--muted)' }}>{g.count}</span><span>{f2(g.area)}</span><span>{f2(g.ua, 1)}</span>
              </div>
            ))}
            <div className="sum-row total">
              <span><span>H<sub>T</sub> = Σ(U·A)</span></span><span /><span>{f2(sum.area)}</span><span>{f2(sum.total, 1)}</span>
            </div>
            <div className={`mono ${delta < 0 ? 'tone-ok' : 'tone-error'}`} style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 11.5, minHeight: 16 }}>
              {Math.abs(delta) > 0.05 ? `${delta > 0 ? '+' : '−'}${f2(Math.abs(delta), 1)} W/K vs. last save` : ''}
            </div>
            <div className="disclaimer">Simplified estimate — not an official GEG/DIN V 18599 calculation. No thermal-bridge surcharge.</div>
          </div>
        )}
      </div>
    </section>
  );
}
