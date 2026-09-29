import { expect, test, vi } from "vitest";
import type { EditResult, HistoryState } from "../edit/types";
import type { DocInfo } from "../engine/types";
import { createAppStore, getTab } from "../state/store";
import { commitInlineEditor, enterEditMode, requestClose, requestQuit, resolveDialog, saveTab, type EditDeps } from "./edit-actions";

const clean: HistoryState = { canUndo: false, canRedo: false, dirty: false };
const dirty: HistoryState = { canUndo: true, canRedo: false, dirty: true };
const info = (over: Partial<DocInfo> = {}): DocInfo => ({
  pageCount: 1, pages: [{ bounds: [0, 0, 600, 800], label: "1" }], outline: [], title: null, repaired: false, editable: true, signed: false, annotatable: true, ...over,
});

function setup(path: string | null = "/docs/a.pdf", docInfo = info()) {
  const store = createAppStore({ lang: "en", theme: "system", recent: [] });
  const { id } = store.getState().addTab({ key: path ?? "web:a", name: "a.pdf", path });
  store.getState().setOpenResult(id, { status: "ok", info: docInfo });
  const engine = {
    addText: vi.fn(async (): Promise<EditResult> => ({ history: dirty, id: "t1" })),
    updateText: vi.fn(async (): Promise<EditResult> => ({ history: dirty, id: "t1" })),
    deleteObject: vi.fn(async (): Promise<EditResult> => ({ history: dirty })),
    deleteImage: vi.fn(async (): Promise<EditResult> => ({ history: dirty })),
    addImage: vi.fn(async (): Promise<EditResult> => ({ history: dirty, id: "i1" })),
    undo: vi.fn(async (): Promise<EditResult> => ({ history: clean })),
    redo: vi.fn(async (): Promise<EditResult> => ({ history: dirty })),
    save: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
    markSaved: vi.fn(async () => clean),
    close: vi.fn(async () => undefined),
  };
  const files = {
    writePdf: vi.fn(async () => undefined),
    pickSavePath: vi.fn(async (): Promise<string | null> => "/docs/new.pdf"),
    downloadPdf: vi.fn(),
    pickImage: vi.fn(async (): Promise<Uint8Array | null> => new Uint8Array([1])),
  };
  const deps = { engine, store, files, tauri: true } as unknown as EditDeps;
  return { store, id, engine, files, deps, tab: () => getTab(store.getState(), id)! };
}

test("committing the inline editor adds text and marks the tab dirty", async () => {
  const { store, id, engine, deps, tab } = setup();
  store.getState().openInlineEditor({ tabId: id, page: 0, origin: [10, 20], objectId: null, text: "යාපනය", style: store.getState().textStyle });
  await commitInlineEditor(deps);
  expect(engine.addText).toHaveBeenCalledWith(id, 0, [10, 20], "යාපනය", store.getState().textStyle);
  expect(tab()).toMatchObject({ dirty: true, revision: 1 });
  expect(store.getState().inlineEditor).toBeNull();
});

test("committing empty text for an existing object deletes it; for a new one does nothing", async () => {
  const { store, id, engine, deps } = setup();
  store.getState().openInlineEditor({ tabId: id, page: 0, origin: [10, 20], objectId: "t1", text: "  ", style: store.getState().textStyle });
  await commitInlineEditor(deps);
  expect(engine.deleteObject).toHaveBeenCalledWith(id, 0, "t1");
  store.getState().openInlineEditor({ tabId: id, page: 0, origin: [10, 20], objectId: null, text: "", style: store.getState().textStyle });
  await commitInlineEditor(deps);
  expect(engine.addText).not.toHaveBeenCalled();
});

test("save writes to the tab's path and clears dirty", async () => {
  const { id, engine, files, deps, tab, store } = setup();
  store.getState().applyHistory(id, dirty);
  expect(await saveTab(id, { as: false }, deps)).toBe(true);
  expect(files.writePdf).toHaveBeenCalledWith("/docs/a.pdf", expect.any(Uint8Array));
  expect(engine.markSaved).toHaveBeenCalledWith(id);
  expect(tab().dirty).toBe(false);
});

test("save failure: nothing marked saved, tab stays dirty, notice shown", async () => {
  const { id, engine, files, deps, tab, store } = setup();
  store.getState().applyHistory(id, dirty);
  files.writePdf.mockRejectedValueOnce(new Error("read-only"));
  expect(await saveTab(id, { as: false }, deps)).toBe(false);
  expect(engine.markSaved).not.toHaveBeenCalled();
  expect(tab().dirty).toBe(true);
  expect(store.getState().notice?.key).toBe("saveFailed");
});

test("save as asks for a path and adopts it; cancelling the dialog saves nothing", async () => {
  const { id, files, deps, tab } = setup();
  await saveTab(id, { as: true }, deps);
  expect(tab().path).toBe("/docs/new.pdf");
  files.pickSavePath.mockResolvedValueOnce(null);
  expect(await saveTab(id, { as: true }, deps)).toBe(false);
});

test("browser tabs download on save", async () => {
  const { id, files, deps } = setup(null);
  (deps as { tauri: boolean }).tauri = false;
  await saveTab(id, { as: false }, deps);
  expect(files.downloadPdf).toHaveBeenCalledWith("a.pdf", expect.any(Uint8Array));
});

test("closing a dirty tab asks first; discard closes, cancel keeps it", async () => {
  const { store, id, engine, deps } = setup();
  store.getState().applyHistory(id, dirty);
  await requestClose(id, deps);
  expect(store.getState().dialog).toEqual({ kind: "unsaved", tabIds: [id], action: "close" });
  await resolveDialog("cancel", deps);
  expect(store.getState().tabs).toHaveLength(1);
  await requestClose(id, deps);
  await resolveDialog("discard", deps);
  expect(store.getState().tabs).toHaveLength(0);
  expect(engine.close).toHaveBeenCalledWith(id);
});

test("save in the unsaved dialog saves then closes", async () => {
  const { store, id, files, deps } = setup();
  store.getState().applyHistory(id, dirty);
  await requestClose(id, deps);
  await resolveDialog("save", deps);
  expect(files.writePdf).toHaveBeenCalled();
  expect(store.getState().tabs).toHaveLength(0);
});

test("quitting with dirty tabs asks; clean state may quit immediately", async () => {
  const { store, id, deps } = setup();
  expect(requestQuit(deps)).toBe(true);
  store.getState().applyHistory(id, dirty);
  expect(requestQuit(deps)).toBe(false);
  expect(store.getState().dialog).toEqual({ kind: "unsaved", tabIds: [id], action: "quit" });
});

test("entering edit mode: disallowed PDFs show a notice; signed PDFs ask once", async () => {
  const locked = setup("/a.pdf", info({ editable: false }));
  await enterEditMode(locked.deps);
  expect(locked.store.getState()).toMatchObject({ editMode: false, notice: { key: "editNotAllowed" } });
  const signed = setup("/b.pdf", info({ signed: true }));
  await enterEditMode(signed.deps);
  expect(signed.store.getState().dialog).toEqual({ kind: "signed", tabId: signed.id, then: { edit: "select" } });
  await resolveDialog("save", signed.deps); // "Continue" maps to the primary choice
  expect(signed.store.getState().editMode).toBe(true);
  expect(signed.tab().signedAcknowledged).toBe(true);
});
