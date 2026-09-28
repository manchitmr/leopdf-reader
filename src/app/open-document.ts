import { getEngine } from "../engine/client";
import type { OpenResult } from "../engine/types";
import type { PdfSource } from "../platform/sources";
import { appStore, type AppStore } from "../state/store";

/** The engine calls this module needs (the worker proxy satisfies it; tests pass fakes). */
export interface EngineLike {
  open(docId: string, bytes: Uint8Array): Promise<OpenResult>;
  unlock(docId: string, password: string): Promise<OpenResult>;
  close(docId: string): Promise<void>;
}

/** Sources of open tabs, kept so documents can be reloaded if the engine restarts. */
const sources = new Map<string, PdfSource>();

async function load(id: string, src: PdfSource, store: AppStore, engine: EngineLike): Promise<void> {
  let bytes: Uint8Array;
  try {
    bytes = await src.load();
  } catch {
    store.getState().setError(id, "errorRead");
    if (src.path) store.getState().dropRecent(src.path);
    return;
  }
  const result = await engine.open(id, bytes);
  store.getState().setOpenResult(id, result);
  if (result.status !== "error" && src.path) store.getState().pushRecent(src.path);
}

export async function openSource(src: PdfSource, store: AppStore = appStore, engine: EngineLike = getEngine()): Promise<string> {
  const { id, existed } = store.getState().addTab({ key: src.key, name: src.name, path: src.path });
  if (existed) return id;
  sources.set(id, src);
  await load(id, src, store, engine);
  return id;
}

export async function unlockTab(id: string, password: string, store: AppStore = appStore, engine: EngineLike = getEngine()): Promise<void> {
  store.getState().setOpenResult(id, await engine.unlock(id, password));
}

export async function closeDocument(id: string, store: AppStore = appStore, engine: EngineLike = getEngine()): Promise<void> {
  store.getState().closeTab(id);
  sources.delete(id);
  await engine.close(id);
}

/** Reloads every open document into a fresh engine (after a worker crash). */
export async function reopenAll(store: AppStore = appStore, engine: EngineLike = getEngine()): Promise<void> {
  for (const tab of store.getState().tabs) {
    const src = sources.get(tab.id);
    if (src && tab.status !== "error") await load(tab.id, src, store, engine);
  }
}
