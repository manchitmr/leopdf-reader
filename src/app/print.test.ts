// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { createAppStore, getTab } from "../state/store";
import { printDocument } from "./print";

URL.createObjectURL = () => "blob:test";
URL.revokeObjectURL = () => undefined;

test("renders every page into the print root, prints, then cleans up", async () => {
  const store = createAppStore({ lang: "en", theme: "system", recent: [] });
  const { id } = store.getState().addTab({ key: "a", name: "a.pdf", path: null });
  store.getState().setOpenResult(id, {
    status: "ok",
    info: { pageCount: 3, pages: Array(3).fill({ bounds: [0, 0, 100, 100], label: "1" }), outline: [], title: null, repaired: false, editable: true, signed: false, annotatable: true },
  });
  const root = document.createElement("div");
  const renderPng = vi.fn(async () => new Uint8Array([137, 80, 78, 71]));
  let imagesWhilePrinting = 0;
  let busyWhilePrinting: string | null = "unset";
  const print = vi.fn(async () => {
    imagesWhilePrinting = root.querySelectorAll("img").length;
    busyWhilePrinting = store.getState().busy;
  });

  let finishPrint!: () => void;
  const afterPrint = () => new Promise<void>((r) => (finishPrint = r));
  const done = printDocument(getTab(store.getState(), id)!, { renderPng, print, root, store, afterPrint, decode: async () => undefined });
  await vi.waitFor(() => expect(print).toHaveBeenCalled());
  expect(root.children).toHaveLength(3); // still there while the (possibly async) print dialog is open
  finishPrint();
  await done;

  expect(renderPng).toHaveBeenCalledTimes(3);
  expect(imagesWhilePrinting).toBe(3);
  expect(busyWhilePrinting).toBeNull();
  expect(root.children).toHaveLength(0);
  expect(store.getState().busy).toBeNull();
});

test("waitForImage resolves for already-loaded images and on load, rejects on error", async () => {
  const { waitForImage } = await import("./print");
  await expect(waitForImage({ complete: true } as HTMLImageElement)).resolves.toBeUndefined();
  const loading = { complete: false } as HTMLImageElement;
  const pending = waitForImage(loading);
  loading.onload!(new Event("load"));
  await expect(pending).resolves.toBeUndefined();
  const broken = { complete: false } as HTMLImageElement;
  const failing = waitForImage(broken);
  (broken.onerror as (e: Event) => void)(new Event("error"));
  await expect(failing).rejects.toThrow("could not load");
});

function readyTab(bounds: [number, number, number, number], pageCount = 1) {
  const store = createAppStore({ lang: "en", theme: "system", recent: [] });
  const { id } = store.getState().addTab({ key: "a", name: "a.pdf", path: null });
  store.getState().setOpenResult(id, {
    status: "ok",
    info: { pageCount, pages: Array(pageCount).fill({ bounds, label: "1" }), outline: [], title: null, repaired: false, editable: true, signed: false, annotatable: true },
  });
  return { store, tab: getTab(store.getState(), id)! };
}

test("huge pages are printed within the pixel budget", async () => {
  const { MAX_RENDER_PIXELS } = await import("../viewer/layout");
  const { store, tab } = readyTab([0, 0, 14400, 14400]);
  const renderPng = vi.fn(async () => new Uint8Array([1]));
  await printDocument(tab, { renderPng, print: async () => {}, root: document.createElement("div"), store, afterPrint: async () => {}, decode: async () => {} });
  const scale = (renderPng.mock.calls[0] as unknown as [string, number, number])[2];
  expect(14400 * scale * 14400 * scale).toBeLessThanOrEqual(MAX_RENDER_PIXELS + 1);
});

test("a second print request while one is in progress is ignored", async () => {
  const { store, tab } = readyTab([0, 0, 100, 100]);
  const renderPng = vi.fn(async () => new Uint8Array([1]));
  let finish!: () => void;
  const deps = { renderPng, print: async () => {}, root: document.createElement("div"), store, afterPrint: () => new Promise<void>((r) => (finish = r)), decode: async () => {} };
  const first = printDocument(tab, deps);
  await vi.waitFor(() => expect(renderPng).toHaveBeenCalledTimes(1));
  await printDocument(tab, deps);
  expect(renderPng).toHaveBeenCalledTimes(1);
  finish();
  await first;
});
