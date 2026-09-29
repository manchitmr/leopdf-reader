import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { beforeEach, expect, test } from "vitest";
import { DocumentEditor } from "./editor";
import { FontRegistry } from "./font-registry";
import { fixVisualOrder, isLegacyFont } from "./lines";
import { nodeFontSource } from "./node-font-source";

mupdf.setLog({ warning: () => {}, error: () => {} });
const registry = new FontRegistry(nodeFontSource);

// Strings as MuPDF extracts them from real Word / PowerPoint PDFs (Iskoola Pota, Latha).
test.each([
  ["ෙසෟඛ්‍ය", "සෞඛ්‍ය"], // ෙසෟඛ්‍ය → සෞඛ්‍ය
  ["රජෙය්", "රජයේ"], // රජෙය් → රජයේ
  ["ිලධාරියාෙග්", "ිලධාරියාගේ"], // …යාෙග් → …යාගේ
  ["චක්‍රෙල්ඛය", "චක්‍රලේඛය"], // චක්‍රෙල්ඛය → චක්‍රලේඛය
  ["ෙප්‍ර", "ප්‍රෙ"], // ෙප්‍ර → ප්‍රෙ (kombuva before a rakaransaya cluster)
  ["ෙකා", "කො"], // ෙකා → කො
  ["ெகா", "கொ"], // Tamil ெகா → கொ
  ["ைக", "கை"], // Tamil ைக → கை
])("visual order %s is fixed", (input, expected) => {
  expect(fixVisualOrder(input, true)).toBe(expected);
});

test("logical text is left alone, but stray spaces before vowel signs go", () => {
  expect(fixVisualOrder("කෙස්", false)).toBe("කෙස්"); // කෙස්
  expect(fixVisualOrder("ප ෝෂණ", false)).toBe("පෝෂණ"); // ප ෝෂණ → පෝෂණ
  expect(fixVisualOrder("ஆர ோக்", false)).toBe("ஆரோக்"); // ஆர ோக் → ஆரோக்
});

test.each(["ZJQJBK+FMAbhayax", "FMGanganeex", "BCDEEE+DL-Sumudu.", "KSYWNS+Abhaya", "A-KELANI", "BCDHEE+Bamini", "ABCDEE+Kalaham", "RAVIBNormal", "TharminiBold", "SINHAMethsara2012"])(
  "%s is legacy",
  (name) => expect(isLegacyFont(name)).toBe(true),
);
test.each(["XQTPST+IskoolaPota-Bold", "BCDGEE+Latha", "NotoSansSinhala", "Calibri", "ArialMT", "BCDKEE+Vijaya", "CAAAAA+SinhalaMN", "AbhayaLibre-Regular"])("%s is Unicode", (name) =>
  expect(isLegacyFont(name)).toBe(false),
);

let pdf: mupdf.PDFDocument;
let editor: DocumentEditor;
beforeEach(() => {
  pdf = new mupdf.PDFDocument(readFileSync(new URL("../../tests/fixtures/sample-si-ta.pdf", import.meta.url)));
  editor = new DocumentEditor(pdf, registry);
});
const pageText = (doc: mupdf.Document = pdf) => doc.loadPage(0).toStructuredText("preserve-whitespace").asText();
const SINHALA_LINE = "ශ්‍රී ලංකාව ප්‍රජාතාන්ත්‍රික සමාජවාදී ජනරජය";

test("lists the fixture's lines with text, baseline and style", async () => {
  const lines = (await editor.listLines(0));
  expect(lines.map((l) => l.text)).toEqual(["Chapter One", "Hello world", SINHALA_LINE, "யாழ்ப்பாணம் கொழும்பு ஸ்ரீ லங்கா"]);
  const hello = lines[1];
  expect(hello.style).toMatchObject({ family: "serif", bold: false, color: [0, 0, 0] });
  // Times 12 → Noto Serif at the size that spans the same width (Noto is wider).
  expect(hello.style.size).toBeGreaterThan(9.5);
  expect(hello.style.size).toBeLessThan(12);
  expect(hello.origin[1]).toBeGreaterThan(hello.rect[1]);
  expect(hello.origin[1]).toBeLessThan(hello.rect[3]);
  expect(lines.every((l) => !l.locked)).toBe(true);
});

test("replacing a line changes only that line; undo restores it; saved file keeps it", async () => {
  const line = (await editor.listLines(0))[2];
  const r = await editor.replaceLine(0, line, "ශ්‍රී ලංකා ජනරජය", line.style);
  expect(r.id).toBeTruthy();
  expect(pageText()).toContain("ශ්‍රී ලංකා ජනරජය");
  expect(pageText()).not.toContain(SINHALA_LINE);
  for (const other of ["Chapter One", "Hello world", "யாழ்ப்பாணம்"]) expect(pageText()).toContain(other);
  // The new text is a LeoPDF object now, not an original line.
  expect((await editor.listLines(0)).map((l) => l.text)).not.toContain("ශ්‍රී ලංකා ජනරජය");
  expect(editor.listObjects(0)).toHaveLength(1);

  const saved = mupdf.Document.openDocument(editor.save(), "application/pdf");
  expect(pageText(saved)).toContain("ශ්‍රී ලංකා ජනරජය");

  editor.undo();
  expect(pageText()).toContain(SINHALA_LINE);
  expect(editor.listObjects(0)).toHaveLength(0);
});

test("empty text removes the line; long text reports overflow", async () => {
  const [, hello] = (await editor.listLines(0));
  await editor.replaceLine(0, hello, "", hello.style);
  expect(pageText()).not.toContain("Hello world");
  editor.undo();
  const r = await editor.replaceLine(0, hello, "Hello world, ".repeat(20), hello.style);
  expect(r.overflow).toBe(true);
});

test("lines in legacy fonts are locked", async () => {
  const doc = new mupdf.PDFDocument();
  const font = doc.addObject(doc.newDictionary());
  font.put("Type", doc.newName("Font"));
  font.put("Subtype", doc.newName("Type1"));
  font.put("BaseFont", doc.newName("FMAbhaya"));
  const resources = doc.addObject(doc.newDictionary());
  resources.put("Font", doc.newDictionary());
  resources.get("Font").put("F1", font);
  doc.insertPage(-1, doc.addPage([0, 0, 300, 200], 0, resources, "BT /F1 14 Tf 20 100 Td (Y%S ,dxldj) Tj ET"));
  expect((await new DocumentEditor(doc, registry).listLines(0))[0]).toMatchObject({ text: "Y%S ,dxldj", locked: "legacy" });
});
