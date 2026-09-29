import { expect, test, vi } from "vitest";
import type { EditResult, HistoryState } from "../edit/types";
import type { DocInfo } from "../engine/types";
import { createAppStore } from "../state/store";
import { addAnnot, addNote, addTextComment, chooseTool, dataUrlToBytes, deleteSelectedAnnot, placeSignature, resolveAuthorDialog } from "./annot-actions";
import { redo, resolveDialog, undo, type EditDeps } from "./edit-actions";

const clean: HistoryState = { canUndo: false, canRedo: false, dirty: false };
const dirty: HistoryState = { canUndo: true, canRedo: false, dirty: true };
const info = (over: Partial<DocInfo> = {}): DocInfo => ({
  pageCount: 1, pages: [{ bounds: [0, 0, 600, 800], label: "1" }], outline: [], title: null, repaired: false,
  editable: true, signed: false, annotatable: true, ...over,
});

function setup(docInfo = info()) {
  const store = createAppStore({ lang: "en", theme: "system", recent: [], author: null, signatures: [] });
  const { id } = store.getState().addTab({ key: "/a.pdf", name: "a.pdf", path: "/a.pdf" });
  store.getState().setOpenResult(id, { status: "ok", info: docInfo });
  const engine = {
    addAnnotation: vi.fn(async (): Promise<EditResult> => ({ history: dirty, id: "42" })),
    updateAnnotation: vi.fn(async (): Promise<EditResult> => ({ history: dirty, id: "42" })),
    deleteAnnotation: vi.fn(async (): Promise<EditResult> => ({ history: dirty })),
    undo: vi.fn(async (): Promise<EditResult> => ({ history: clean })),
    redo: vi.fn(async (): Promise<EditResult> => ({ history: dirty })),
  };
  const deps = { engine, store, files: {}, tauri: true } as unknown as EditDeps;
  return { store, id, engine, deps };
}

test("choosing a tool checks permission, then the signed warning, then the author name", async () => {
  const locked = setup(info({ annotatable: false }));
  await chooseTool("markup", locked.deps);
  expect(locked.store.getState()).toMatchObject({ tool: "select", notice: { key: "annotNotAllowed" } });

  const { store, id, deps } = setup(info({ signed: true }));
  await chooseTool("markup", deps);
  expect(store.getState().dialog).toEqual({ kind: "signed", tabId: id, then: { tool: "markup" } });
  await resolveDialog("save", deps); // "Continue"
  expect(store.getState().dialog).toEqual({ kind: "author", then: "markup" });
  await resolveAuthorDialog("  මනිත්  ", deps);
  expect(store.getState()).toMatchObject({ author: "මනිත්", tool: "markup", dialog: null });
});

test("skipping the name stores an empty author and never asks again", async () => {
  const { store, deps } = setup();
  await chooseTool("draw", deps);
  await resolveAuthorDialog("", deps);
  expect(store.getState()).toMatchObject({ author: "", tool: "draw" });
  store.getState().setTool("select");
  await chooseTool("comment", deps);
  expect(store.getState()).toMatchObject({ tool: "comment", dialog: null });
});

test("picking Sign with no saved signatures opens the signature dialog", async () => {
  const { store, deps } = setup();
  store.getState().setAuthor("Leo");
  await chooseTool("sign", deps);
  expect(store.getState()).toMatchObject({ tool: "sign", dialog: { kind: "signature" } });
});

test("a markup over no text shows a notice and returns null", async () => {
  const { store, id, engine, deps } = setup();
  engine.addAnnotation.mockResolvedValueOnce({ history: clean, empty: true });
  const r = await addAnnot(id, 0, { kind: "highlight", from: [0, 0], to: [1, 1], color: [1, 1, 0] }, deps);
  expect(r).toBeNull();
  expect(store.getState().notice?.key).toBe("noTextToMark");
});

test("new annotations carry the trimmed author name", async () => {
  const { store, id, engine, deps } = setup();
  store.getState().setAuthor(" Leo ");
  await addAnnot(id, 0, { kind: "rect", rect: [0, 0, 10, 10], color: [1, 0, 0], width: 2 }, deps);
  expect(engine.addAnnotation).toHaveBeenCalledWith(id, 0, expect.objectContaining({ kind: "rect" }), "Leo");
});

test("placing a note keeps the Comment tool and focuses its comment box", async () => {
  const { store, id, deps } = setup();
  store.getState().setTool("comment");
  await addNote(id, 0, [100, 100], deps);
  expect(store.getState()).toMatchObject({ tool: "comment", selectedAnnot: { tabId: id, page: 0, id: 42 }, focusComment: true });
});

test("commenting on text highlights it and opens its comment box", async () => {
  const { store, id, engine, deps } = setup();
  store.getState().setTool("comment");
  await addTextComment(id, 0, [10, 20], [90, 20], deps);
  expect(engine.addAnnotation).toHaveBeenCalledWith(id, 0, { kind: "highlight", from: [10, 20], to: [90, 20], color: store.getState().markupStyle.colors.highlight }, "");
  expect(store.getState()).toMatchObject({ tool: "comment", selectedAnnot: { id: 42 }, focusComment: true });
});

test("placing a signature uses the chosen signature in a 150 pt wide box", async () => {
  const { store, id, engine, deps } = setup();
  store.getState().addSignature({ id: "s1", png: "data:image/png;base64,AQID", width: 300, height: 100 });
  store.getState().setTool("sign");
  await placeSignature(id, 0, [200, 300], deps);
  expect(engine.addAnnotation).toHaveBeenCalledWith(id, 0, { kind: "stamp", rect: [125, 275, 275, 325], png: new Uint8Array([1, 2, 3]) }, "");
  expect(store.getState()).toMatchObject({ tool: "select", selectedAnnot: { id: 42 } });
});

test("placing without a chosen signature asks for one", async () => {
  const { store, id, engine, deps } = setup();
  await placeSignature(id, 0, [200, 300], deps);
  expect(engine.addAnnotation).not.toHaveBeenCalled();
  expect(store.getState().notice?.key).toBe("pickSignature");
});

test("deleting the selected annotation clears the selection", async () => {
  const { store, id, engine, deps } = setup();
  store.getState().selectAnnot({ tabId: id, page: 0, id: 9 });
  await deleteSelectedAnnot(deps);
  expect(engine.deleteAnnotation).toHaveBeenCalledWith(id, 0, 9);
  expect(store.getState().selectedAnnot).toBeNull();
});

test("undo and redo clear the annotation selection", async () => {
  const { store, id, deps } = setup();
  store.getState().selectAnnot({ tabId: id, page: 0, id: 9 });
  await undo(id, deps);
  expect(store.getState().selectedAnnot).toBeNull();
  store.getState().selectAnnot({ tabId: id, page: 0, id: 9 });
  await redo(id, deps);
  expect(store.getState().selectedAnnot).toBeNull();
});

test("data URLs decode to bytes", () => {
  expect(dataUrlToBytes("data:image/png;base64,AQID")).toEqual(new Uint8Array([1, 2, 3]));
});
