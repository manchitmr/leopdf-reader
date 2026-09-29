import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { HistoryState, RGB, TextStyle } from "../edit/types";
import type { DocInfo, OpenResult, Point, Rect, Rotation, SearchHit } from "../engine/types";
import { detectLang, type Lang, type StringKey } from "../i18n/strings";
import { loadAuthor, loadSignatures, withSignature, type SavedSignature } from "../platform/prefs";
import { addRecent, loadRecent, removeRecent, type RecentFile } from "../platform/recent";
import { baseName } from "../platform/sources";
import { DRAW_COLORS, MARKUP_COLORS } from "./palette";
import { clampZoom, stepZoom } from "./zoom";

export type ViewMode = "continuous" | "single" | "two";
export type Fit = "width" | "page" | null;
export type Theme = "system" | "light" | "dark";
export type TabStatus = "loading" | "ready" | "locked" | "error";
export type EditTool = "select" | "text";

/** A selected item in Edit mode. `id: null` means an image from the original PDF (identified by its rect). */
export interface Selected {
  tabId: string;
  page: number;
  id: string | null;
  rect: Rect;
}

export interface InlineEditorState {
  tabId: string;
  page: number;
  /** Baseline start of the first line, page space. */
  origin: Point;
  /** Existing LeoPDF text object being edited, or null for new text. */
  objectId: string | null;
  text: string;
  style: TextStyle;
}

export type Tool = "select" | "hand" | "comment" | "markup" | "draw" | "sign";
export type LeftPanel = "thumbnails" | "bookmarks" | "comments" | null;
export type MarkupKind = "highlight" | "underline" | "strikeout";
export type DrawShape = "pen" | "line" | "arrow" | "rect" | "oval";

export interface MarkupStyle {
  kind: MarkupKind;
  /** Remembered per kind (yellow highlight, red underline…). */
  colors: Record<MarkupKind, RGB>;
}

export interface DrawStyle {
  shape: DrawShape;
  color: RGB;
  /** Line width in points. */
  width: number;
}

/** A selected annotation (Select tool). `id` is the PDF object number. */
export interface SelectedAnnot {
  tabId: string;
  page: number;
  id: number;
}

export type DialogState =
  | { kind: "unsaved"; tabIds: string[]; action: "close" | "quit" }
  /** Signed-PDF warning; `then` is what to do after "Continue". */
  | { kind: "signed"; tabId: string; then: { edit: EditTool } | { tool: Tool } | { bookmark: true } }
  | { kind: "author"; then: Tool }
  | { kind: "signature" };

export interface SearchState {
  query: string;
  hits: SearchHit[];
  active: number;
  running: boolean;
}

export interface TabSelection {
  page: number;
  rects: Rect[];
  text: string;
}

export interface DocTab {
  id: string;
  key: string;
  name: string;
  path: string | null;
  status: TabStatus;
  error: StringKey | null;
  passwordError: boolean;
  info: DocInfo | null;
  zoom: number;
  fit: Fit;
  rotation: Rotation;
  viewMode: ViewMode;
  currentPage: number;
  /** Set when the UI must scroll to a page (navigation), not when the user scrolls. */
  scrollRequest: { page: number; nonce: number } | null;
  search: SearchState;
  selection: TabSelection | null;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Bumped on every edit so pages and thumbnails re-render. */
  revision: number;
  signedAcknowledged: boolean;
}

export interface Settings {
  lang: Lang;
  theme: Theme;
  recent: RecentFile[];
  /** Author for new annotations; null = never asked, "" = skipped. */
  author: string | null;
  signatures: SavedSignature[];
}

export interface AppState extends Settings {
  tabs: DocTab[];
  activeId: string | null;
  tool: Tool;
  leftPanel: LeftPanel;
  searchOpen: boolean;
  /** A full-window busy message, e.g. while preparing to print. */
  busy: StringKey | null;
  editMode: boolean;
  editTool: EditTool;
  textStyle: TextStyle;
  selected: Selected | null;
  inlineEditor: InlineEditorState | null;
  dialog: DialogState | null;
  notice: { key: StringKey; vars?: Record<string, string | number> } | null;
  markupStyle: MarkupStyle;
  drawStyle: DrawStyle;
  signatureId: string | null;
  selectedAnnot: SelectedAnnot | null;
  /** Focus the comment box of the selected annotation (after placing a note). */
  focusComment: boolean;

