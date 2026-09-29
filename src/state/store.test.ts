import { expect, test } from "vitest";
import type { DocInfo, SearchHit } from "../engine/types";
import { createAppStore, getTab } from "./store";

const info = (pageCount: number): DocInfo => ({
  pageCount,
  pages: Array.from({ length: pageCount }, (_, i) => ({ bounds: [0, 0, 600, 800], label: String(i + 1) })),
  outline: [],
  title: null,
  repaired: false,
  editable: true,
  signed: false, annotatable: true,
});
const src = (key: string) => ({ key, name: `${key}.pdf`, path: `/${key}.pdf` });

function storeWithDoc(pages = 10) {
  const store = createAppStore({ lang: "en", theme: "system", recent: [] });
  const { id } = store.getState().addTab(src("a"));
  store.getState().setOpenResult(id, { status: "ok", info: info(pages) });
  return { store, id, tab: () => getTab(store.getState(), id)! };
}

test("adding the same file twice activates the existing tab", () => {
  const store = createAppStore({ lang: "en", theme: "system", recent: [] });
  const first = store.getState().addTab(src("a"));
  store.getState().addTab(src("b"));
  const again = store.getState().addTab(src("a"));
  expect(again).toEqual({ id: first.id, existed: true });
  expect(store.getState().tabs).toHaveLength(2);
  expect(store.getState().activeId).toBe(first.id);
});

test("open results drive tab status", () => {
  const store = createAppStore({ lang: "en", theme: "system", recent: [] });
  const { id } = store.getState().addTab(src("a"));
  expect(getTab(store.getState(), id)!.status).toBe("loading");
  store.getState().setOpenResult(id, { status: "needs-password" });
  expect(getTab(store.getState(), id)!.status).toBe("locked");
  store.getState().setOpenResult(id, { status: "wrong-password" });
  expect(getTab(store.getState(), id)!.passwordError).toBe(true);
  store.getState().setOpenResult(id, { status: "ok", info: info(3) });
  expect(getTab(store.getState(), id)).toMatchObject({ status: "ready", passwordError: false, fit: "width" });
  store.getState().setOpenResult(id, { status: "error", reason: "corrupt" });
  expect(getTab(store.getState(), id)).toMatchObject({ status: "error", error: "errorCorrupt" });
});

test("closing the active tab activates a neighbour", () => {
  const store = createAppStore({ lang: "en", theme: "system", recent: [] });
  const a = store.getState().addTab(src("a")).id;
  const b = store.getState().addTab(src("b")).id;
  const c = store.getState().addTab(src("c")).id;
  store.getState().activate(b);
  store.getState().closeTab(b);
  expect(store.getState().activeId).toBe(c);
  store.getState().closeTab(c);
  expect(store.getState().activeId).toBe(a);
  store.getState().closeTab(a);
  expect(store.getState().activeId).toBeNull();
});

test("zoom actions clamp and clear fit; fit zoom keeps fit", () => {
  const { store, id, tab } = storeWithDoc();
  store.getState().applyFitZoom(id, 1.3);
  expect(tab()).toMatchObject({ zoom: 1.3, fit: "width" });
  store.getState().zoomBy(id, 1);
  expect(tab()).toMatchObject({ zoom: 1.5, fit: null });
  store.getState().setZoom(id, 100);
  expect(tab().zoom).toBe(8);
});

test("rotate cycles through 0/90/180/270", () => {
  const { store, id, tab } = storeWithDoc();
  for (const expected of [90, 180, 270, 0]) {
    store.getState().rotate(id);
    expect(tab().rotation).toBe(expected);
  }
});

test("goToPage clamps and issues a scroll request; setCurrentPage does not", () => {
  const { store, id, tab } = storeWithDoc(5);
  store.getState().goToPage(id, 99);
  expect(tab().currentPage).toBe(4);
  const request = tab().scrollRequest;
  expect(request?.page).toBe(4);
  store.getState().setCurrentPage(id, 2);
  expect(tab().currentPage).toBe(2);
  expect(tab().scrollRequest).toBe(request);
});

test("search results jump to the first hit and step with wrap-around", () => {
  const { store, id, tab } = storeWithDoc(5);
  const hits: SearchHit[] = [
    { page: 1, rects: [] },
    { page: 3, rects: [] },
  ];
  store.getState().startSearch(id, "x");
  expect(tab().search).toMatchObject({ query: "x", running: true });
  store.getState().setSearchResults(id, "x", hits);
  expect(tab().search).toMatchObject({ active: 0, running: false });
  expect(tab().currentPage).toBe(1);
  store.getState().stepSearch(id, 1);
  expect(tab().currentPage).toBe(3);
  store.getState().stepSearch(id, 1);
  expect(tab().search.active).toBe(0);
  store.getState().stepSearch(id, -1);
  expect(tab().search.active).toBe(1);
});

test("stale search results are ignored", () => {
  const { store, id, tab } = storeWithDoc(5);
  store.getState().startSearch(id, "new");
  store.getState().setSearchResults(id, "old", [{ page: 2, rects: [] }]);
  expect(tab().search).toMatchObject({ query: "new", hits: [], running: true });
});

