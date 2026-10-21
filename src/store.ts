import { create } from 'zustand';
import type { BuildingModel, NumericField, OpeningType } from './domain/model';
import { sampleHouse } from './domain/model';
import { describeChanges, evaluateDraft, newOpeningFor, type Draft } from './draft';

export type NavMode = 'orbit' | 'pan';
export type Tone = 'ok' | 'warn' | 'error';

interface EditorState {
  model: BuildingModel;
  selectedId: string | null;
  hoverId: string | null;
  draft: Draft | null;
  /** Last applied change for the selected element, shown in the inspector footer. */
  lastApplied: { id: string; text: string } | null;
  confirmDelete: boolean;
  note: { text: string; tone: Tone } | null;
  nav: NavMode;
  /** Model-tree nodes the user explicitly toggled. */
  expanded: Record<string, boolean>;
  bottomOpen: boolean;

  select: (id: string | null) => void;
  setHover: (id: string | null) => void;
  setField: (field: NumericField, raw: string) => void;
  setOpeningType: (t: OpeningType) => void;
  apply: () => void;
  revert: () => void;
  addOpening: () => void;
  setConfirmDelete: (v: boolean) => void;
  deleteOpening: () => void;
  flash: (text: string, tone: Tone) => void;
  setNav: (nav: NavMode) => void;
  toggleNode: (key: string, current: boolean) => void;
  toggleBottom: () => void;
}

let noteTimer: ReturnType<typeof setTimeout> | undefined;

export const useEditor = create<EditorState>()((set, get) => ({
  model: sampleHouse(),
  selectedId: null,
  hoverId: null,
  draft: null,
  lastApplied: null,
  confirmDelete: false,
  note: null,
  nav: 'orbit',
  expanded: {},
  bottomOpen: true,

  select: (id) => {
    const { model, expanded, draft, selectedId } = get();
    if (id === selectedId && !draft?.isNew) return;
    if (draft && evaluateDraft(model, draft).dirty) get().flash(`Discarded pending edit to ${draft.isNew ? 'new opening' : draft.base.id}.`, 'warn');
    const el = id ? model.elements[id] : undefined;
    set({
      selectedId: id, draft: null, confirmDelete: false,
      expanded: el?.type === 'opening' ? { ...expanded, [el.hostWallId]: true } : expanded,
    });
  },
  setHover: (hoverId) => set({ hoverId }),

  setField: (field, raw) => {
    const { draft, model, selectedId } = get();
    const base = draft?.base ?? (selectedId ? model.elements[selectedId] : undefined);
    if (!base) return;
    const d: Draft = draft ?? { base, isNew: false, values: {}, order: [] };
    set({ draft: { ...d, values: { ...d.values, [field]: raw }, order: [field, ...d.order.filter((f) => f !== field)] }, lastApplied: null });
  },
  setOpeningType: (t) => {
    const { draft, model, selectedId } = get();
    const base = draft?.base ?? (selectedId ? model.elements[selectedId] : undefined);
    if (!base || base.type !== 'opening') return;
    set({ draft: { ...(draft ?? { base, isNew: false, values: {}, order: [] }), openingType: t }, lastApplied: null });
  },

  apply: () => {
    const { draft, model, expanded } = get();
    if (!draft) return;
    const r = evaluateDraft(model, draft);
    if (r.blocked || !r.dirty) return;
    const el = r.element;
    const text = draft.isNew && el.type === 'opening'
      ? `Added ${el.id} to ${model.elements[el.hostWallId]?.name.toLowerCase()}`
      : describeChanges(draft.base, el, r.changes);
    set({
      model: r.candidate, draft: null, selectedId: el.id, lastApplied: { id: el.id, text },
      expanded: el.type === 'opening' ? { ...expanded, [el.hostWallId]: true } : expanded,
    });
    get().flash(`Applied · ${text}`, 'ok');
  },
  revert: () => {
    const { draft } = get();
    if (!draft) return;
    set(draft.isNew && draft.base.type === 'opening' ? { draft: null, selectedId: draft.base.hostWallId } : { draft: null });
  },

  addOpening: () => {
    const { model, selectedId, draft } = get();
    if (!selectedId || draft) return;
    const el = newOpeningFor(model, selectedId);
    if (el) set({ draft: { base: el, isNew: true, values: {}, order: [] }, selectedId: el.id, lastApplied: null });
  },
  setConfirmDelete: (confirmDelete) => set({ confirmDelete }),
  deleteOpening: () => {
    const { model, selectedId } = get();
    const e = selectedId ? model.elements[selectedId] : undefined;
    if (!e || e.type !== 'opening') return;
    const elements = { ...model.elements };
    delete elements[e.id];
    set({ model: { ...model, elements }, selectedId: e.hostWallId, draft: null, confirmDelete: false, lastApplied: { id: e.hostWallId, text: `Deleted ${e.id}` } });
    get().flash(`Deleted ${e.id} · ${e.name}`, 'ok');
  },

  flash: (text, tone) => {
    clearTimeout(noteTimer);
    set({ note: { text, tone } });
    noteTimer = setTimeout(() => set({ note: null }), 5000);
  },
  setNav: (nav) => set({ nav }),
  toggleNode: (key, current) => set((s) => ({ expanded: { ...s.expanded, [key]: !current } })),
  toggleBottom: () => set((s) => ({ bottomOpen: !s.bottomOpen })),
}));

/** Draft evaluation for the current state; memoised on (model, draft) identity. */
let memo: { model: BuildingModel; draft: Draft; result: ReturnType<typeof evaluateDraft> } | null = null;
export function currentDraft(s: Pick<EditorState, 'model' | 'draft'>) {
  if (!s.draft) return null;
  if (memo?.model !== s.model || memo.draft !== s.draft) memo = { model: s.model, draft: s.draft, result: evaluateDraft(s.model, s.draft) };
  return memo.result;
}
