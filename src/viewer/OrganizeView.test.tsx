// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import type { EditResult } from "../edit/types";
import type { DocInfo } from "../engine/types";
import { appStore, getTab } from "../state/store";
import { OrganizeView } from "./OrganizeView";

const info = (pageCount: number): DocInfo => ({
  pageCount, pages: Array.from({ length: pageCount }, (_, i) => ({ bounds: [0, 0, 600, 800], label: String(i + 1) })), outline: [], title: null,
  repaired: false, editable: true, signed: false, annotatable: true, fillable: false,
});
const history = { canUndo: true, canRedo: false, dirty: true };
const engine = {
  deletePages: vi.fn(async (): Promise<EditResult> => ({ history, info: info(3) })),
  movePages: vi.fn(async (): Promise<EditResult> => ({ history, info: info(4), pages: [0, 1] })),
};
vi.mock("../engine/client", () => ({ getEngine: () => engine }));
beforeAll(() => {
  globalThis.IntersectionObserver = class {
    observe() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
});
afterEach(cleanup);

function open(pageCount = 4) {
  appStore.setState({ tabs: [], activeId: null, lang: "en", organizing: true, notice: null });
  const { id } = appStore.getState().addTab({ key: "/a.pdf", name: "a.pdf", path: "/a.pdf" });
  appStore.getState().setOpenResult(id, { status: "ok", info: info(pageCount) });
  const view = render(<OrganizeView tab={getTab(appStore.getState(), id)!} />);
  return { id, view, thumbs: () => screen.getAllByRole("option") };
}

test("click selects, Shift-click selects a range, Ctrl-click toggles; Delete removes the selection", async () => {
  const { id, thumbs } = open();
  fireEvent.click(thumbs()[1]);
  fireEvent.click(thumbs()[3], { shiftKey: true });
  expect(thumbs().map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true", "true", "true"]);
  fireEvent.click(thumbs()[2], { ctrlKey: true });
  expect(screen.getByText("2 selected")).toBeTruthy();
  fireEvent.keyDown(window, { key: "Delete" });
  await waitFor(() => expect(engine.deletePages).toHaveBeenCalledWith(id, [1, 3]));
});

test("dragging pages onto another page moves them next to it", async () => {
  const { id, thumbs } = open();
  fireEvent.click(thumbs()[2]);
  fireEvent.click(thumbs()[3], { shiftKey: true });
  fireEvent.dragStart(thumbs()[3], { dataTransfer: { setData: () => {}, effectAllowed: "" } });
  // jsdom's drag events carry no pointer position, which reads as the right half of page 1: "after page 1".
  fireEvent.dragOver(thumbs()[0]);
  fireEvent.drop(screen.getByRole("listbox"));
  await waitFor(() => expect(engine.movePages).toHaveBeenCalledWith(id, [2, 3], 1));
});

test("Escape and Done leave Organize Pages", () => {
  open();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(appStore.getState().organizing).toBe(false);
});