test("recent files are pushed and dropped", () => {
  const { store } = storeWithDoc();
  store.getState().pushRecent("/x.pdf");
  expect(store.getState().recent[0].path).toBe("/x.pdf");
  store.getState().dropRecent("/x.pdf");
  expect(store.getState().recent).toEqual([]);
});

test("non-numeric page input leaves the current page unchanged", () => {
  const { store, id, tab } = storeWithDoc(5);
  store.getState().goToPage(id, 3);
  store.getState().goToPage(id, Number("iv") - 1);
  expect(tab().currentPage).toBe(3);
  store.getState().setCurrentPage(id, NaN);
  expect(tab().currentPage).toBe(3);
});

test("switching back to a tab asks the viewer to restore its page", () => {
  const { store, id, tab } = storeWithDoc(50);
  store.getState().setCurrentPage(id, 40);
  const other = store.getState().addTab(src("b")).id;
  store.getState().activate(other);
  store.getState().activate(id);
  expect(tab().scrollRequest?.page).toBe(40);
});

test("edit history updates flags, bumps the revision and clears search", () => {
  const { store, id, tab } = storeWithDoc(3);
  store.getState().setSearchResults(id, "", []);
  store.getState().startSearch(id, "x");
  store.getState().applyHistory(id, { canUndo: true, canRedo: false, dirty: true });
  expect(tab()).toMatchObject({ dirty: true, canUndo: true, canRedo: false, revision: 1 });
  expect(tab().search.query).toBe("");
});

test("markSaved clears dirty and adopts a new path", () => {
  const { store, id, tab } = storeWithDoc(3);
  store.getState().applyHistory(id, { canUndo: true, canRedo: false, dirty: true });
  store.getState().markSaved(id, "/docs/යාපනය.pdf", { canUndo: true, canRedo: false, dirty: false });
  expect(tab()).toMatchObject({ dirty: false, path: "/docs/යාපනය.pdf", key: "/docs/යාපනය.pdf", name: "යාපනය.pdf" });
  expect(store.getState().recent[0].path).toBe("/docs/යාපනය.pdf");
});

test("text style merges partial updates", () => {
  const { store } = storeWithDoc();
  store.getState().setTextStyle({ bold: true, size: 18 });
  expect(store.getState().textStyle).toEqual({ family: "sans", bold: true, size: 18, color: [0, 0, 0] });
});

test("leaving edit mode closes the inline editor and clears selection", () => {
  const { store, id } = storeWithDoc();
  store.getState().setEditMode(true);
  store.getState().select({ tabId: id, page: 0, id: "t1", rect: [0, 0, 1, 1] });
  store.getState().openInlineEditor({ tabId: id, page: 0, origin: [1, 1], objectId: null, text: "", style: store.getState().textStyle });
  store.getState().setEditMode(false);
  expect(store.getState()).toMatchObject({ editMode: false, selected: null, inlineEditor: null, editTool: "select" });
});

test("annotation tools leave edit mode; entering edit mode goes back to Select", () => {
  const { store, id } = storeWithDoc();
  store.getState().setEditMode(true);
  store.getState().setTool("hand");
  expect(store.getState().editMode).toBe(true);
  store.getState().selectAnnot({ tabId: id, page: 0, id: 12 });
  store.getState().setTool("draw");
  expect(store.getState()).toMatchObject({ tool: "draw", editMode: false, selectedAnnot: null });
  store.getState().setEditMode(true);
  expect(store.getState()).toMatchObject({ tool: "select", editMode: true });
});

test("markup colours are remembered per kind; draw style merges", () => {
  const { store } = storeWithDoc();
  store.getState().setMarkupStyle({ color: [0, 1, 0] });
  store.getState().setMarkupStyle({ kind: "underline" });
  expect(store.getState().markupStyle.colors.highlight).toEqual([0, 1, 0]);
  expect(store.getState().markupStyle.kind).toBe("underline");
  store.getState().setDrawStyle({ shape: "arrow", width: 4 });
  expect(store.getState().drawStyle).toMatchObject({ shape: "arrow", width: 4 });
});

test("selecting an annotation can ask for the comment box to be focused", () => {
  const { store, id } = storeWithDoc();
  store.getState().selectAnnot({ tabId: id, page: 0, id: 7 }, true);
  expect(store.getState()).toMatchObject({ selectedAnnot: { id: 7 }, focusComment: true });
  store.getState().selectAnnot(null);
  expect(store.getState().focusComment).toBe(false);
});

test("signatures: newest first and chosen; removing the chosen one clears the choice", () => {
  const { store } = storeWithDoc();
  const sig = (id: string) => ({ id, png: "data:image/png;base64,AA==", width: 10, height: 4 });
  expect(store.getState().addSignature(sig("a"))).toBe(false);
  store.getState().addSignature(sig("b"));
  expect(store.getState().signatures.map((s) => s.id)).toEqual(["b", "a"]);
  expect(store.getState().signatureId).toBe("b");
  store.getState().removeSignature("b");
  expect(store.getState().signatureId).toBeNull();
});

test("closing a tab clears its annotation selection", () => {
  const { store, id } = storeWithDoc();
  store.getState().selectAnnot({ tabId: id, page: 0, id: 3 });
  store.getState().closeTab(id);
  expect(store.getState().selectedAnnot).toBeNull();
});
