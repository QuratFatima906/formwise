import { kindOf } from './domain/model';
import { f2 } from './domain/validate';
import { heatLossSummary } from './domain/geometry';
import { MAX_IMPORT_BYTES, type ImportResult } from './importFile';
import { useEditor } from './store';

interface Props {
  fileName: string;
  /** null while the file is being read. */
  result: ImportResult | null;
  onClose: () => void;
}

export function ImportDialog({ fileName, result, onClose }: Props) {
  const unsaved = useEditor((s) => s.model !== s.saved);
  const confirm = () => {
    if (result?.ok) useEditor.getState().importModel(result.model, fileName);
    onClose();
  };

  return (
    <div
      className="backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation(); // keep the editor's Esc (revert/deselect) out of it
        onClose();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="dialog-head">
          <div className="grow" style={{ minWidth: 0 }}>
            <div id="import-title" style={{ fontSize: 14, fontWeight: 600 }}>Open project</div>
            <div className="mono" style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close" style={{ width: 26, height: 26 }}>✕</button>
        </div>

        <div style={{ padding: '12px 16px' }}>
          {!result && <div className="viewport-overlay" style={{ position: 'static', padding: '16px 0' }}><span className="spinner" /> Reading file…</div>}
          {result && !result.ok && (
            <div className="notice error" role="alert" style={{ marginTop: 0 }}>
              Not opened. {result.error}
              <div className="notice-hint">Accepted: Formwise project files (.formwise.json, JSON, UTF-8, up to {MAX_IMPORT_BYTES / 1024 / 1024} MB).</div>
            </div>
          )}
          {result?.ok && <Summary result={result} unsaved={unsaved} />}
        </div>

        <div className="dialog-foot">
          <button className="btn" onClick={onClose} autoFocus={!result?.ok}>{result?.ok ? 'Cancel' : 'Close'}</button>
          {result?.ok && <button className="btn primary" onClick={confirm} autoFocus>Replace current model</button>}
        </div>
      </div>
    </div>
  );
}

function Summary({ result, unsaved }: { result: Extract<ImportResult, { ok: true }>; unsaved: boolean }) {
  const { model, issues, warnings } = result;
  const els = Object.values(model.elements);
  const count = (k: string) => els.filter((e) => kindOf(e) === k).length;
  const rows: [string, string][] = [
    ['Project', model.name],
    ['Storeys', String(model.storeys.length)],
    ['Walls · windows · doors', `${count('wall')} · ${count('window')} · ${count('door')}`],
    ['Roof faces · slabs', `${count('roof')} · ${count('slab')}`],
    ['H_T (simplified)', `${f2(heatLossSummary(model).total, 1)} W/K`],
  ];
  return (
    <>
      {rows.map(([k, v]) => <div key={k} className="kv" style={{ padding: '3px 0' }}><span>{k}</span><span className="value">{v}</span></div>)}
      {issues > 0 && <div className="notice warn">{issues} validation issue{issues > 1 ? 's' : ''} — listed in the Validation panel after opening.</div>}
      {warnings.map((w) => <div key={w} className="notice warn">{w}</div>)}
      {unsaved && <div className="notice warn">The current model has unsaved changes; they will be discarded.</div>}
    </>
  );
}
