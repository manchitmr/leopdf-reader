import * as mupdf from "mupdf";
import type { LoadedFont } from "./font-registry";
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

/** Each bundled font as a PDF font object in a scratch document, built once and copied into documents. */
const scratch = new WeakMap<LoadedFont, mupdf.PDFObject>();

/**
 * Copies the font into `pdf`. Not `pdf.addFont`: MuPDF caches that per document, and after an undo
 * removed the font objects the cache still hands back their (now empty) object number.
 */
function embedFont(pdf: mupdf.PDFDocument, font: LoadedFont): mupdf.PDFObject {
  let ref = scratch.get(font);
  if (!ref) {
    ref = new mupdf.PDFDocument().addFont(font.mu);
    scratch.set(font, ref);
  }
  return pdf.graftObject(ref);
}

/** A PDF name for the font resource: bundled keys as they are, installed fonts as a hash of their path. */
function resourceName(key: string): string {
  if (!key.startsWith("face:")) return `LeoF-${key}`;
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0;
  return `LeoF-face-${h.toString(36)}`;
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
  private fonts = new Map<string, Embedded>();

  constructor(private readonly pdf: mupdf.PDFDocument) {}

  use(font: LoadedFont) {
    let e = this.fonts.get(font.key);
    if (!e) {
      e = { font, ref: embedFont(this.pdf, font), resourceName: resourceName(font.key), natural: new Map(), toUnicode: new Map(), dirty: true };
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
