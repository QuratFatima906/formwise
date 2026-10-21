import { useEffect, useRef, useState } from 'react';
import type { BuildingModel, ElementKind } from './domain/model';
import { kindOf } from './domain/model';
import { heatLossSummary, openingsOf, storeyBounds } from './domain/geometry';
import { f2, validate } from './domain/validate';
import { KIND_COLOR, ACCENT } from './scene';
import { currentDraft, useEditor } from './store';
import { Viewport, type ViewportApi } from './Viewport';
import { Inspector } from './Inspector';
import { BottomPanel } from './BottomPanel';
import { ExportDialog } from './ExportDialog';
import { ImportDialog } from './ImportDialog';
import { ACCEPT, readImportFile, type ImportResult } from './importFile';

export function App() {
  const model = useEditor((s) => s.model);
  const selectedId = useEditor((s) => s.selectedId);
  const draft = useEditor((s) => s.draft);
  const saved = useEditor((s) => s.saved);
  const source = useEditor((s) => s.source);
  const exportOpen = useEditor((s) => s.exportOpen);
  const d = useEditor(currentDraft);
  const viewport = useRef<ViewportApi>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [opening, setOpening] = useState<{ name: string; result: ImportResult | null } | null>(null);
  const openFile = async (file: File) => {
    setOpening({ name: file.name, result: null });
    const result = await readImportFile(file);
    setOpening((o) => (o?.name === file.name ? { name: file.name, result } : o));
  };
  // The viewport previews a valid draft; an invalid one shows the last valid model plus a ghost outline.
  const view = d && !d.blocked ? d.candidate : model;
  const preview = draft && d?.dirty ? d : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useEditor.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        s.save();
        return;
      }
      if (e.target instanceof HTMLInputElement && e.target.type !== 'checkbox') return;
      if (e.key === 'Escape') {
        if (s.exportOpen) s.setExportOpen(false);
        else if (s.draft) s.revert();
        else s.select(null);
      }
      if (s.exportOpen) return;
      if (e.key === 'f' || e.key === 'F') viewport.current?.fit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <div className="app">
        <header className="topbar" data-screen-label="Top bar">
          <div className="brand"><span className="brand-mark" />Formwise</div>
          <span className="divider" />
          <span style={{ fontWeight: 500 }}>{model.name}</span>
          <span className="tag">{source}</span>
          <SaveStatus />
          <span className="grow" />
          <button className="text-btn" style={{ fontSize: 12 }} onClick={useEditor.getState().resetToSample} title="Replace the current model with the bundled sample (not saved until you save)">
            Reset to sample
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void openFile(f);
            }}
          />
          <button className="btn" onClick={() => fileInput.current?.click()} title="Open a Formwise project file (.formwise.json, max 1 MB)">Open…</button>
          <SaveButton />
          <button className="btn primary" onClick={() => useEditor.getState().setExportOpen(true)}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M7 2v7M4 6l3 3 3-3M2 11h10" /></svg>
            Export
          </button>
        </header>
        <div className="workspace">
          <ModelTree />
          <main className="center">
            <Viewport ref={viewport} model={view} ghost={d?.ghost ?? null}>
              {preview && (
                <div className={`preview-pill ${preview.blocked ? 'bad' : 'ok'}`} role="status">
                  <span className="dot" style={{ background: preview.blocked ? 'var(--error-dot)' : 'var(--accent)' }} />
                  {preview.blocked ? 'Invalid edit — showing last valid geometry' : 'Previewing edit — not applied'}
                </div>
              )}
            </Viewport>
            <BottomPanel baseline={saved ?? undefined} />
          </main>
          <aside className="panel panel-right" data-screen-label="Inspector">
            <div className="panel-head"><span className="eyebrow">Inspector</span></div>
            {selectedId || draft ? <Inspector /> : <BuildingOverview model={model} />}
          </aside>
        </div>
        <StatusBar />
        {exportOpen && <ExportDialog />}
        {opening && <ImportDialog fileName={opening.name} result={opening.result} onClose={() => setOpening(null)} />}
      </div>
      <div className="narrow-notice">
        <div style={{ maxWidth: 360 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Formwise needs a desktop window</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 6 }}>
            The editor is designed for 1280 px and wider. Widen the window or open Formwise on a desktop browser to inspect and edit the model.
          </div>
        </div>
      </div>
    </>
  );
}

