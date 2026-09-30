import * as mupdf from "mupdf";
import { beforeEach, expect, test } from "vitest";
import { cropPages, deletePages, extractPages, insertBlankPage, insertPdf, movePages, rotatePages, splitGroups } from "./pages";

mupdf.setLog({ warning: () => {}, error: () => {} });

/** A PDF whose pages say "P1", "P2" … so order is checkable by text. */
function numbered(n: number, size: mupdf.Rect = [0, 0, 300, 400]): mupdf.PDFDocument {
  const doc = new mupdf.PDFDocument();
  const font = doc.addSimpleFont(new mupdf.Font("Helvetica"));
  for (let i = 1; i <= n; i++) {
    const res = doc.addObject(doc.newDictionary());
    res.put("Font", doc.newDictionary());
    res.get("Font").put("F", font);
    doc.insertPage(-1, doc.addPage(size, 0, res, `BT /F 20 Tf 20 ${size[3] - 40} Td (P${i}) Tj ET`));
  }
  return doc;
}
const labels = (doc: mupdf.PDFDocument) => Array.from({ length: doc.countPages() }, (_, i) => doc.loadPage(i).toStructuredText("").asText().trim());

let pdf: mupdf.PDFDocument;
beforeEach(() => {
  pdf = numbered(5);
});

test("rotate adds to each page's rotation, wrapping at 360", () => {
  rotatePages(pdf, [0, 2], 90);
  rotatePages(pdf, [0], -180);
  expect([0, 1, 2].map((p) => pdf.findPage(p).get("Rotate").asNumber())).toEqual([270, 0, 90]);
  expect(pdf.loadPage(2).getBounds()).toEqual([0, 0, 400, 300]);
});

test("delete removes pages but never the last one", () => {
  deletePages(pdf, [1, 3, 3]);
  expect(labels(pdf)).toEqual(["P1", "P3", "P5"]);
  expect(() => deletePages(pdf, [0, 1, 2])).toThrow();
  expect(pdf.countPages()).toBe(3);
});

test("move puts the selection before a page, keeping its order", () => {
  expect(movePages(pdf, [3, 1], 0)).toEqual([0, 1]);
  expect(labels(pdf)).toEqual(["P2", "P4", "P1", "P3", "P5"]);
  movePages(pdf, [0], 5); // to the end
  expect(labels(pdf)).toEqual(["P4", "P1", "P3", "P5", "P2"]);
});

test("insert blank (sized like a neighbour) and insert another PDF", () => {
  insertBlankPage(pdf, 1, 0);
  expect(pdf.countPages()).toBe(6);
  expect(labels(pdf)[1]).toBe("");
  expect(pdf.loadPage(1).getBounds()).toEqual([0, 0, 300, 400]);
  const other = numbered(2, [0, 0, 200, 200]);
  const added = insertPdf(pdf, -1, other.saveToBuffer("").asUint8Array());
  expect(added).toBe(2);
  expect(labels(pdf).slice(-3)).toEqual(["P5", "P1", "P2"]);
});

test("extract makes a new PDF of chosen pages in order; split groups", () => {
  const out = new mupdf.PDFDocument(extractPages(pdf, [4, 0]));
  expect(labels(out)).toEqual(["P5", "P1"]);
  expect(pdf.countPages()).toBe(5);
  expect(splitGroups(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
  expect(splitGroups(3, 0)).toEqual([[0], [1], [2]]);
});

test("crop trims the displayed page's sides, also on a rotated page", () => {
  cropPages(pdf, [0], { top: 10, right: 20, bottom: 30, left: 10 });
  expect(pdf.loadPage(0).getBounds()).toEqual([0, 0, 270, 360]);
  // Text near the top-left (20pt in, 40pt down) survives.
  expect(labels(pdf)[0]).toBe("P1");

  rotatePages(pdf, [1], 90); // displayed 400 wide × 300 tall
  cropPages(pdf, [1], { top: 0, right: 100, bottom: 0, left: 0 });
  expect(pdf.loadPage(1).getBounds()).toEqual([0, 0, 300, 300]);
  // "P2" sat at the page's top-left, which is the displayed top-right after turning: it is cut off.
  expect(labels(pdf)[1]).toBe("");
  expect(() => cropPages(pdf, [2], { top: 200, right: 0, bottom: 200, left: 0 })).toThrow();
});

test("move, delete, insert and crop are each one undoable step in the editor", async () => {
  const { DocumentEditor } = await import("./editor");
  const { FontRegistry } = await import("./font-registry");
  const { nodeFontSource } = await import("./node-font-source");
  const editor = new DocumentEditor(pdf, new FontRegistry(nodeFontSource));
  await editor.movePages([4], 0);
  await editor.deletePages([1]);
  await editor.insertPdf(-1, numbered(2).saveToBuffer("").asUint8Array());
  await editor.cropPages([0], { top: 10, right: 10, bottom: 10, left: 10 });
  expect(labels(pdf)).toEqual(["P5", "P2", "P3", "P4", "P1", "P2"]);
  for (let i = 0; i < 4; i++) editor.undo();
  expect(labels(pdf)).toEqual(["P1", "P2", "P3", "P4", "P5"]);
  expect(pdf.loadPage(0).getBounds()).toEqual([0, 0, 300, 400]);
  editor.redo();
  expect(labels(pdf)).toEqual(["P5", "P1", "P2", "P3", "P4"]);
  const saved = new mupdf.PDFDocument(editor.save());
  expect(labels(saved)).toEqual(["P5", "P1", "P2", "P3", "P4"]);
});
