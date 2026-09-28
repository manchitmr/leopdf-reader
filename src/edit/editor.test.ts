import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { beforeEach, expect, test } from "vitest";
import { DocumentEditor } from "./editor";
import { FontRegistry } from "./font-registry";
import { nodeFontSource } from "./node-font-source";
import type { TextStyle } from "./types";

mupdf.setLog({ warning: () => {}, error: () => {} });
const registry = new FontRegistry(nodeFontSource);
const style: TextStyle = { family: "sans", bold: false, size: 14, color: [0, 0, 0] };
const png = (() => {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 8, 8], false);
  pix.clear(120);
  return pix.asPNG().slice();
})();

let pdf: mupdf.PDFDocument;
let editor: DocumentEditor;
beforeEach(() => {
  pdf = new mupdf.PDFDocument(readFileSync(new URL("../../tests/fixtures/sample-si-ta.pdf", import.meta.url)));
  editor = new DocumentEditor(pdf, registry);
});
const text = (bytes?: Uint8Array) =>
  (bytes ? mupdf.Document.openDocument(bytes, "application/pdf") : pdf).loadPage(0).toStructuredText("preserve-whitespace").asText();

test("a fresh editor is clean", () => {
  expect(editor.history()).toEqual({ canUndo: false, canRedo: false, dirty: false });
});

test("add text → dirty and undoable; undo/redo toggle the text", async () => {
  const r = await editor.addText(0, [72, 400], "යාපනය", style);
  expect(r.id).toBeTruthy();
  expect(r.history).toEqual({ canUndo: true, canRedo: false, dirty: true });
  expect(text()).toContain("යාපනය");
  editor.undo();
  expect(text()).not.toContain("යාපනය");
  expect(editor.history()).toMatchObject({ canRedo: true, dirty: false });
  editor.redo();
  expect(text()).toContain("යාපනය");
});

test("undo after font embed, more edits, then save still produces a valid file", async () => {
  await editor.addText(0, [72, 400], "කොළඹ", style);
  editor.undo();
  await editor.addText(0, [72, 450], "யாழ்ப்பாணம்", style);
  await editor.addText(0, [72, 500], "ශ්‍රී ලංකාව", { ...style, bold: true });
  const bytes = editor.save();
  expect(text(bytes)).toContain("யாழ்ப்பாணம்");
  expect(text(bytes)).toContain("ශ්‍රී ලංකාව");
  expect(text(bytes)).not.toContain("කොළඹ");
  expect(text(bytes)).toContain("Hello world");
});

test("save then markSaved clears dirty; a later edit makes it dirty again", async () => {
  await editor.addText(0, [72, 400], "Jaffna", style);
  editor.save();
  expect(editor.markSaved().dirty).toBe(false);
  await editor.addText(0, [72, 420], "Galle", style);
  expect(editor.history().dirty).toBe(true);
});

test("edit text, move, delete via the editor", async () => {
  const { id } = await editor.addText(0, [72, 400], "කොළඹ", style);
  await editor.updateText(0, id!, "ගාල්ල", style);
  await editor.moveObject(0, id!, 5, 5);
  expect(editor.listObjects(0)[0]).toMatchObject({ text: "ගාල්ල", origin: [77, 405] });
  await editor.deleteObject(0, id!);
  expect(editor.listObjects(0)).toEqual([]);
  expect(text()).not.toContain("ගාල්ල");
});

test("images: add with default rect, replace by id, delete", async () => {
  const { id } = await editor.addImage(0, png, null);
  expect(editor.listObjects(0)).toHaveLength(1);
  await editor.replaceImage(0, { id: id! }, png);
  await editor.deleteObject(0, id!);
  expect(editor.listObjects(0)).toEqual([]);
});

test("missing characters are reported", async () => {
  const r = await editor.addText(0, [72, 400], "කොළඹ 中", style);
  expect(r.missing).toEqual(["中"]);
});

test("a failing edit is rolled back and leaves history unchanged", async () => {
  await expect(editor.updateText(0, "nope", "x", style)).rejects.toThrow("Unknown object nope");
  expect(editor.history()).toEqual({ canUndo: false, canRedo: false, dirty: false });
});
