import { useEffect, useRef } from 'react';
import type { BuildingModel, ElementKind } from './domain/model';
import { kindOf } from './domain/model';
import { heatLossSummary, openingsOf, storeyBounds } from './domain/geometry';
import { f2, validate } from './domain/validate';
import { KIND_COLOR, ACCENT } from './scene';
import { useEditor } from './store';
import { Viewport, type ViewportApi } from './Viewport';

export function App() {
  const model = useEditor((s) => s.model);
  const viewport = useRef<ViewportApi>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== 'checkbox') return;
      if (e.key === 'f' || e.key === 'F') viewport.current?.fit();
      if (e.key === 'Escape') useEditor.getState().select(null);
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
          <span className="tag">Bundled sample</span>
        </header>
        <div className="workspace">
          <ModelTree />
          <main className="center">
            <Viewport ref={viewport} model={model} ghost={null} />
          </main>
          <aside className="panel panel-right" data-screen-label="Inspector">
            <div className="panel-head"><span className="eyebrow">Inspector</span></div>
            <BuildingOverview model={model} />
          </aside>
        </div>
        <StatusBar />
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
        <div className="insp-sub">{model.storeys.length} storeys · hipped roof · bundled fixture</div>
      </div>
      <div style={{ padding: '8px 0' }}>
        {rows.map(([k, v]) => <div key={k} className="kv" style={{ padding: '4px 14px' }}><span>{k}</span><span className="value">{v}</span></div>)}
      </div>
      <div className="hint-box">Select a wall, opening, roof face or slab in the viewport or model tree to inspect and edit it.</div>
    </div>
  );
}

function StatusBar() {
  const model = useEditor((s) => s.model);
  const selectedId = useEditor((s) => s.selectedId);
  const hoverId = useEditor((s) => s.hoverId);
  const sel = selectedId ? model.elements[selectedId] : undefined;
  return (
    <footer className="statusbar">
      <span style={{ color: 'var(--text)' }}>{sel ? `Selected: ${sel.id} · ${sel.name}` : 'No selection'}</span>
      {hoverId && hoverId !== selectedId && <span className="muted">Hover: {hoverId}</span>}
      <span className="grow" />
      <span>Drag: orbit · Right-drag / Shift: pan · Scroll: zoom · F: fit · Esc: deselect</span>
      <span className="sep" />
      <span className="mono" style={{ fontSize: 11 }}>m · m² · W/m²K · W/K</span>
    </footer>
  );
}
