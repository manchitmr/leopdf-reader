import { expect, test, vi } from "vitest";
import type { OpenResult } from "../engine/types";
import type { PdfSource } from "../platform/sources";
import { createAppStore, getTab } from "../state/store";
import { closeDocument, openSource, unlockTab, type EngineLike } from "./open-document";

const okResult: OpenResult = {
  status: "ok",
  info: { pageCount: 1, pages: [{ bounds: [0, 0, 100, 100], label: "1" }], outline: [], title: null, repaired: false, editable: true, signed: false },
};

function fakeEngine(result: OpenResult = okResult) {
  return {
    open: vi.fn(async () => result),
    unlock: vi.fn(async (_id: string, pw: string): Promise<OpenResult> => (pw === "secret" ? okResult : { status: "wrong-password" })),
    close: vi.fn(async () => undefined),
  } satisfies EngineLike;
}

const source = (path: string, load: () => Promise<Uint8Array> = async () => new Uint8Array([1])): PdfSource => ({ key: path, name: path.slice(1), path, load });
const newStore = () => createAppStore({ lang: "en", theme: "system", recent: [] });

test("opens a file, marks it ready and records it as recent", async () => {
  const store = newStore();
  const engine = fakeEngine();
  const id = await openSource(source("/a.pdf"), store, engine);
  expect(getTab(store.getState(), id)!.status).toBe("ready");
  expect(store.getState().recent[0].path).toBe("/a.pdf");
});

test("opening the same file twice does not reload it", async () => {
  const store = newStore();
  const engine = fakeEngine();
  const first = await openSource(source("/a.pdf"), store, engine);
  const second = await openSource(source("/a.pdf"), store, engine);
  expect(second).toBe(first);
  expect(engine.open).toHaveBeenCalledTimes(1);
});

test("read failure shows errorRead and drops the file from recent", async () => {
  const store = newStore();
  store.getState().pushRecent("/gone.pdf");
  const id = await openSource(source("/gone.pdf", async () => Promise.reject(new Error("ENOENT"))), store, fakeEngine());
  expect(getTab(store.getState(), id)).toMatchObject({ status: "error", error: "errorRead" });
  expect(store.getState().recent).toEqual([]);
});

test("a corrupt file errors in its own tab and other tabs stay ready", async () => {
  const store = newStore();
  const good = await openSource(source("/good.pdf"), store, fakeEngine());
  const bad = await openSource(source("/bad.pdf"), store, fakeEngine({ status: "error", reason: "corrupt" }));
  expect(getTab(store.getState(), bad)!.status).toBe("error");
  expect(getTab(store.getState(), good)!.status).toBe("ready");
  expect(store.getState().recent.map((r) => r.path)).toEqual(["/good.pdf"]);
});

test("password flow: locked, wrong password, then unlocked", async () => {
  const store = newStore();
  const engine = fakeEngine({ status: "needs-password" });
  const id = await openSource(source("/p.pdf"), store, engine);
  expect(getTab(store.getState(), id)!.status).toBe("locked");
  await unlockTab(id, "nope", store, engine);
  expect(getTab(store.getState(), id)!.passwordError).toBe(true);
  await unlockTab(id, "secret", store, engine);
  expect(getTab(store.getState(), id)!.status).toBe("ready");
});

test("closing removes the tab and frees the engine document", async () => {
  const store = newStore();
  const engine = fakeEngine();
  const id = await openSource(source("/a.pdf"), store, engine);
  await closeDocument(id, store, engine);
  expect(store.getState().tabs).toEqual([]);
  expect(engine.close).toHaveBeenCalledWith(id);
});

test("an engine failure while opening shows an error instead of loading forever", async () => {
  const store = newStore();
  const engine = { ...fakeEngine(), open: vi.fn(async (): Promise<OpenResult> => Promise.reject(new Error("wasm failed"))) };
  const id = await openSource(source("/a.pdf"), store, engine);
  expect(getTab(store.getState(), id)).toMatchObject({ status: "error", error: "errorCorrupt" });
});

test("an engine failure while unlocking shows an error", async () => {
  const store = newStore();
  const engine = { ...fakeEngine({ status: "needs-password" }), unlock: vi.fn(async (): Promise<OpenResult> => Promise.reject(new Error("boom"))) };
  const id = await openSource(source("/p.pdf"), store, engine);
  await unlockTab(id, "x", store, engine);
  expect(getTab(store.getState(), id)!.status).toBe("error");
});

test("closing a tab while its file is still being read never sends it to the engine", async () => {
  const store = newStore();
  const engine = fakeEngine();
  let finishLoad!: (b: Uint8Array) => void;
  const opening = openSource(source("/slow.pdf", () => new Promise<Uint8Array>((r) => (finishLoad = r))), store, engine);
  const id = store.getState().tabs[0].id;
  await closeDocument(id, store, engine);
  finishLoad(new Uint8Array([1]));
  await opening;
  expect(engine.open).not.toHaveBeenCalled();
  expect(store.getState().recent).toEqual([]);
});

test("closing a tab while the engine is opening it frees the engine document afterwards", async () => {
  const store = newStore();
  let finishOpen!: (r: OpenResult) => void;
  const engine = { ...fakeEngine(), open: vi.fn(() => new Promise<OpenResult>((r) => (finishOpen = r))) };
  const opening = openSource(source("/slow.pdf"), store, engine);
  await vi.waitFor(() => expect(engine.open).toHaveBeenCalled());
  const id = store.getState().tabs[0].id;
  await closeDocument(id, store, engine);
  finishOpen(okResult);
  await opening;
  expect(engine.close).toHaveBeenCalledTimes(2);
  expect(engine.close).toHaveBeenLastCalledWith(id);
  expect(store.getState().recent).toEqual([]);
  expect(store.getState().tabs).toEqual([]);
});