const LEGEND: [string, string][] = [
  ['Wall', KIND_COLOR.wall], ['Window', KIND_COLOR.window], ['Door', KIND_COLOR.door],
  ['Roof face', KIND_COLOR.roof], ['Slab', KIND_COLOR.slab], ['Selected', ACCENT],
];

interface Row {
  key: string;
  depth: number;
  label: string;
  meta: string;
  id?: string;
  kind?: ElementKind;
  open?: boolean;
  dot?: 'error' | 'warning';
}

function ModelTree() {
  const model = useEditor((s) => s.model);
  const selectedId = useEditor((s) => s.selectedId);
  const expanded = useEditor((s) => s.expanded);
  const { select, toggleNode } = useEditor.getState();

  const severity: Record<string, 'error' | 'warning'> = {};
  for (const i of validate(model)) if (severity[i.elementId] !== 'error') severity[i.elementId] = i.severity;
  const isOpen = (key: string, fallback: boolean) => expanded[key] ?? fallback;

  const els = Object.values(model.elements);
  const rows: Row[] = [];
  const elRow = (id: string, depth: number, open?: boolean): Row => {
    const e = model.elements[id]!;
    return { key: id, depth, label: e.name, meta: id, id, kind: kindOf(e), open, dot: severity[id] };
  };
  const buildingOpen = isOpen('b', true);
  rows.push({ key: 'b', depth: 0, label: model.name, meta: 'Building', open: buildingOpen });
  if (buildingOpen) {
    for (const st of model.storeys) {
      const sk = `st-${st.id}`, so = isOpen(sk, true);
      rows.push({ key: sk, depth: 1, label: `${st.name} · ${st.id}`, meta: `+${f2(st.elevation)} m`, open: so });
      if (!so) continue;
      const groups: [string, string, ElementKind][] = [['gw-', 'Walls', 'wall'], ['gr-', 'Roof', 'roof'], ['gs-', 'Slab', 'slab']];
      for (const [prefix, label, type] of groups) {
        const xs = els.filter((e) => e.type === type && e.storeyId === st.id);
        if (!xs.length) continue;
        const gk = prefix + st.id, go = isOpen(gk, true);
        rows.push({ key: gk, depth: 2, label, meta: String(xs.length), open: go });
        if (!go) continue;
        for (const x of xs) {
          const os = x.type === 'wall' ? openingsOf(model, x.id) : [];
          const wo = isOpen(x.id, false);
          rows.push(elRow(x.id, 3, os.length ? wo : undefined));
          if (wo) os.forEach((o) => rows.push(elRow(o.id, 4)));
        }
      }
    }
  }

  return (
    <aside className="panel panel-left" data-screen-label="Model tree">
      <div className="panel-head">
        <span className="eyebrow">Model</span>
        <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>{els.length} elements</span>
      </div>
      <div className="scroll tree" role="tree">
        {rows.map((r) => {
          const toggle = () => r.open !== undefined && toggleNode(r.key, r.open);
          const sel = r.id === selectedId;
          return (
            <div
              key={r.key}
              role="treeitem"
              aria-selected={sel}
              aria-expanded={r.open}
              className={`tree-row${sel ? ' selected' : ''}`}
              style={{ paddingLeft: 6 + r.depth * 14 }}
              onClick={() => (r.id ? select(r.id) : toggle())}
            >
              <button className="chev" tabIndex={-1} aria-hidden onClick={(e) => { e.stopPropagation(); toggle(); }}>
                {r.open !== undefined && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" style={{ transform: `rotate(${r.open ? 90 : 0}deg)` }}><path d="M3.5 2l3 3-3 3" /></svg>
                )}
              </button>
              {r.kind && <span className="swatch" style={{ background: KIND_COLOR[r.kind] }} />}
              <span className="label" style={{ fontWeight: sel || !r.id ? 500 : 400, color: r.id ? undefined : 'var(--text-2)' }}>{r.label}</span>
              {r.dot && <span className="dot" style={{ width: 6, height: 6, background: r.dot === 'error' ? 'var(--error-dot)' : 'var(--warn-dot)' }} />}
              <span className="meta">{r.meta}</span>
            </div>
          );
        })}
      </div>
      <div className="legend">
        {LEGEND.map(([label, c]) => <div key={label}><span className="swatch" style={{ background: c }} />{label}</div>)}
      </div>
    </aside>
  );
}

