import { expect, test, vi } from "vitest";
import type { OpenResult } from "../engine/types";
import type { PdfSource } from "../platform/sources";
import { createAppStore, getTab } from "../state/store";
import { closeDocument, openSource, unlockTab, type EngineLike } from "./open-document";

const okResult: OpenResult = {
  status: "ok",
  info: { pageCount: 1, pages: [{ bounds: [0, 0, 100, 100], label: "1" }], outline: [], title: null, repaired: false },
};

function fakeEngine(result: OpenResult = okResult) {
  return {
    open: vi.fn(async () => result),
    unlock: vi.fn(async (_id: string, pw: string): Promise<OpenResult> => (pw === "secret" ? okResult : { status: "wrong-password" })),
    close: vi.fn(async () => undefined),
  } satisfies EngineLike;
}

const source = (path: string, load = async () => new Uint8Array([1])): PdfSource => ({ key: path, name: path.slice(1), path, load });
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
