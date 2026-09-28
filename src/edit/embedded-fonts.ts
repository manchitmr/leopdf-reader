import * as mupdf from "mupdf";
import type { LoadedFont } from "./font-registry";
import type { FontKey } from "./fonts";
import type { ShapedGlyph } from "./shaper";
import { utf16Hex } from "./text-writer";

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");

export function toUnicodeCMap(map: Map<number, string>): string {
  const entries = [...map.entries()].filter(([, text]) => text.length > 0).sort((a, b) => a[0] - b[0]);
  const lines = entries.map(([gid, text]) => `<${hex4(gid)}> <${utf16Hex(text)}>`);
  const chunks: string[] = [];
  for (let i = 0; i < lines.length; i += 100) {
    const chunk = lines.slice(i, i + 100);
    chunks.push(`${chunk.length} beginbfchar\n${chunk.join("\n")}\nendbfchar`);
  }
  return [
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def /CMapType 2 def",
    "1 begincodespacerange <0000> <FFFF> endcodespacerange",
    ...chunks,
    "endcmap CMapName currentdict /CMap defineresource pop end end",
  ].join("\n");
}

interface Embedded {
  font: LoadedFont;
  ref: mupdf.PDFObject;
  resourceName: string;
  /** glyph id → the character the font's cmap maps to it */
  natural: Map<number, string>;
  toUnicode: Map<number, string>;
  dirty: boolean;
}

/** Embeds bundled fonts into one document and keeps their ToUnicode maps in step with what was written. */
export class EmbeddedFonts {
  private fonts = new Map<FontKey, Embedded>();

  constructor(private readonly pdf: mupdf.PDFDocument) {}

  use(font: LoadedFont) {
    let e = this.fonts.get(font.key);
    if (!e) {
      e = { font, ref: this.pdf.addFont(font.mu), resourceName: `LeoF-${font.key}`, natural: new Map(), toUnicode: new Map(), dirty: true };
      this.fonts.set(font.key, e);
    }
    const entry = e;
    return { ref: entry.ref, resourceName: entry.resourceName, record: (glyphs: ShapedGlyph[], text: string) => this.record(entry, glyphs, text) };
  }

  /** Writes changed ToUnicode maps into the document. Call before ending an edit operation. */
  flush(): void {
    for (const e of this.fonts.values()) {
      if (!e.dirty) continue;
      const cmap = toUnicodeCMap(e.toUnicode);
      const existing = e.ref.get("ToUnicode");
      if (existing.isStream()) existing.writeStream(cmap);
      else e.ref.put("ToUnicode", this.pdf.addStream(cmap, this.pdf.newDictionary()));
      e.dirty = false;
    }
  }

  /** Forget embedded fonts (after undo/redo may have removed them); the next write embeds afresh. */
  reset(): void {
    this.fonts.clear();
  }

  private record(e: Embedded, glyphs: ShapedGlyph[], text: string): void {
    for (const ch of new Set([...Array.from(text), ...Array.from(text.normalize("NFD"))])) {
      const gid = e.font.mu.encodeCharacter(ch.codePointAt(0)!);
      if (gid > 0 && !e.natural.has(gid)) e.natural.set(gid, ch);
    }
    const set = (gid: number, value: string) => {
      if (e.toUnicode.has(gid)) return;
      e.toUnicode.set(gid, value);
      e.dirty = true;
    };
    if (glyphs.length === 1) {
      set(glyphs[0].gid, text);
      return;
    }
    // Several glyphs for one cluster: glyphs with a natural character keep it; the rest share
    // whatever characters of the cluster are left, so the concatenation stays close to the text.
    let remaining = Array.from(text.normalize("NFD"));
    for (const g of glyphs) {
      const ch = e.natural.get(g.gid);
      const at = ch ? remaining.indexOf(ch.normalize("NFD")) : -1;
      if (at >= 0) remaining.splice(at, 1);
    }
    for (const g of glyphs) {
      const ch = e.natural.get(g.gid);
      if (ch) set(g.gid, ch);
      else if (remaining.length > 0) {
        set(g.gid, remaining.join(""));
        remaining = [];
      } else set(g.gid, "");
    }
  }
}
