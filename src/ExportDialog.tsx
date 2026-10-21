import { useState } from 'react';
import { heatLossSummary } from './domain/geometry';
import { f2 } from './domain/validate';
import { download, modelGlb, summaryCsv, summaryJson } from './export';
import { currentDraft, useEditor } from './store';

type Format = 'glb' | 'csv' | 'json';
interface Written { name: string; ok: boolean; size: string; detail: string }

const OPTIONS: { key: Format; label: string; desc: string }[] = [
  { key: 'glb', label: 'glTF 2.0 scene', desc: 'Model geometry. Meshes named by element ID; type stored in extras.' },
  { key: 'csv', label: 'Summary table', desc: 'One row per envelope element: type, ID, storey, area, U-value, U·A.' },
  { key: 'json', label: 'Summary data', desc: 'Same rows plus units, method note and totals.' },
];
const BASE = 'formwise-sample-house';
const fileName = (f: Format) => (f === 'glb' ? `${BASE}.glb` : `${BASE}-summary.${f}`);
const size = (b: Blob) => (b.size < 1024 ? `${b.size} B` : `${(b.size / 1024).toFixed(1)} KB`);

export function ExportDialog() {
  const model = useEditor((s) => s.model);
  const draft = useEditor((s) => s.draft);
  const d = useEditor(currentDraft);
  const close = () => useEditor.getState().setExportOpen(false);
  const [sel, setSel] = useState<Record<Format, boolean>>({ glb: true, csv: true, json: false });
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [written, setWritten] = useState<Written[]>([]);
  const sum = heatLossSummary(model);
  const chosen = OPTIONS.filter((o) => sel[o.key]).map((o) => o.key);

  const run = async () => {
    setPhase('running');
    const out: Written[] = [];
    for (const f of chosen) {
      try {
        const blob =
          f === 'glb' ? new Blob([await modelGlb(model)], { type: 'model/gltf-binary' })
          : f === 'csv' ? new Blob([summaryCsv(model)], { type: 'text/csv' })
          : new Blob([summaryJson(model, new Date())], { type: 'application/json' });
        download(fileName(f), blob);
        const detail = f === 'glb' ? `${Object.keys(model.elements).length} elements · names = element IDs`
          : f === 'csv' ? `${sum.rows.length} rows + total · H_T ${f2(sum.total, 1)} W/K` : 'Elements, units and totals';
        out.push({ name: fileName(f), ok: true, size: size(blob), detail });
      } catch (e) {
        out.push({ name: fileName(f), ok: false, size: '', detail: `Not written: ${(e as Error).message}` });
      }
    }
    setWritten(out);
    setPhase('done');
  };

  const okCount = written.filter((w) => w.ok).length;
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div className="dialog-head">
          <div className="grow">
            <div id="export-title" style={{ fontSize: 14, fontWeight: 600 }}>Export</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Exports the current model, including unsaved changes.</div>
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close" style={{ width: 26, height: 26 }}>✕</button>
        </div>

        {phase === 'idle' && (
          <>
            <div style={{ padding: 8 }}>
              {OPTIONS.map((o) => (
                <label key={o.key} className="option clickable-row">
                  <input type="checkbox" checked={sel[o.key]} onChange={() => setSel((s) => ({ ...s, [o.key]: !s[o.key] }))} />
                  <div><div style={{ fontSize: 12.5, fontWeight: 500 }}>{o.label}</div><div className="v-sub">{o.desc}</div></div>
                  <span className="mono muted" style={{ fontSize: 11 }}>.{o.key}</span>
                </label>
              ))}
            </div>
            <div style={{ margin: '0 16px 12px', padding: '8px 10px', background: 'var(--hover-2)', borderRadius: 4, fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-2)' }}>Totals written to summary</span>
              <span className="mono">A {f2(sum.area)} m² · H_T {f2(sum.total, 1)} W/K</span>
            </div>
            {draft && d?.dirty && (
              <div className="notice warn" style={{ margin: '0 16px 12px' }}>
                The pending edit on {draft.isNew ? 'the new opening' : draft.base.id} is not applied and will not be exported.
              </div>
            )}
          </>
        )}
        {phase === 'running' && (
          <div className="viewport-overlay" style={{ position: 'static', padding: '28px 16px' }}><span className="spinner" /> Writing files…</div>
        )}
        {phase === 'done' && (
          <div style={{ padding: '10px 16px 4px' }}>
            {written.map((w) => (
              <div key={w.name} style={{ display: 'grid', gridTemplateColumns: '16px minmax(0,1fr) auto', gap: 8, alignItems: 'start', padding: '6px 0', borderBottom: '1px solid var(--line-faint)' }}>
                <span className={`v-icon ${w.ok ? '' : 'error'}`} style={{ borderRadius: '50%', background: w.ok ? '#2f7a4b' : undefined }}>{w.ok ? '✓' : '×'}</span>
                <div><div className="mono" style={{ fontSize: 12 }}>{w.name}</div><div className={w.ok ? 'v-sub' : 'v-sub tone-error'}>{w.detail}</div></div>
                <span className="mono muted" style={{ fontSize: 11 }}>{w.size}</span>
              </div>
            ))}
            <div style={{ fontSize: 12, color: 'var(--muted)', padding: '10px 0 8px' }}>
              {okCount === written.length
                ? 'Downloaded to your browser’s download folder. Summary totals match the Heat-loss summary panel.'
                : `${okCount} of ${written.length} files written. Files marked × were not created.`}
            </div>
          </div>
        )}

        <div className="dialog-foot">
          <button className="btn" onClick={close}>{phase === 'done' ? 'Close' : 'Cancel'}</button>
          {phase === 'idle' && (
            <button className="btn primary" onClick={run} disabled={!chosen.length} autoFocus>
              Export {chosen.length} file{chosen.length === 1 ? '' : 's'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
