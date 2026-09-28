import type { Matrix } from "../engine/types";
import type { ShapedGlyph, ShapedLine, ShapedRun } from "./shaper";

export function fmt(n: number): string {
  const s = String(Math.round(n * 1000) / 1000);
  return s === "-0" ? "0" : s;
}

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");

/** UTF-16BE hex (no BOM) as used in PDF text strings and ToUnicode CMaps. */
export function utf16Hex(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) out += hex4(s.charCodeAt(i));
  return out;
}

/** Groups a run's glyphs by HarfBuzz cluster with the source text each cluster stands for. */
export function clusterSpans(run: ShapedRun): { glyphs: ShapedGlyph[]; text: string }[] {
  const starts = [...new Set(run.glyphs.map((g) => g.cluster))].sort((a, b) => a - b);
  const end = run.start + run.text.length;
  const spans: { glyphs: ShapedGlyph[]; text: string }[] = [];
  let i = 0;
  while (i < run.glyphs.length) {
    let j = i;
    while (j < run.glyphs.length && run.glyphs[j].cluster === run.glyphs[i].cluster) j++;
    const cluster = run.glyphs[i].cluster;
    const next = starts[starts.indexOf(cluster) + 1] ?? end;
    spans.push({ glyphs: run.glyphs.slice(i, j), text: run.text.slice(cluster - run.start, next - run.start) });
    i = j;
  }
  return spans;
}

/**
 * TJ operators for one cluster: glyph ids with advance corrections so each glyph lands exactly where
 * HarfBuzz placed it, and text rise (Ts) for vertical offsets. Stays in visual order (viewers expect it).
 */
export function glyphOps(run: ShapedRun, glyphs: ShapedGlyph[], size: number): string {
  let ops = "";
  let array = "";
  let rise = 0;
  const toThousandths = (points: number) => fmt((-points * 1000) / size);
  for (const g of glyphs) {
    if (Math.abs(g.dy - rise) > 1e-3) {
      if (array) ops += `[${array}] TJ `;
      array = "";
      ops += `${fmt(g.dy)} Ts `;
      rise = g.dy;
    }
    if (Math.abs(g.dx) > 1e-3) array += `${toThousandths(g.dx)} `;
    array += `<${hex4(g.gid)}> `;
    const drawn = (run.font.defaultAdvance(g.gid) * size) / run.font.upem;
    const correction = g.advance - g.dx - drawn;
    if (Math.abs(correction) > 1e-3) array += `${toThousandths(correction)} `;
  }
  if (array) ops += `[${array}] TJ `;
  if (Math.abs(rise) > 1e-3) ops += "0 Ts ";
  return ops;
}

/**
 * One cluster as marked content. Extractors (MuPDF among them) give ActualText characters to glyphs one
 * by one; if a cluster has more glyphs than characters and the leftover glyphs are wide (Tamil ௌ's au
 * length mark), their empty area splits the line. Those glyphs get their own span of zero-width
 * non-joiners, which search ignores.
 */
function spanOps(run: ShapedRun, glyphs: ShapedGlyph[], text: string, size: number): string {
  const n = Array.from(text).length;
  const leftover = glyphs.slice(n);
  const leftoverWidth = leftover.reduce((w, g) => w + g.advance, 0);
  if (leftover.length === 0 || leftoverWidth < size * 0.8) {
    return `/Span <</ActualText <FEFF${utf16Hex(text)}>>> BDC ${glyphOps(run, glyphs, size)}EMC\n`;
  }
  return (
    `/Span <</ActualText <FEFF${utf16Hex(text)}>>> BDC ${glyphOps(run, glyphs.slice(0, n), size)}EMC\n` +
    `/Span <</ActualText <FEFF${utf16Hex("\u200C".repeat(leftover.length))}>>> BDC ${glyphOps(run, leftover, size)}EMC\n`
  );
}

export interface FontUse {
  resourceName: string;
  /** Called for every cluster written, so the font's ToUnicode map can learn it. */
  record(glyphs: ShapedGlyph[], text: string): void;
}

export interface TextBlock {
  lines: ShapedLine[];
  size: number;
  color: [number, number, number];
  /** Text matrix (PDF space) for the start of each line's baseline. */
  lineMatrix(line: number): Matrix;
}

export function textContent(block: TextBlock, useFont: (run: ShapedRun) => FontUse): string {
  const [r, g, b] = block.color;
  let out = `q BT ${fmt(r)} ${fmt(g)} ${fmt(b)} rg\n`;
  block.lines.forEach((line, index) => {
    out += `${block.lineMatrix(index).map(fmt).join(" ")} Tm\n`;
    for (const run of line.runs) {
      const font = useFont(run);
      out += `/${font.resourceName} ${fmt(block.size)} Tf\n`;
      for (const span of clusterSpans(run)) {
        font.record(span.glyphs, span.text);
        out += spanOps(run, span.glyphs, span.text, block.size);
      }
    }
  });
  return out + "ET Q\n";
}
