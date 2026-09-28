import * as hb from "harfbuzzjs";
import type { FontRegistry, LoadedFont } from "./font-registry";
import { fontKey } from "./fonts";
import { splitScripts, type Script } from "./scripts";
import type { TextStyle } from "./types";

export interface ShapedGlyph {
  gid: number;
  /** Pen advance in points. */
  advance: number;
  /** Offset from the pen position, points (y up). */
  dx: number;
  dy: number;
  /** UTF-16 index in the line text where this glyph's cluster starts. */
  cluster: number;
}

export interface ShapedRun {
  font: LoadedFont;
  text: string;
  /** UTF-16 offset of the run in the line text. */
  start: number;
  glyphs: ShapedGlyph[];
  width: number;
}

export interface ShapedLine {
  text: string;
  runs: ShapedRun[];
  width: number;
  /** Characters rendered as notdef because no bundled font has them. */
  missing: string[];
}

const SCRIPTS: Script[] = ["latin", "sinhala", "tamil"];

export async function loadStyleFonts(registry: FontRegistry, style: TextStyle): Promise<Record<Script, LoadedFont>> {
  const fonts = await Promise.all(SCRIPTS.map((s) => registry.get(fontKey(s, style.family, style.bold))));
  return { latin: fonts[0], sinhala: fonts[1], tamil: fonts[2] };
}

export function shapeRun(font: LoadedFont, text: string, start: number, size: number): ShapedRun {
  const buffer = new hb.Buffer();
  buffer.addText(text);
  buffer.guessSegmentProperties();
  hb.shape(font.hbFont, buffer);
  const k = size / font.upem;
  const positions = buffer.getGlyphPositions();
  const glyphs = buffer.getGlyphInfos().map((info, i) => ({
    gid: info.codepoint,
    advance: positions[i].xAdvance * k,
    dx: positions[i].xOffset * k,
    dy: positions[i].yOffset * k,
    cluster: start + info.cluster,
  }));
  return { font, text, start, glyphs, width: glyphs.reduce((w, g) => w + g.advance, 0) };
}

export function shapeLine(text: string, style: TextStyle, fonts: Record<Script, LoadedFont>): ShapedLine {
  const runs = splitScripts(text, (script, ch) => fonts[script].hasChar(ch)).map((r) => shapeRun(fonts[r.script], r.text, r.start, style.size));
  const missing = new Set<string>();
  for (const run of runs) {
    for (const g of run.glyphs) if (g.gid === 0) missing.add(String.fromCodePoint(text.codePointAt(g.cluster)!));
  }
  return { text, runs, width: runs.reduce((w, r) => w + r.width, 0), missing: [...missing] };
}

export function shapeText(text: string, style: TextStyle, fonts: Record<Script, LoadedFont>): ShapedLine[] {
  return text.split("\n").map((line) => shapeLine(line, style, fonts));
}
