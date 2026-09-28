import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { expect, test } from "vitest";
import { EmbeddedFonts } from "./embedded-fonts";
import { FontRegistry } from "./font-registry";
import { nodeFontSource } from "./node-font-source";
import { addTextObject, deleteObject, listObjects, moveObject, updateTextObject, type EditContext } from "./page-objects";
import { loadStyleFonts, shapeText } from "./shaper";
import type { TextStyle } from "./types";

mupdf.setLog({ warning: () => {}, error: () => {} });
const registry = new FontRegistry(nodeFontSource);
const style: TextStyle = { family: "sans", bold: false, size: 14, color: [0, 0, 0] };
const fixture = () => new mupdf.PDFDocument(readFileSync(new URL("../../tests/fixtures/sample-si-ta.pdf", import.meta.url)));

async function ctxFor(pdf: mupdf.PDFDocument, page = 0): Promise<EditContext> {
  return { pdf, page: pdf.loadPage(page), fonts: new EmbeddedFonts(pdf) };
}
async function add(ctx: EditContext, text: string, origin: [number, number] = [72, 400]) {
  const lines = shapeText(text, style, await loadStyleFonts(registry, style));
  const id = addTextObject(ctx, origin, text, style, lines);
  ctx.fonts.flush();
  return id;
}
const pageText = (pdf: mupdf.PDFDocument, i = 0) => pdf.loadPage(i).toStructuredText("preserve-whitespace").asText();
function reopen(pdf: mupdf.PDFDocument) {
  return mupdf.Document.openDocument(pdf.saveToBuffer("").asUint8Array(), "application/pdf").asPDF()!;
}

test("added text appears in the page text and survives save", async () => {
  const pdf = fixture();
  const ctx = await ctxFor(pdf);
  await add(ctx, "යාපනය யாழ்ப்பாணம் Jaffna");
  const saved = reopen(pdf);
  expect(pageText(saved)).toContain("යාපනය யாழ்ப்பாணம் Jaffna");
  expect(pageText(saved)).toContain("Hello world"); // original text untouched
});

test("added text is listed with its style, origin and a sensible rect", async () => {
  const pdf = fixture();
  const ctx = await ctxFor(pdf);
  const id = await add(ctx, "කොළඹ", [100, 300]);
  const [obj] = listObjects(ctx.page);
  expect(obj).toMatchObject({ id, kind: "text", text: "කොළඹ", style, origin: [100, 300] });
  expect(obj.rect[0]).toBe(100);
  expect(obj.rect[1]).toBeLessThan(300);
  expect(obj.rect[3]).toBeGreaterThan(300);
  expect(obj.rect[2]).toBeGreaterThan(100);
});

test("placed where clicked: extracted text starts at the origin", async () => {
  const pdf = fixture();
  const ctx = await ctxFor(pdf);
  await add(ctx, "Colombo", [200, 500]);
  const json = JSON.parse(pdf.loadPage(0).toStructuredText("preserve-whitespace").asJSON());
  const line = json.blocks.flatMap((b: { lines?: { text: string; x: number; y: number }[] }) => b.lines ?? []).find((l: { text: string }) => l.text === "Colombo");
  expect(line.x).toBeCloseTo(200, 0);
  expect(line.y).toBeCloseTo(500, 0);
});

test("update, move and delete change only that object", async () => {
  const pdf = fixture();
  const ctx = await ctxFor(pdf);
  const a = await add(ctx, "කොළඹ", [72, 300]);
  const b = await add(ctx, "யாழ்ப்பாணம்", [72, 360]);
  const fontsLoaded = await loadStyleFonts(registry, style);
  updateTextObject(ctx, a, "ගාල්ල", style, shapeText("ගාල්ල", style, fontsLoaded));
  ctx.fonts.flush();
  moveObject(ctx, b, 10, 20, (o) => shapeText(o.text!, style, fontsLoaded));
  ctx.fonts.flush();
  const objs = listObjects(ctx.page);
  expect(objs.find((o) => o.id === a)!.text).toBe("ගාල්ල");
  expect(objs.find((o) => o.id === b)!.origin).toEqual([82, 380]);
  expect(pageText(pdf)).not.toContain("කොළඹ");
  deleteObject(ctx, a);
  expect(listObjects(ctx.page).map((o) => o.id)).toEqual([b]);
  expect(pageText(pdf)).not.toContain("ගාල්ල");
  expect(pageText(pdf)).toContain("யாழ்ப்பாணம்");
});

test("rotated page: text is placed upright at the clicked point", async () => {
  const pdf = fixture();
  pdf.loadPage(0).getObject().put("Rotate", 90);
  const ctx = await ctxFor(pdf);
  await add(ctx, "Colombo", [150, 120]);
  const json = JSON.parse(pdf.loadPage(0).toStructuredText("preserve-whitespace").asJSON());
  const line = json.blocks.flatMap((b: { lines?: { text: string; x: number; y: number; dir?: { x: number; y: number } }[] }) => b.lines ?? []).find((l: { text: string }) => l.text === "Colombo");
  expect(line.x).toBeCloseTo(150, 0);
  expect(line.y).toBeCloseTo(120, 0);
});

test("shared resources: editing page 1 does not touch page 2", async () => {
  const pdf = new mupdf.PDFDocument();
  const shared = pdf.addObject(pdf.newDictionary());
  shared.put("Font", pdf.newDictionary());
  pdf.insertPage(-1, pdf.addPage([0, 0, 595, 842], 0, shared, "BT ET"));
  pdf.insertPage(-1, pdf.addPage([0, 0, 595, 842], 0, shared, "BT ET"));
  const ctx = await ctxFor(pdf, 0);
  await add(ctx, "කොළඹ");
  expect(pdf.loadPage(1).getObject().get("Resources").get("Font").toString()).toBe("<<>>");
  expect(pageText(pdf, 1).trim()).toBe("");
});

test("single-stream Contents and inherited Resources are handled", async () => {
  const pdf = new mupdf.PDFDocument();
  const res = pdf.addObject(pdf.newDictionary());
  const pageRef = pdf.addPage([0, 0, 595, 842], 0, res, "BT ET");
  pdf.insertPage(-1, pageRef);
  const pages = pdf.getTrailer().get("Root", "Pages");
  pages.put("Resources", res);
  pdf.loadPage(0).getObject().delete("Resources"); // now inherited
  const ctx = await ctxFor(pdf, 0);
  await add(ctx, "Jaffna");
  expect(pageText(pdf)).toContain("Jaffna");
});
