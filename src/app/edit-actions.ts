import { getEngine } from "../engine/client";
import type { EngineApi } from "../engine/engine-api";
import type { EditResult } from "../edit/types";
import { downloadPdf, pickImage, pickSavePath, writePdf } from "../platform/files";
import { isTauri } from "../platform/sources";
import { activeTab, appStore, getTab, type AppStore } from "../state/store";
import { closeDocument } from "./open-document";

type Async<T> = T extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never;
export type EditEngine = { [K in keyof EngineApi]: Async<EngineApi[K]> };

export interface EditDeps {
  engine: EditEngine;
  store: AppStore;
  files: { writePdf: typeof writePdf; pickSavePath: typeof pickSavePath; downloadPdf: typeof downloadPdf; pickImage: typeof pickImage };
  tauri: boolean;
}

export const defaultEditDeps = (): EditDeps => ({
  engine: getEngine() as unknown as EditEngine,
  store: appStore,
  files: { writePdf, pickSavePath, downloadPdf, pickImage },
  tauri: isTauri(),
});

export async function runEdit(tabId: string, call: () => Promise<EditResult>, deps: EditDeps = defaultEditDeps()): Promise<EditResult | null> {
  const s = deps.store.getState();
  try {
    const result = await call();
    s.applyHistory(tabId, result.history);
    if (result.missing?.length) s.showNotice("missingGlyphs", { chars: result.missing.join(" ") });
    return result;
  } catch {
    s.showNotice("editFailed");
    return null;
  }
}

export async function commitInlineEditor(deps: EditDeps = defaultEditDeps()): Promise<void> {
  const s = deps.store.getState();
  const ed = s.inlineEditor;
  if (!ed) return;
  s.closeInlineEditor();
  const empty = ed.text.trim().length === 0;
  if (ed.objectId) {
    await runEdit(ed.tabId, () => (empty ? deps.engine.deleteObject(ed.tabId, ed.page, ed.objectId!) : deps.engine.updateText(ed.tabId, ed.page, ed.objectId!, ed.text, ed.style)), deps);
  } else if (!empty) {
    await runEdit(ed.tabId, () => deps.engine.addText(ed.tabId, ed.page, ed.origin, ed.text, ed.style), deps);
  }
}

export async function addImageFromPicker(tabId: string, page: number, deps: EditDeps = defaultEditDeps()): Promise<void> {
  const bytes = await deps.files.pickImage();
  if (bytes) await runEdit(tabId, () => deps.engine.addImage(tabId, page, bytes, null), deps);
}

export async function replaceSelectedImage(deps: EditDeps = defaultEditDeps()): Promise<void> {
  const sel = deps.store.getState().selected;
  if (!sel) return;
  const bytes = await deps.files.pickImage();
  if (!bytes) return;
  const target = sel.id ? { id: sel.id } : { rect: sel.rect };
  await runEdit(sel.tabId, () => deps.engine.replaceImage(sel.tabId, sel.page, target, bytes), deps);
}

export async function deleteSelected(deps: EditDeps = defaultEditDeps()): Promise<void> {
  const s = deps.store.getState();
  const sel = s.selected;
  if (!sel) return;
  s.select(null);
  await runEdit(sel.tabId, () => (sel.id ? deps.engine.deleteObject(sel.tabId, sel.page, sel.id) : deps.engine.deleteImage(sel.tabId, sel.page, sel.rect)), deps);
}

export const undo = (tabId: string, deps: EditDeps = defaultEditDeps()) => runEdit(tabId, () => deps.engine.undo(tabId), deps);
export const redo = (tabId: string, deps: EditDeps = defaultEditDeps()) => runEdit(tabId, () => deps.engine.redo(tabId), deps);

export async function saveTab(tabId: string, { as }: { as: boolean }, deps: EditDeps = defaultEditDeps()): Promise<boolean> {
  const s = deps.store.getState();
  const tab = getTab(s, tabId);
  if (!tab) return false;
  let path: string | null = null;
  if (deps.tauri) {
    path = !as && tab.path ? tab.path : await deps.files.pickSavePath(tab.name);
    if (!path) return false;
  }
  s.showNotice("saving");
  try {
    const bytes = await deps.engine.save(tabId);
    if (path) await deps.files.writePdf(path, bytes);
    else deps.files.downloadPdf(tab.name, bytes);
    const history = await deps.engine.markSaved(tabId);
    s.markSaved(tabId, path, history);
    s.showNotice("saved");
    return true;
  } catch {
    s.showNotice("saveFailed", { name: tab.name });
    return false;
  }
}

export async function requestClose(tabId: string, deps: EditDeps = defaultEditDeps()): Promise<void> {
  const tab = getTab(deps.store.getState(), tabId);
  if (tab?.dirty) deps.store.getState().setDialog({ kind: "unsaved", tabIds: [tabId], action: "close" });
  else await closeDocument(tabId, deps.store, deps.engine);
}

/** Returns true if the app may quit now; otherwise opens the unsaved-changes dialog. */
export function requestQuit(deps: EditDeps = defaultEditDeps()): boolean {
  const dirty = deps.store.getState().tabs.filter((t) => t.dirty).map((t) => t.id);
  if (dirty.length === 0) return true;
  deps.store.getState().setDialog({ kind: "unsaved", tabIds: dirty, action: "quit" });
  return false;
}

/** Hook for the quit action, set by App (Tauri window destroy / browser no-op). */
export const quitHandler = { quit: () => {} };

export async function resolveDialog(choice: "save" | "discard" | "cancel", deps: EditDeps = defaultEditDeps()): Promise<void> {
  const s = deps.store.getState();
  const dialog = s.dialog;
  s.setDialog(null);
  if (!dialog || choice === "cancel") return;
  if (dialog.kind === "signed") {
    s.acknowledgeSigned(dialog.tabId);
    s.setEditMode(true);
    return;
  }
  if (dialog.kind !== "unsaved") return;
  if (choice === "save") {
    for (const id of dialog.tabIds) if (!(await saveTab(id, { as: false }, deps))) return;
  }
  if (dialog.action === "close") for (const id of dialog.tabIds) await closeDocument(id, deps.store, deps.engine);
  else quitHandler.quit();
}

export async function enterEditMode(deps: EditDeps = defaultEditDeps()): Promise<void> {
  const s = deps.store.getState();
  const tab = activeTab(s);
  if (!tab?.info) return;
  if (!tab.info.editable) {
    s.showNotice("editNotAllowed");
    return;
  }
  if (tab.info.signed && !tab.signedAcknowledged) {
    s.setDialog({ kind: "signed", tabId: tab.id, then: { edit: "select" } });
    return;
  }
  s.setEditMode(true);
}
