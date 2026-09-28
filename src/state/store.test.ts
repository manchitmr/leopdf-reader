import { expect, test } from "vitest";
import type { DocInfo, SearchHit } from "../engine/types";
import { createAppStore, getTab } from "./store";

const info = (pageCount: number): DocInfo => ({
  pageCount,
  pages: Array.from({ length: pageCount }, (_, i) => ({ bounds: [0, 0, 600, 800], label: String(i + 1) })),
  outline: [],
  title: null,
  repaired: false,
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