  addTab(source: { key: string; name: string; path: string | null }): { id: string; existed: boolean };
  setOpenResult(id: string, result: OpenResult): void;
  setError(id: string, key: StringKey): void;
  closeTab(id: string): void;
  activate(id: string): void;
  zoomBy(id: string, direction: 1 | -1): void;
  setZoom(id: string, zoom: number): void;
  applyFitZoom(id: string, zoom: number): void;
  setFit(id: string, fit: Fit): void;
  rotate(id: string): void;
  setViewMode(id: string, mode: ViewMode): void;
  setCurrentPage(id: string, page: number): void;
  goToPage(id: string, page: number): void;
  startSearch(id: string, query: string): void;
  setSearchResults(id: string, query: string, hits: SearchHit[]): void;
  stepSearch(id: string, delta: 1 | -1): void;
  clearSearch(id: string): void;
  setSelection(id: string, selection: TabSelection | null): void;
  setTool(tool: Tool): void;
  setLang(lang: Lang): void;
  setTheme(theme: Theme): void;
  toggleLeftPanel(panel: Exclude<LeftPanel, null>): void;
  setSearchOpen(open: boolean): void;
  pushRecent(path: string): void;
  dropRecent(path: string): void;
  setBusy(key: StringKey | null): void;
  setEditMode(on: boolean): void;
  setEditTool(tool: EditTool): void;
  setTextStyle(partial: Partial<TextStyle>): void;
  applyHistory(id: string, history: HistoryState): void;
  select(selected: Selected | null): void;
  openInlineEditor(state: InlineEditorState): void;
  updateInlineText(text: string): void;
  closeInlineEditor(): void;
  setDialog(dialog: DialogState | null): void;
  acknowledgeSigned(id: string): void;
  markSaved(id: string, path: string | null, history: HistoryState): void;
  showNotice(key: StringKey, vars?: Record<string, string | number>): void;
  clearNotice(): void;
  setMarkupStyle(change: { kind?: MarkupKind; color?: RGB }): void;
  setDrawStyle(partial: Partial<DrawStyle>): void;
  setSignatureId(id: string | null): void;
  selectAnnot(selected: SelectedAnnot | null, focus?: boolean): void;
  setAuthor(name: string): void;
  /** Adds (newest first) and chooses it; returns true when the oldest was dropped. */
  addSignature(sig: SavedSignature): boolean;
  removeSignature(id: string): void;
}

const EMPTY_SEARCH: SearchState = { query: "", hits: [], active: 0, running: false };
let tabCounter = 0;
let nonceCounter = 0;

function clampPage(tab: DocTab, page: number): number {
  if (!Number.isFinite(page)) return tab.currentPage;
  const last = (tab.info?.pageCount ?? 1) - 1;
  return Math.max(0, Math.min(last, Math.round(page)));
}

function defaultSettings(): Settings {
  let lang: Lang = "en";
  let theme: Theme = "system";
  try {
    lang = (localStorage.getItem("leopdf.lang") as Lang | null) ?? detectLang(navigator.language);
    theme = (localStorage.getItem("leopdf.theme") as Theme | null) ?? "system";
  } catch {
    // No storage (tests, private mode): use defaults.
  }
  const stored = typeof localStorage !== "undefined";
  return {
    lang,
    theme,
    recent: stored ? loadRecent() : [],
    author: stored ? loadAuthor() : null,
    signatures: stored ? loadSignatures() : [],
  };
}

