import * as hb from "harfbuzzjs";
import * as mupdf from "mupdf";
import type { FontKey } from "./fonts";

export type FontSource = (key: FontKey) => Promise<Uint8Array>;

export interface LoadedFont {
  key: FontKey;
  bytes: Uint8Array;
  upem: number;
  hbFont: hb.Font;
  mu: mupdf.Font;
  hasChar(ch: string): boolean;
  /** Advance MuPDF writes into the embedded font's /W array, in font units. */
  defaultAdvance(gid: number): number;
}

function load(key: FontKey, bytes: Uint8Array): LoadedFont {
  const face = new hb.Face(new hb.Blob(bytes));
  const mu = new mupdf.Font(key, bytes);
  const upem = face.upem;
  return {
    key,
    bytes,
    upem,
    hbFont: new hb.Font(face),
    mu,
    hasChar: (ch) => mu.encodeCharacter(ch.codePointAt(0)!) > 0,
    defaultAdvance: (gid) => mu.advanceGlyph(gid) * upem,
  };
}

/** Loads each bundled font once (bytes + HarfBuzz + MuPDF objects). */
export class FontRegistry {
  private fonts = new Map<FontKey, Promise<LoadedFont>>();

  constructor(private readonly source: FontSource) {}

  get(key: FontKey): Promise<LoadedFont> {
    let font = this.fonts.get(key);
    if (!font) {
      font = this.source(key).then((bytes) => load(key, bytes));
      font.catch(() => this.fonts.delete(key));
      this.fonts.set(key, font);
    }
    return font;
  }
}
