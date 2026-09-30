// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { appStore } from "../state/store";
import { Toolbar } from "./Toolbar";

const engine = vi.hoisted(() => ({ undo: vi.fn(async () => ({ history: { canUndo: false, canRedo: true, dirty: false } })) }));
vi.mock("../engine/client", () => ({ getEngine: () => engine }));

let id: string;
beforeEach(() => {
  appStore.setState({ tabs: [], activeId: null, lang: "en", editMode: false, tool: "select" });
  id = appStore.getState().addTab({ key: "/a.pdf", name: "a.pdf", path: "/a.pdf" }).id;
  appStore.getState().setOpenResult(id, {
    status: "ok",
    info: { pageCount: 1, pages: [{ bounds: [0, 0, 600, 800], label: "1" }], outline: [], title: null, repaired: false, editable: true, signed: false, annotatable: true, fillable: false },
  });
});
afterEach(cleanup);

test("undo and redo are on the main toolbar, outside Edit mode too", async () => {
  render(<Toolbar onPrint={() => {}} />);
  const undo = screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
  expect(undo.disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Redo" }) as HTMLButtonElement).disabled).toBe(true);
  appStore.getState().applyHistory(id, { canUndo: true, canRedo: false, dirty: true });
  await waitFor(() => expect(undo.disabled).toBe(false));
  fireEvent.click(undo);
  await waitFor(() => expect(engine.undo).toHaveBeenCalledWith(id));
});
