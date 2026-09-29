import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { beforeEach, expect, test } from "vitest";
import type { Point } from "../engine/types";
import {
  NoTextError, SIGNATURE_ICON, addAnnotation, deleteAnnotation, listAnnotations, moveAnnotation, resizeAnnotation, updateAnnotation,
} from "./annotations";
import type { RGB } from "./types";

mupdf.setLog({ warning: () => {}, error: () => {} });
const FIXTURE = readFileSync(new URL("../../tests/fixtures/sample-si-ta.pdf", import.meta.url));
const RED: RGB = [1, 0, 0];
const YELLOW: RGB = [1, 1, 0];

let pdf: mupdf.PDFDocument;
let page: mupdf.PDFPage;
beforeEach(() => {
  pdf = new mupdf.PDFDocument(FIXTURE);
  page = pdf.loadPage(0);
});

/** Left and right middle points of the first text line whose text matches `pattern`. */
function lineEnds(pattern: RegExp): [Point, Point] {
  const st = page.toStructuredText("preserve-whitespace");
  const json = JSON.parse(st.asJSON()) as { blocks: { lines?: { text: string; bbox: { x: number; y: number; w: number; h: number } }[] }[] };
  st.destroy();
  const line = json.blocks.flatMap((b) => b.lines ?? []).find((l) => pattern.test(l.text));
  if (!line) throw new Error(`no line matching ${pattern}`);
  const { x, y, w, h } = line.bbox;
  return [[x + 1, y + h / 2], [x + w - 1, y + h / 2]];
}

function reopen(): mupdf.PDFPage {
  return new mupdf.PDFDocument(pdf.saveToBuffer("").asUint8Array().slice()).loadPage(0);
}

/** 100×40 transparent PNG with an opaque blue bar across the middle. */
function signaturePng(): Uint8Array {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 100, 40], true);
  pix.clear();
  const px = pix.getPixels();
  for (let y = 16; y < 24; y++) for (let x = 5; x < 95; x++) px.set([0, 0, 200, 255], (y * 100 + x) * 4);
  return pix.asPNG().slice();
}

function pixel(p: mupdf.PDFPage, x: number, y: number): number[] {
  const pix = p.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
  const i = y * pix.getStride() + x * 3;
  const rgb = Array.from(pix.getPixels().slice(i, i + 3));
  pix.destroy();
  return rgb;
}

test("the fixture starts without annotations", () => {
  expect(listAnnotations(page, 0)).toEqual([]);
});

test.each([
  ["English", /Hello/],
  ["Sinhala", /[඀-෿]/],
  ["Tamil", /[஀-௿]/],
])("highlight follows the text of a %s line", (_name, pattern) => {
  const [from, to] = lineEnds(pattern);
  const id = addAnnotation(page, { kind: "highlight", from, to, color: YELLOW }, "Leo");
  const [annot] = listAnnotations(page, 0);
  expect(annot).toMatchObject({ id, kind: "highlight", subtype: "Highlight", color: YELLOW, author: "Leo", movable: false, resizable: false, box: null });
  expect(annot.quads!.length).toBeGreaterThan(0);
  for (const q of annot.quads!) {
    expect(q[1]).toBeLessThan(from[1]); // top edge above the line's middle
    expect(q[5]).toBeGreaterThan(from[1]); // bottom edge below it
  }
});

test("a reversed drag marks the same text", () => {
  const [from, to] = lineEnds(/Hello/);
  addAnnotation(page, { kind: "underline", from: to, to: from, color: RED }, "");
  const [annot] = listAnnotations(page, 0);
  expect(annot.kind).toBe("underline");
  expect(annot.quads!.length).toBeGreaterThan(0);
});

test("a markup drag over empty space throws NoTextError and adds nothing", () => {
  expect(() => addAnnotation(page, { kind: "strikeout", from: [300, 700], to: [500, 700], color: RED }, "")).toThrow(NoTextError);
  expect(listAnnotations(page, 0)).toEqual([]);
});

test("ink, line, arrow, rectangle and oval keep their geometry and colour", () => {
  addAnnotation(page, { kind: "ink", strokes: [[[100, 300], [150, 320], [200, 300]]], color: RED, width: 3 }, "");
  addAnnotation(page, { kind: "line", from: [50, 600], to: [250, 650], color: RED, width: 2 }, "");
  addAnnotation(page, { kind: "arrow", from: [50, 700], to: [250, 700], color: RED, width: 2 }, "");
  addAnnotation(page, { kind: "rect", rect: [300, 400, 400, 450], color: RED, width: 2 }, "");
  addAnnotation(page, { kind: "oval", rect: [420, 400, 520, 450], color: RED, width: 2 }, "");
  const list = listAnnotations(page, 0);
  expect(list.map((a) => a.kind)).toEqual(["ink", "line", "arrow", "rect", "oval"]);
  expect(list.every((a) => a.color?.join() === RED.join())).toBe(true);
  expect(list[0].strokes).toEqual([[[100, 300], [150, 320], [200, 300]]]);
  expect(list[1].strokes).toEqual([[[50, 600], [250, 650]]]);
  expect(list[3]).toMatchObject({ box: [300, 400, 400, 450], movable: true, resizable: true });
  expect(list[4]).toMatchObject({ box: [420, 400, 520, 450], resizable: true });
});

