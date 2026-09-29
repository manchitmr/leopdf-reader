// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Annot } from "../edit/types";
import { appStore, getTab } from "../state/store";
import { AnnotCard } from "./AnnotCard";

const engine = vi.hoisted(() => ({
  updateAnnotation: vi.fn(async () => ({ history: { canUndo: true, canRedo: false, dirty: true }, id: "5" })),
  deleteAnnotation: vi.fn(async () => ({ history: { canUndo: true, canRedo: false, dirty: true } })),
}));
vi.mock("../engine/client", () => ({ getEngine: () => engine }));

const note: Annot = {
  id: 5, page: 0, kind: "note", subtype: "Text", rect: [100, 100, 120, 120], box: [100, 100, 120, 120],
  color: [1, 0.84, 0], contents: "", author: "Leo", modified: Date.UTC(2026, 8, 29), movable: true, resizable: false,
};
let tabId: string;
beforeEach(() => {
  engine.updateAnnotation.mockClear();
  engine.deleteAnnotation.mockClear();
  appStore.setState({ tabs: [], activeId: null, lang: "en", selectedAnnot: null, focusComment: false });
  tabId = appStore.getState().addTab({ key: "/a.pdf", name: "a.pdf", path: "/a.pdf" }).id;
  appStore.getState().selectAnnot({ tabId, page: 0, id: 5 });
});
afterEach(cleanup);
const tab = () => getTab(appStore.getState(), tabId)!;

test("typing a Sinhala comment and leaving the box saves it once", async () => {
  render(<AnnotCard annot={note} tab={tab()} anchor={[100, 100, 120, 120]} pageWidth={600} />);
  expect(screen.getByText(/Leo/)).toBeTruthy();
  const box = screen.getByLabelText("Add a comment…");
  fireEvent.change(box, { target: { value: "ශ්‍රී ලංකාව" } });
  fireEvent.blur(box);
  await waitFor(() => expect(engine.updateAnnotation).toHaveBeenCalledWith(tabId, 0, 5, { contents: "ශ්‍රී ලංකාව" }));
  cleanup();
  expect(engine.updateAnnotation).toHaveBeenCalledTimes(1);
});

test("unmounting with unsaved text saves it", async () => {
  const { unmount } = render(<AnnotCard annot={note} tab={tab()} anchor={[100, 100, 120, 120]} pageWidth={600} />);
  fireEvent.change(screen.getByLabelText("Add a comment…"), { target: { value: "யாழ்ப்பாணம்" } });
  unmount();
  await waitFor(() => expect(engine.updateAnnotation).toHaveBeenCalledWith(tabId, 0, 5, { contents: "யாழ்ப்பாணம்" }));
});

test("delete removes the annotation and clears the selection", async () => {
  render(<AnnotCard annot={note} tab={tab()} anchor={[100, 100, 120, 120]} pageWidth={600} />);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(engine.deleteAnnotation).toHaveBeenCalledWith(tabId, 0, 5));
  expect(appStore.getState().selectedAnnot).toBeNull();
});