function BuildingOverview({ model }: { model: BuildingModel }) {
  const source = useEditor((s) => s.source);
  const els = Object.values(model.elements);
  const count = (k: ElementKind) => els.filter((e) => kindOf(e) === k).length;
  const b = storeyBounds(model, model.storeys[0]!.id);
  const s = heatLossSummary(model);
  const rows: [string, string][] = [
    ['Storeys', model.storeys.map((st) => `${st.id} +${f2(st.elevation)} m`).join(' · ')],
    ['Footprint', b ? `${f2(b.x1 - b.x0)} × ${f2(b.y1 - b.y0)} m` : '—'],
    ['Walls', String(count('wall'))],
    ['Windows · doors', `${count('window')} · ${count('door')}`],
    ['Roof faces', String(count('roof'))],
    ['Envelope area', `${f2(s.area)} m²`],
    ['H_T (simplified)', `${f2(s.total, 1)} W/K`],
  ];
  return (
    <div className="scroll">
      <div className="insp-head">
        <div className="eyebrow">Building</div>
        <div className="insp-title">{model.name}</div>
        <div className="insp-sub">{model.storeys.length} storey{model.storeys.length > 1 ? 's' : ''} · {source}</div>
      </div>
      <div style={{ padding: '8px 0' }}>
        {rows.map(([k, v]) => <div key={k} className="kv" style={{ padding: '4px 14px' }}><span>{k}</span><span className="value">{v}</span></div>)}
      </div>
      <div className="hint-box">Select a wall, opening, roof face or slab in the viewport or model tree to inspect and edit it.</div>
    </div>
  );
}

function SaveStatus() {
  const model = useEditor((s) => s.model);
  const saved = useEditor((s) => s.saved);
  const savedAt = useEditor((s) => s.savedAt);
  const saveError = useEditor((s) => s.saveError);
  const save = useEditor((s) => s.save);
  const [label, tone, dot] = saveError
    ? ['Save failed', 'var(--error)', 'var(--error-dot)']
    : model === saved
      ? [savedAt ? `Saved ${savedAt}` : 'Saved', 'var(--muted)', 'var(--ok-dot)']
      : [saved ? 'Unsaved changes' : 'Not saved yet', 'var(--warn)', 'var(--warn-dot)'];
  return (
    <div className="save-status" style={{ color: tone }} title={saveError} role="status">
      <span className="dot" style={{ background: dot }} />
      {label}
      {saveError && <button className="text-btn" style={{ fontSize: 12, textDecoration: 'underline' }} onClick={save}>Retry</button>}
    </div>
  );
}

function SaveButton() {
  const clean = useEditor((s) => s.model === s.saved);
  return (
    <button className="btn" onClick={useEditor.getState().save} disabled={clean} title={clean ? 'No unsaved changes' : 'Save to this browser (⌘S)'}>
      Save <span className="kbd">⌘S</span>
    </button>
  );
}

function StatusBar() {
  const model = useEditor((s) => s.model);
  const selectedId = useEditor((s) => s.selectedId);
  const hoverId = useEditor((s) => s.hoverId);
  const draft = useEditor((s) => s.draft);
  const note = useEditor((s) => s.note);
  const sel = draft?.base ?? (selectedId ? model.elements[selectedId] : undefined);
  return (
    <footer className="statusbar">
      <span style={{ color: 'var(--text)' }}>{sel ? `Selected: ${sel.id} · ${sel.name}` : 'No selection'}</span>
      {hoverId && hoverId !== selectedId && <span className="muted">Hover: {hoverId}</span>}
      {note && <span className={`tone-${note.tone}`} role="status">{note.text}</span>}
      <span className="grow" />
      <span>Drag: orbit · Right-drag / Shift: pan · Scroll: zoom · F: fit · Esc: revert / deselect</span>
      <span className="sep" />
      <span className="mono" style={{ fontSize: 11 }}>m · m² · W/m²K · W/K</span>
    </footer>
  );
}
