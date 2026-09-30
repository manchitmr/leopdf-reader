// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Annot } from "../edit/types";
import { appStore, getTab } from "../state/store";
import { CommentsPanel } from "./CommentsPanel";

const base: Omit<Annot, "id" | "page" | "kind" | "contents" | "author"> = {
  subtype: "Text", rect: [0, 0, 10, 10], box: null, color: null, modified: null, ours: true, movable: true, resizable: false,
};
const list: Annot[] = [
  { ...base, id: 3, page: 0, kind: "note", contents: "කොළඹ", author: "Leo" },
  { ...base, id: 9, page: 1, kind: "highlight", subtype: "Highlight", contents: "", author: "" },
];
const engine = vi.hoisted(() => ({ listAnnotations: vi.fn(async () => [] as Annot[]) }));
vi.mock("../engine/client", () => ({ getEngine: () => engine }));

let tabId: string;
beforeEach(() => {
  appStore.setState({ tabs: [], activeId: null, lang: "en", tool: "draw", selectedAnnot: null, author: "Leo" });
  tabId = appStore.getState().addTab({ key: "/a.pdf", name: "a.pdf", path: "/a.pdf" }).id;
  appStore.getState().setOpenResult(tabId, {
    status: "ok",
    info: { pageCount: 2, pages: [{ bounds: [0, 0, 600, 800], label: "1" }, { bounds: [0, 0, 600, 800], label: "ii" }], outline: [], title: null, repaired: false, editable: true, signed: false, annotatable: true, fillable: false },
  });
});
afterEach(cleanup);
const tab = () => getTab(appStore.getState(), tabId)!;

test("lists annotations by page and jumps to one on click", async () => {
  engine.listAnnotations.mockResolvedValueOnce(list);
  render(<CommentsPanel tab={tab()} />);
  expect(await screen.findByText("කොළඹ")).toBeTruthy();
  expect(screen.getByText("Page ii")).toBeTruthy();
  fireEvent.click(screen.getByText("Highlight"));
  expect(appStore.getState()).toMatchObject({ tool: "select", selectedAnnot: { tabId, page: 1, id: 9 } });
  expect(tab().currentPage).toBe(1);
});

test("shows an empty state and edits the author name", async () => {
  engine.listAnnotations.mockResolvedValueOnce([]);
  render(<CommentsPanel tab={tab()} />);
  await waitFor(() => expect(screen.getByText("No comments yet")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "යාපනය" } });
  expect(appStore.getState().author).toBe("යාපනය");
});
