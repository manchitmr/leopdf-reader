// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { DocInfo, OutlineNode } from "../engine/types";
import { appStore, getTab, useApp } from "../state/store";
import { BookmarksPanel } from "./BookmarksPanel";

const node = (title: string, page: number, i: number): OutlineNode => ({ title, page, path: [i], children: [] });
const engine = vi.hoisted(() => ({
  outline: vi.fn(async (): Promise<OutlineNode[]> => []),
  addBookmark: vi.fn(async () => ({ history: { canUndo: true, canRedo: false, dirty: true }, id: "1" })),
  renameBookmark: vi.fn(async () => ({ history: { canUndo: true, canRedo: false, dirty: true } })),
  deleteBookmark: vi.fn(async () => ({ history: { canUndo: true, canRedo: false, dirty: true } })),
}));
vi.mock("../engine/client", () => ({ getEngine: () => engine }));

let tabId: string;
function open(over: Partial<DocInfo> = {}) {
  appStore.setState({ tabs: [], activeId: null, lang: "en", dialog: null, notice: null });
  tabId = appStore.getState().addTab({ key: "/a.pdf", name: "a.pdf", path: "/a.pdf" }).id;
  appStore.getState().setOpenResult(tabId, {
    status: "ok",
    info: {
      pageCount: 3, pages: ["1", "2", "3"].map((label) => ({ bounds: [0, 0, 600, 800], label })), outline: [node("Chapter One", 0, 0)],
      title: null, repaired: false, editable: true, signed: false, annotatable: true, fillable: false, ...over,
    },
  });
}
beforeEach(() => {
  Object.values(engine).forEach((f) => f.mockClear());
  engine.outline.mockResolvedValue([node("Chapter One", 0, 0)]);
  open();
});
afterEach(cleanup);
const tab = () => getTab(appStore.getState(), tabId)!;
/** Renders with the live tab, as LeftPanel does, so edits (revision bumps) reach the panel. */
function Live() {
  const live = useApp((s) => getTab(s, tabId)!);
  return <BookmarksPanel tab={live} />;
}

test("Add bookmark marks the current page and opens its name for editing", async () => {
  appStore.getState().setCurrentPage(tabId, 1);
  render(<Live />);
  engine.outline.mockResolvedValue([node("Chapter One", 0, 0), node("Page 2", 1, 1)]);
  fireEvent.click(screen.getByRole("button", { name: "Add bookmark" }));
  await waitFor(() => expect(engine.addBookmark).toHaveBeenCalledWith(tabId, 1, "Page 2"));
  const input = (await screen.findByLabelText("Rename bookmark")) as HTMLInputElement;
  expect(input.value).toBe("Page 2");
  fireEvent.change(input, { target: { value: "කොළඹ" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(engine.renameBookmark).toHaveBeenCalledWith(tabId, [1], "කොළඹ"));
});

test("double-click renames, Escape cancels, the bin deletes", async () => {
  render(<Live />);
  fireEvent.doubleClick(await screen.findByText("Chapter One"));
  const input = screen.getByLabelText("Rename bookmark");
  fireEvent.change(input, { target: { value: "x" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(engine.renameBookmark).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Delete bookmark" }));
  await waitFor(() => expect(engine.deleteBookmark).toHaveBeenCalledWith(tabId, [0]));
  expect(tab().dirty).toBe(true);
});

test("the list is read from the document, and clicking a bookmark goes to its page", async () => {
  engine.outline.mockResolvedValue([node("Chapter One", 0, 0), node("End", 2, 1)]);
  render(<Live />);
  fireEvent.click(await screen.findByText("End"));
  expect(tab().currentPage).toBe(2);
});

test("PDFs that forbid editing can't get bookmarks; signed PDFs warn first", async () => {
  open({ editable: false });
  render(<Live />);
  expect(screen.queryByRole("button", { name: "Add bookmark" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete bookmark" })).toBeNull();
  cleanup();
  open({ signed: true });
  render(<Live />);
  fireEvent.click(screen.getByRole("button", { name: "Add bookmark" }));
  expect(appStore.getState().dialog).toEqual({ kind: "signed", tabId, then: { bookmark: true } });
  expect(engine.addBookmark).not.toHaveBeenCalled();
});