export function createAppStore(init: Partial<Settings> = {}) {
  return createStore<AppState>()((set, get) => {
    const update = (id: string, fn: (tab: DocTab) => Partial<DocTab>) =>
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...fn(t) } : t)) }));
    const scrollTo = (tab: DocTab, page: number): Partial<DocTab> => {
      const p = clampPage(tab, page);
      return { currentPage: p, scrollRequest: { page: p, nonce: ++nonceCounter } };
    };

    return {
      ...defaultSettings(),
      ...init,
      tabs: [],
      activeId: null,
      tool: "select",
      leftPanel: "thumbnails",
      searchOpen: false,
      busy: null,
      editMode: false,
      editTool: "select",
      textStyle: { family: "sans", bold: false, size: 12, color: [0, 0, 0] },
      selected: null,
      inlineEditor: null,
      dialog: null,
      notice: null,
      markupStyle: { kind: "highlight", colors: { highlight: MARKUP_COLORS[0], underline: MARKUP_COLORS[4], strikeout: MARKUP_COLORS[4] } },
      drawStyle: { shape: "pen", color: DRAW_COLORS[0], width: 2 },
      signatureId: null,
      selectedAnnot: null,
      focusComment: false,

      addTab(source) {
        const existing = get().tabs.find((t) => t.key === source.key);
        if (existing) {
          get().activate(existing.id);
          return { id: existing.id, existed: true };
        }
        const tab: DocTab = {
          ...source,
          id: `doc-${++tabCounter}`,
          status: "loading",
          error: null,
          passwordError: false,
          info: null,
          zoom: 1,
          fit: "width",
          rotation: 0,
          viewMode: "continuous",
          currentPage: 0,
          scrollRequest: null,
          search: EMPTY_SEARCH,
          selection: null,
          dirty: false,
          canUndo: false,
          canRedo: false,
          revision: 0,
          signedAcknowledged: false,
        };
        set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
        return { id: tab.id, existed: false };
      },

      setOpenResult(id, result) {
        switch (result.status) {
          case "ok":
            return update(id, () => ({ status: "ready", info: result.info, passwordError: false, error: null, fit: "width" }));
          case "needs-password":
            return update(id, () => ({ status: "locked", passwordError: false }));
          case "wrong-password":
            return update(id, () => ({ status: "locked", passwordError: true }));
          case "error":
            return update(id, () => ({ status: "error", error: "errorCorrupt" }));
        }
      },

      setError: (id, key) => update(id, () => ({ status: "error", error: key })),

      closeTab(id) {
        const { tabs, activeId } = get();
        const index = tabs.findIndex((t) => t.id === id);
        if (index < 0) return;
        const rest = tabs.filter((t) => t.id !== id);
        const nextActive = activeId === id ? ((rest[index] ?? rest[index - 1])?.id ?? null) : activeId;
        set((s) => ({ tabs: rest, activeId: nextActive, selectedAnnot: s.selectedAnnot?.tabId === id ? null : s.selectedAnnot }));
      },

      activate(id) {
        set((s) => ({ activeId: id, selectedAnnot: s.selectedAnnot?.tabId === id ? s.selectedAnnot : null }));
        // The viewer remounts on tab switch; ask it to return to where the reader was.
        update(id, (t) => scrollTo(t, t.currentPage));
      },
      zoomBy: (id, direction) => update(id, (t) => ({ zoom: stepZoom(t.zoom, direction), fit: null })),
      setZoom: (id, zoom) => update(id, () => ({ zoom: clampZoom(zoom), fit: null })),
      applyFitZoom: (id, zoom) => update(id, () => ({ zoom: clampZoom(zoom) })),
      setFit: (id, fit) => update(id, () => ({ fit })),
      rotate: (id) => update(id, (t) => ({ rotation: ((t.rotation + 90) % 360) as Rotation })),
      setViewMode: (id, viewMode) => update(id, (t) => ({ viewMode, ...scrollTo(t, t.currentPage) })),
      setCurrentPage: (id, page) => update(id, (t) => ({ currentPage: clampPage(t, page) })),
      goToPage: (id, page) => update(id, (t) => scrollTo(t, page)),

      startSearch: (id, query) => update(id, () => ({ search: { query, hits: [], active: 0, running: true } })),

      setSearchResults(id, query, hits) {
        update(id, (t) => {
          if (t.search.query !== query) return {};
          const jump = hits.length > 0 ? scrollTo(t, hits[0].page) : {};
          return { search: { query, hits, active: 0, running: false }, ...jump };
        });
      },

      stepSearch(id, delta) {
        update(id, (t) => {
          const count = t.search.hits.length;
          if (count === 0) return {};
          const active = (t.search.active + delta + count) % count;
          return { search: { ...t.search, active }, ...scrollTo(t, t.search.hits[active].page) };
        });
      },

      clearSearch: (id) => update(id, () => ({ search: EMPTY_SEARCH })),
      setSelection: (id, selection) => update(id, () => ({ selection })),
      setLang: (lang) => set({ lang }),
      setTheme: (theme) => set({ theme }),
      toggleLeftPanel: (panel) => set((s) => ({ leftPanel: s.leftPanel === panel ? null : panel })),
      setSearchOpen: (searchOpen) => set({ searchOpen }),
      pushRecent: (path) => set((s) => ({ recent: addRecent(s.recent, path) })),
      dropRecent: (path) => set((s) => ({ recent: removeRecent(s.recent, path) })),
      setBusy: (busy) => set({ busy }),
      setTool: (tool) =>
        set((s) => ({
          tool,
          selectedAnnot: null,
          focusComment: false,
          ...(tool !== "hand" && s.editMode ? { editMode: false, editTool: "select" as const, selected: null, inlineEditor: null } : {}),
        })),
      setEditMode: (editMode) =>
        set(editMode ? { editMode, tool: "select", selectedAnnot: null } : { editMode, editTool: "select", selected: null, inlineEditor: null }),
      setMarkupStyle: ({ kind, color }) =>
        set((s) => {
          const k = kind ?? s.markupStyle.kind;
          return { markupStyle: { kind: k, colors: color ? { ...s.markupStyle.colors, [k]: color } : s.markupStyle.colors } };
        }),
      setDrawStyle: (partial) => set((s) => ({ drawStyle: { ...s.drawStyle, ...partial } })),
      setSignatureId: (signatureId) => set({ signatureId }),
      selectAnnot: (selectedAnnot, focus = false) => set({ selectedAnnot, focusComment: focus && selectedAnnot !== null }),
      setAuthor: (author) => set({ author }),
      addSignature(sig) {
        const { list, dropped } = withSignature(get().signatures, sig);
        set({ signatures: list, signatureId: sig.id });
        return dropped;
      },
      removeSignature: (id) =>
        set((s) => ({ signatures: s.signatures.filter((x) => x.id !== id), signatureId: s.signatureId === id ? null : s.signatureId })),
      setEditTool: (editTool) => set({ editTool, selected: null }),
      setTextStyle: (partial) => set((s) => ({ textStyle: { ...s.textStyle, ...partial } })),
      applyHistory: (id, history) =>
        update(id, (t) => ({
          dirty: history.dirty,
          canUndo: history.canUndo,
          canRedo: history.canRedo,
          revision: t.revision + 1,
          search: EMPTY_SEARCH,
          selection: null,
        })),
      select: (selected) => set({ selected }),
      openInlineEditor: (inlineEditor) => set({ inlineEditor, selected: null }),
      updateInlineText: (text) => set((s) => (s.inlineEditor ? { inlineEditor: { ...s.inlineEditor, text } } : {})),
      closeInlineEditor: () => set({ inlineEditor: null }),
      setDialog: (dialog) => set({ dialog }),
      acknowledgeSigned: (id) => update(id, () => ({ signedAcknowledged: true })),
      markSaved(id, path, history) {
        update(id, (t) => ({
          dirty: history.dirty,
          canUndo: history.canUndo,
          canRedo: history.canRedo,
          ...(path && path !== t.path ? { path, key: path, name: baseName(path) } : {}),
        }));
        if (path) get().pushRecent(path);
      },
      showNotice: (key, vars) => set({ notice: { key, vars } }),
      clearNotice: () => set({ notice: null }),
    };
  });
}

export type AppStore = ReturnType<typeof createAppStore>;

export const appStore = createAppStore();

export function useApp<T>(selector: (state: AppState) => T): T {
  return useStore(appStore, selector);
}

export function getTab(state: AppState, id: string): DocTab | undefined {
  return state.tabs.find((t) => t.id === id);
}

export function activeTab(state: AppState): DocTab | undefined {
  return state.activeId ? getTab(state, state.activeId) : undefined;
}
