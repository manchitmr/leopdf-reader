import { expect, test } from "vitest";
import { FontRegistry } from "./font-registry";
import { nodeFontSource } from "./node-font-source";
import { loadStyleFonts, shapeLine } from "./shaper";
import { clusterSpans, fmt, textContent, utf16Hex, type FontUse } from "./text-writer";
import type { TextStyle } from "./types";

const registry = new FontRegistry(nodeFontSource);
const style: TextStyle = { family: "sans", bold: false, size: 12, color: [0.2, 0, 1] };

test("fmt rounds to 3 decimals without -0", () => {
  expect(fmt(1.23456)).toBe("1.235");
  expect(fmt(-0.0001)).toBe("0");
  expect(fmt(12)).toBe("12");
});

test("utf16Hex encodes BMP and astral characters", () => {
  expect(utf16Hex("ක")).toBe("0D9A");
  expect(utf16Hex("𑇡")).toBe("D804DDE1");
});

test("cluster spans cover the run text exactly once, in order", async () => {
  const fonts = await loadStyleFonts(registry, style);
  const run = shapeLine("ශ්‍රී ලංකාව කොළඹ", style, fonts).runs[0];
  const spans = clusterSpans(run);
  expect(spans.map((s) => s.text).join("")).toBe(run.text);
  expect(spans.every((s) => s.glyphs.length > 0)).toBe(true);
});

test("content has colour, font, one ActualText span per cluster, and balanced operators", async () => {
  const fonts = await loadStyleFonts(registry, style);
  const line = shapeLine("කොළඹ Colombo", style, fonts);
  const recorded: string[] = [];
  const use = (): FontUse => ({ resourceName: "F1", record: (_g, text) => void recorded.push(text) });
  const content = textContent({ lines: [line], size: 12, color: style.color, lineMatrix: () => [1, 0, 0, 1, 10, 20] }, use);
  expect(content.startsWith("q BT 0.2 0 1 rg\n1 0 0 1 10 20 Tm\n")).toBe(true);
  expect(content).toContain("/F1 12 Tf");
  const spans = content.match(/\/ActualText/g)!.length;
  expect(spans).toBe(recorded.length);
  expect(recorded.join("")).toBe("කොළඹ Colombo");
  expect(content.match(/ BDC /g)!.length).toBe(content.match(/EMC/g)!.length);
  expect(content.trimEnd().endsWith("ET Q")).toBe(true);
});

test("a wide leftover glyph gets a ZWNJ ActualText span so extractors keep the line together", async () => {
  const fonts = await loadStyleFonts(registry, style);
  const use = (): FontUse => ({ resourceName: "F1", record: () => {} });
  const content = (text: string) =>
    textContent({ lines: [shapeLine(text, style, fonts)], size: 12, color: [0, 0, 0], lineMatrix: () => [1, 0, 0, 1, 0, 0] }, use);
  expect(content("கௌரவம்")).toContain("<FEFF200C>");
  expect(content("කොළඹ")).not.toContain("<FEFF200C>");
  expect(content("கொழும்பு")).not.toContain("<FEFF200C>");
});
