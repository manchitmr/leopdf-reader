import * as mupdf from "mupdf";
import { expect, test } from "vitest";
import { DocumentEngine } from "../engine/document-engine";
import { EmbeddedFonts, toUnicodeCMap } from "./embedded-fonts";
import { FontRegistry } from "./font-registry";
import { nodeFontSource } from "./node-font-source";
import { loadStyleFonts, shapeText } from "./shaper";
import { textContent } from "./text-writer";
import type { TextStyle } from "./types";

mupdf.setLog({ warning: () => {}, error: () => {} });
const registry = new FontRegistry(nodeFontSource);

export const CORPUS = [
  "ශ්‍රී ලංකාව නව පෙළ කොළඹ",
  "ප්‍රජාතාන්ත්‍රික ක්‍රියාව ද්‍රව්‍ය",
  "යාපනය කෝට්ටේ ගෞරවය ශාස්ත්‍රීය",
  "யாழ்ப்பாணம் கொழும்பு ஸ்ரீ லங்கா",
  "கொடுத்தார் போனேன் கௌரவம்",
  "Hello ffi 2026, Colombo (LK)",
  "ශ්‍රී ලංකා (2026), யாழ்ப்பாணம்!",
];

/** Writes `lines` onto a blank page with a fresh document and returns the saved bytes. */
export async function writeBlankPdf(lines: string[], style: TextStyle): Promise<Uint8Array> {
  const fonts = await loadStyleFonts(registry, style);
  const doc = new mupdf.PDFDocument();
  const embedded = new EmbeddedFonts(doc);
  const fontDict = doc.newDictionary();
  const content = textContent(
    { lines: shapeText(lines.join("\n"), style, fonts), size: style.size, color: style.color, lineMatrix: (i) => [1, 0, 0, 1, 40, 780 - i * 30] },
    (run) => {
      const use = embedded.use(run.font);
      fontDict.put(use.resourceName, use.ref);
      return use;
    },
  );
  embedded.flush();
  const resources = doc.addObject(doc.newDictionary());
  resources.put("Font", fontDict);
  doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, resources, content));
  const tmp = new mupdf.PDFDocument(doc.saveToBuffer("").asUint8Array().slice());
  tmp.subsetFonts();
  return tmp.saveToBuffer("garbage,compress").asUint8Array().slice();
}

function extractLines(bytes: Uint8Array): string[] {
  const page = mupdf.Document.openDocument(bytes, "application/pdf").loadPage(0);
  // Wide leftover glyphs carry ZWNJ ActualText (see text-writer spanOps); ignore it like search does.
  return page.toStructuredText("preserve-whitespace").asText().split("\n").filter((l) => l.trim().length > 0).map((l) => l.replace(/\u200C/g, ""));
}

for (const family of ["sans", "serif"] as const) {
  for (const bold of [false, true]) {
    test(`MuPDF extracts every corpus line exactly (${family}${bold ? " bold" : ""})`, async () => {
      const bytes = await writeBlankPdf(CORPUS, { family, bold, size: 14, color: [0, 0, 0] });
      expect(extractLines(bytes)).toEqual(CORPUS);
    });
  }
}

test("every corpus word is found by LeoPDF search (Unicode-normalised)", async () => {
  const bytes = await writeBlankPdf(CORPUS, { family: "sans", bold: false, size: 14, color: [0, 0, 0] });
  const engine = new DocumentEngine();
  engine.open("rt", bytes);
  for (const word of CORPUS.join(" ").split(/\s+/).map((w) => w.replace(/[(),!]/g, "")).filter(Boolean)) {
    expect(engine.search("rt", word).length, word).toBeGreaterThan(0);
  }
});

test("subsetting keeps fonts small", async () => {
  const bytes = await writeBlankPdf(CORPUS, { family: "sans", bold: false, size: 14, color: [0, 0, 0] });
  expect(bytes.length).toBeLessThan(80_000);
});

test("ToUnicode CMap lists only non-empty mappings", () => {
  const cmap = toUnicodeCMap(new Map([[5, "ශ්‍රී"], [6, ""], [7, "A"]]));
  expect(cmap).toContain("2 beginbfchar");
  expect(cmap).toContain("<0005> <0DC10DCA200D0DBB0DD3>");
  expect(cmap).not.toContain("<0006>");
});
