import { expect, test, vi } from "vitest";
import { createAppStore } from "../state/store";
import { copySelection } from "./copy";

test("copies the active tab's selected text", async () => {
  const store = createAppStore({ lang: "en", theme: "system", recent: [] });
  const { id } = store.getState().addTab({ key: "a", name: "a.pdf", path: null });
  store.getState().setSelection(id, { page: 0, rects: [], text: "ශ්‍රී ලංකාව" });
  const writeText = vi.fn(async () => undefined);
  expect(await copySelection(store, { writeText })).toBe(true);
  expect(writeText).toHaveBeenCalledWith("ශ්‍රී ලංකාව");
});

test("does nothing without a selection", async () => {
  const store = createAppStore({ lang: "en", theme: "system", recent: [] });
  store.getState().addTab({ key: "a", name: "a.pdf", path: null });
  const writeText = vi.fn(async () => undefined);
  expect(await copySelection(store, { writeText })).toBe(false);
  expect(writeText).not.toHaveBeenCalled();
});
