import type { AnnotPatch, NewAnnot } from "../edit/types";
import type { Point, Rect } from "../engine/types";
import { activeTab, type SelectedAnnot, type Tool } from "../state/store";
import { fitSignature } from "../viewer/annot-geometry";
import { commitInlineEditor, defaultEditDeps, runEdit, type EditDeps } from "./edit-actions";

/** Default width of a placed signature, in points (about 5 cm). */
export const SIGNATURE_WIDTH = 150;

export function dataUrlToBytes(url: string): Uint8Array {
  return Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (c) => c.charCodeAt(0));
}

/**
 * Picks a rail tool. Select and Hand are always allowed; the annotation tools change the document,
 * so they check the PDF's permissions, the signed-PDF warning and the author name first.
 */
export async function chooseTool(tool: Tool, deps: EditDeps = defaultEditDeps()): Promise<void> {
  const s = deps.store.getState();
  if (s.inlineEditor) await commitInlineEditor(deps);
  if (tool === "select" || tool === "hand") return s.setTool(tool);
  const tab = activeTab(s);
  if (!tab?.info) return;
  if (!tab.info.annotatable) return s.showNotice("annotNotAllowed");
  if (tab.info.signed && !tab.signedAcknowledged) return s.setDialog({ kind: "signed", tabId: tab.id, then: { tool } });
  if (s.author === null) return s.setDialog({ kind: "author", then: tool });
  s.setTool(tool);
  if (tool === "sign") {
    const now = deps.store.getState();
    if (now.signatures.length === 0) now.setDialog({ kind: "signature" });
    else if (!now.signatures.some((x) => x.id === now.signatureId)) now.setSignatureId(now.signatures[0].id);
  }
}

export async function resolveAuthorDialog(name: string, deps: EditDeps = defaultEditDeps()): Promise<void> {
  const s = deps.store.getState();
  const dialog = s.dialog;
  s.setDialog(null);
  s.setAuthor(name.trim());
  if (dialog?.kind === "author") await chooseTool(dialog.then, deps);
}

/** Adds an annotation; returns its id, or null if nothing was added. */
export async function addAnnot(tabId: string, page: number, spec: NewAnnot, deps: EditDeps = defaultEditDeps()): Promise<number | null> {
  const s = deps.store.getState();
  const result = await runEdit(tabId, () => deps.engine.addAnnotation(tabId, page, spec, (s.author ?? "").trim()), deps);
  if (!result) return null;
  if (result.empty) {
    s.showNotice("noTextToMark");
    return null;
  }
  return result.id ? Number(result.id) : null;
}

export async function addNote(tabId: string, page: number, at: Point, deps: EditDeps = defaultEditDeps()): Promise<void> {
  const id = await addAnnot(tabId, page, { kind: "note", at, contents: "" }, deps);
  // The Comment tool stays on so several notes can be placed; the new one opens for typing.
  if (id !== null) deps.store.getState().selectAnnot({ tabId, page, id }, true);
}

/** Comment tool dragged over text: highlight it and open the highlight's comment box (Acrobat's "comment on text"). */
export async function addTextComment(tabId: string, page: number, from: Point, to: Point, deps: EditDeps = defaultEditDeps()): Promise<void> {
  const color = deps.store.getState().markupStyle.colors.highlight;
  const id = await addAnnot(tabId, page, { kind: "highlight", from, to, color }, deps);
  if (id !== null) deps.store.getState().selectAnnot({ tabId, page, id }, true);
}

export async function placeSignature(tabId: string, page: number, at: Point, deps: EditDeps = defaultEditDeps()): Promise<void> {
  const s = deps.store.getState();
  const sig = s.signatures.find((x) => x.id === s.signatureId);
  if (!sig) return s.showNotice("pickSignature");
  const rect = fitSignature(at, SIGNATURE_WIDTH, sig.width / sig.height);
  const id = await addAnnot(tabId, page, { kind: "stamp", rect, png: dataUrlToBytes(sig.png) }, deps);
  if (id === null) return;
  s.setTool("select");
  s.selectAnnot({ tabId, page, id });
}

export const updateAnnot = (sel: SelectedAnnot, patch: AnnotPatch, deps: EditDeps = defaultEditDeps()) =>
  runEdit(sel.tabId, () => deps.engine.updateAnnotation(sel.tabId, sel.page, sel.id, patch), deps);

export const moveAnnot = (sel: SelectedAnnot, dx: number, dy: number, deps: EditDeps = defaultEditDeps()) =>
  runEdit(sel.tabId, () => deps.engine.moveAnnotation(sel.tabId, sel.page, sel.id, dx, dy), deps);

export const resizeAnnot = (sel: SelectedAnnot, rect: Rect, deps: EditDeps = defaultEditDeps()) =>
  runEdit(sel.tabId, () => deps.engine.resizeAnnotation(sel.tabId, sel.page, sel.id, rect), deps);

export async function deleteSelectedAnnot(deps: EditDeps = defaultEditDeps()): Promise<void> {
  const s = deps.store.getState();
  const sel = s.selectedAnnot;
  if (!sel) return;
  s.selectAnnot(null);
  await runEdit(sel.tabId, () => deps.engine.deleteAnnotation(sel.tabId, sel.page, sel.id), deps);
}
