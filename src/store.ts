import { create } from 'zustand';
import type { BuildingModel } from './domain/model';
import { sampleHouse } from './domain/model';

export type NavMode = 'orbit' | 'pan';

interface EditorState {
  model: BuildingModel;
  selectedId: string | null;
  hoverId: string | null;
  nav: NavMode;
  /** Model-tree nodes the user explicitly toggled. */
  expanded: Record<string, boolean>;
  bottomOpen: boolean;
  select: (id: string | null) => void;
  setHover: (id: string | null) => void;
  setNav: (nav: NavMode) => void;
  toggleNode: (key: string, current: boolean) => void;
  toggleBottom: () => void;
}

export const useEditor = create<EditorState>()((set, get) => ({
  model: sampleHouse(),
  selectedId: null,
  hoverId: null,
  nav: 'orbit',
  expanded: {},
  bottomOpen: true,
  select: (id) => {
    const { model, expanded } = get();
    const el = id ? model.elements[id] : undefined;
    set({ selectedId: id, expanded: el?.type === 'opening' ? { ...expanded, [el.hostWallId]: true } : expanded });
  },
  setHover: (hoverId) => set({ hoverId }),
  setNav: (nav) => set({ nav }),
  toggleNode: (key, current) => set((s) => ({ expanded: { ...s.expanded, [key]: !current } })),
  toggleBottom: () => set((s) => ({ bottomOpen: !s.bottomOpen })),
}));