test("notes keep multi-line Sinhala/Tamil comments and the author after save", () => {
  const comment = "ශ්‍රී ලංකාව — කොළඹ\nயாழ்ப்பாணம் கொழும்பு";
  addAnnotation(page, { kind: "note", at: [300, 300], contents: comment }, "මනිත්");
  const [annot] = listAnnotations(reopen(), 0);
  expect(annot).toMatchObject({ kind: "note", contents: comment, author: "මනිත්", box: [290, 290, 310, 310], movable: true, resizable: false });
  expect(annot.modified).toBeGreaterThan(0);
});

test("updateAnnotation changes the comment and colour of a highlight", () => {
  const [from, to] = lineEnds(/Hello/);
  const id = addAnnotation(page, { kind: "highlight", from, to, color: YELLOW }, "");
  updateAnnotation(page, id, { contents: "යාපනය", color: [0, 1, 0] });
  const [annot] = listAnnotations(reopen(), 0);
  expect(annot).toMatchObject({ contents: "යාපනය", color: [0, 1, 0] });
});

test("move shifts ink, lines, boxes, notes and stamps; markup cannot move", () => {
  const ink = addAnnotation(page, { kind: "ink", strokes: [[[100, 300], [200, 300]]], color: RED, width: 2 }, "");
  const line = addAnnotation(page, { kind: "arrow", from: [50, 600], to: [250, 650], color: RED, width: 2 }, "");
  const box = addAnnotation(page, { kind: "rect", rect: [300, 400, 400, 450], color: RED, width: 2 }, "");
  const note = addAnnotation(page, { kind: "note", at: [300, 300], contents: "" }, "");
  const stamp = addAnnotation(page, { kind: "stamp", rect: [100, 500, 200, 540], png: signaturePng() }, "");
  for (const id of [ink, line, box, note, stamp]) moveAnnotation(page, id, 10, -5);
  const byId = new Map(listAnnotations(page, 0).map((a) => [a.id, a]));
  expect(byId.get(ink)!.strokes).toEqual([[[110, 295], [210, 295]]]);
  expect(byId.get(line)!.strokes).toEqual([[[60, 595], [260, 645]]]);
  expect(byId.get(box)!.box).toEqual([310, 395, 410, 445]);
  expect(byId.get(note)!.box).toEqual([300, 285, 320, 305]);
  expect(byId.get(stamp)!.box).toEqual([110, 495, 210, 535]);
  const [from, to] = lineEnds(/Hello/);
  const mark = addAnnotation(page, { kind: "highlight", from, to, color: YELLOW }, "");
  expect(() => moveAnnotation(page, mark, 1, 1)).toThrow("cannot be moved");
});

test("resize changes rectangles and stamps; notes are not resizable", () => {
  const box = addAnnotation(page, { kind: "oval", rect: [300, 400, 400, 450], color: RED, width: 2 }, "");
  const stamp = addAnnotation(page, { kind: "stamp", rect: [100, 500, 200, 540], png: signaturePng() }, "");
  const note = addAnnotation(page, { kind: "note", at: [300, 300], contents: "" }, "");
  resizeAnnotation(page, box, [300, 400, 450, 480]);
  resizeAnnotation(page, stamp, [100, 500, 300, 580]);
  const byId = new Map(listAnnotations(page, 0).map((a) => [a.id, a]));
  expect(byId.get(box)!.box).toEqual([300, 400, 450, 480]);
  expect(byId.get(stamp)!.box).toEqual([100, 500, 300, 580]);
  expect(() => resizeAnnotation(page, note, [0, 0, 50, 50])).toThrow("cannot be resized");
});

test("signature stamps keep transparency, survive edits and carry LeoPDF's name", () => {
  const id = addAnnotation(page, { kind: "stamp", rect: [300, 500, 400, 540], png: signaturePng() }, "Leo");
  const check = (p: mupdf.PDFPage) => {
    const [r, g, b] = pixel(p, 310, 505); // transparent corner: page stays white
    expect(Math.min(r, g, b)).toBeGreaterThan(240);
    const [br, , bb] = pixel(p, 350, 520); // the blue bar
    expect(bb).toBeGreaterThan(120);
    expect(br).toBeLessThan(80);
  };
  check(page);
  updateAnnotation(page, id, { contents: "signed" });
  resizeAnnotation(page, id, [300, 500, 400, 540]);
  check(page);
  check(reopen());
  expect(page.getAnnotations()[0].getIcon()).toBe(SIGNATURE_ICON);
  expect(listAnnotations(page, 0)[0]).toMatchObject({ kind: "stamp", resizable: true });
});

test("listing skips links and reports page-space geometry on rotated pages", () => {
  const doc = new mupdf.PDFDocument();
  doc.insertPage(-1, doc.addPage([0, 0, 300, 500], 90, doc.newDictionary(), ""));
  const rotated = doc.loadPage(0);
  rotated.createLink([10, 10, 50, 50], "https://example.com");
  const id = addAnnotation(rotated, { kind: "rect", rect: [10, 60, 60, 90], color: RED, width: 2 }, "");
  const list = listAnnotations(rotated, 0);
  expect(list.map((a) => a.id)).toEqual([id]);
  expect(list[0].box).toEqual([10, 60, 60, 90]);
});

test("delete removes an annotation; unknown ids throw", () => {
  const id = addAnnotation(page, { kind: "note", at: [300, 300], contents: "x" }, "");
  deleteAnnotation(page, id);
  expect(listAnnotations(page, 0)).toEqual([]);
  expect(() => deleteAnnotation(page, id)).toThrow(`Unknown annotation ${id}`);
});
