import * as hb from "harfbuzzjs";
import { expect, test } from "vitest";
import { FontRegistry } from "./font-registry";
import { nodeFontSource } from "./node-font-source";
import { loadStyleFonts, shapeLine, shapeRun, shapeText } from "./shaper";
import type { TextStyle } from "./types";

const registry = new FontRegistry(nodeFontSource);
const style: TextStyle = { family: "sans", bold: false, size: 12, color: [0, 0, 0] };

test("glyph ids match HarfBuzz directly for a Sinhala conjunct", async () => {
  const fonts = await loadStyleFonts(registry, style);
  const run = shapeRun(fonts.sinhala, "ශ්‍රී", 0, 12);
  const buf = new hb.Buffer();
  buf.addText("ශ්‍රී");
  buf.guessSegmentProperties();
  hb.shape(fonts.sinhala.hbFont, buf);
  expect(run.glyphs.map((g) => g.gid)).toEqual(buf.getGlyphInfos().map((g) => g.codepoint));
  expect(run.glyphs.length).toBeLessThan(Array.from("ශ්‍රී").length); // conjunct forms fewer glyphs
});

test("mixed line uses one run per script with clusters indexing the whole line", async () => {
  const fonts = await loadStyleFonts(registry, style);
  const text = "Colombo කොළඹ யாழ்ப்பாணம்";
  const line = shapeLine(text, style, fonts);
  expect(line.runs.map((r) => r.font.key)).toEqual(["latin-sans-regular", "sinhala-sans-regular", "tamil-sans-regular"]);
  expect(Math.min(...line.runs[1].glyphs.map((g) => g.cluster))).toBe(text.indexOf("ක"));
  expect(line.width).toBeCloseTo(line.runs.reduce((w, r) => w + r.width, 0));
  expect(line.missing).toEqual([]);
});

test("width scales with font size", async () => {
  const fonts = await loadStyleFonts(registry, style);
  const small = shapeLine("ශ්‍රී ලංකාව", style, fonts);
  const large = shapeLine("ශ්‍රී ලංකාව", { ...style, size: 24 }, fonts);
  expect(large.width).toBeCloseTo(small.width * 2);
});

test("characters no bundled font has are reported as missing", async () => {
  const fonts = await loadStyleFonts(registry, style);
  expect(shapeLine("කොළඹ 中", style, fonts).missing).toEqual(["中"]);
});

test("shapeText splits lines on newlines", async () => {
  const fonts = await loadStyleFonts(registry, style);
  expect(shapeText("කොළඹ\nயாழ்ப்பாணம்\n", style, fonts).map((l) => l.text)).toEqual(["කොළඹ", "யாழ்ப்பாணம்", ""]);
});
