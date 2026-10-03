import * as mupdf from "mupdf";
import { expect, test } from "vitest";
import { DocumentEngine } from "../engine/document-engine";
import { convertDocument, needsUnicode, tagContent } from "./unicode-layer";

mupdf.setLog({ warning: () => {}, error: () => {} });

/** A one-page PDF whose content uses /F1 = a TrueType font named `base` (WinAnsi), plus /F2 Helvetica. */
function legacyPdf(content: string, base = "FMAbhaya"): mupdf.PDFDocument {
  const doc = new mupdf.PDFDocument();
  const f1 = doc.addObject(doc.newDictionary());
  f1.put("Type", doc.newName("Font"));
  f1.put("Subtype", doc.newName("TrueType"));
  f1.put("BaseFont", doc.newName(base));
  f1.put("Encoding", doc.newName("WinAnsiEncoding"));
  const res = doc.addObject(doc.newDictionary());
  res.put("Font", doc.newDictionary());
  res.get("Font").put("F1", f1);
  res.get("Font").put("F2", doc.addSimpleFont(new mupdf.Font("Helvetica")));
  doc.insertPage(-1, doc.addPage([0, 0, 400, 200], 0, res, content));
  return doc;
}
const text = (doc: mupdf.PDFDocument) => doc.loadPage(0).toStructuredText("preserve-whitespace").asText().replace(/\s+/g, " ").trim();
const pixels = (doc: mupdf.PDFDocument) => doc.loadPage(0).toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true).getPixels().slice();

test("tags before the operands (also a TJ array), leaves other fonts and existing ActualText alone", () => {
  const fonts = legacyPdf("").findPage(0).get("Resources").get("Font");
  const fontOf = (n: string) => fonts.get(n);
  const src = "BT /F1 12 Tf [(w)-200(vq)] TJ /F2 12 Tf (ok) Tj /F1 12 Tf /Span <</ActualText (x)>> BDC (wvq) Tj EMC ET";
  const out = tagContent(src, fontOf).text;
  expect(out).toContain("/Span <</ActualText <FEFF0D850DA90DD4>>> BDC [(w)-200(vq)] TJ EMC");
  expect(out).toContain("(ok) Tj");
  expect(out).not.toContain("(ok) Tj EMC");
  expect(out.match(/ActualText/g)).toHaveLength(2); // ours + the existing one
});

test("a word split over several operators is converted as one; inline images and q/Q are respected", () => {
  const fonts = legacyPdf("", "Kalaham").findPage(0).get("Resources").get("Font");
  // Tamil "உணவுப்" written as two operators with the pulli on its own (as PowerPoint does).
  const src = "q BT /F1 66 Tf [(czTg)] TJ ET BT [(;)] TJ ET Q BI /W 1 /H 1 /BPC 8 /CS /G ID ÿTj EI BT (zz) Tj ET";
  const out = tagContent(src, (n) => fonts.get(n)).text;
  expect(out).toContain("<FEFF0B890BA30BB50BC10BAA0BCD>>> BDC [(czTg)] TJ"); // உணவுப்  (pulli attached)
  expect(out).toContain("<FEFF>>> BDC [(;)] TJ"); // its glyph is covered by the previous span
  expect(out).toContain("ID ÿTj EI"); // image bytes untouched
  expect(out).toMatch(/BT \(zz\) Tj ET$/); // font restored to none by Q: not tagged
});

test("convertDocument: other apps' text becomes Unicode with word spaces; the page looks identical; undo-able", () => {
  // Two words placed separately, with no space glyph between them (as Word does).
  // (Words without a ZWJ: this stand-in font has no widths, so MuPDF would guess gaps inside conjuncts.)
  const pdf = legacyPdf("BT /F1 20 Tf 20 100 Td (wdydr) Tj 90 0 Td (,dxlslhka) Tj ET");
  expect(needsUnicode(pdf)).toBe(true);
  const before = pixels(pdf);
  expect(convertDocument(pdf)).toBe(2);
  const saved = new mupdf.PDFDocument(pdf.saveToBuffer("garbage,compress").asUint8Array().slice());
  expect(text(saved)).toBe("ආහාර ලාංකිකයන්");
  expect(pixels(saved)).toEqual(before);
  expect(needsUnicode(saved)).toBe(false);
});

test("the engine offers conversion, applies it as one undoable edit, and keeps searching right", async () => {
  const engine = new DocumentEngine();
  const bytes = legacyPdf("BT /F1 20 Tf 20 100 Td (Y%S ,dxlslhka) Tj ET").saveToBuffer("").asUint8Array().slice();
  const opened = engine.open("d", bytes);
  expect(opened.status === "ok" && opened.info.legacyText).toBe(true);
  const r = await engine.convertToUnicode("d");
  expect(r.tagged).toBe(1);
  expect(r.info?.legacyText).toBe(false);
  // LeoPDF's own search must not convert the (now Unicode) text a second time.
  expect(engine.search("d", "ලාංකිකයන්")).toHaveLength(1);
  const undone = await engine.undo("d");
  expect(undone.info?.legacyText).toBe(true);
  expect(engine.search("d", "ලාංකිකයන්")).toHaveLength(1);
});
