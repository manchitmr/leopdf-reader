import * as hb from "harfbuzzjs";
import * as mupdf from "mupdf";
import type { FontKey } from "./fonts";
import type { SystemFace } from "./types";

export type FontSource = (key: FontKey) => Promise<Uint8Array>;
/** Reads an installed font file (by path; the app only allows fonts it listed). */
export type FaceSource = (path: string) => Promise<Uint8Array>;

export interface LoadedFont {
  /** Bundled FontKey, or "face:<path>#<index>" for an installed font. */
  key: string;
  bold: boolean;
  bytes: Uint8Array;
  upem: number;
  hbFont: hb.Font;
  mu: mupdf.Font;
  hasChar(ch: string): boolean;
  /** Advance MuPDF writes into the embedded font's /W array, in font units. */
  defaultAdvance(gid: number): number;
}

function load(key: string, bytes: Uint8Array, bold: boolean, index = 0): LoadedFont {
  const face = new hb.Face(new hb.Blob(bytes), index);
  const mu = new mupdf.Font(key, bytes, index);
  const upem = face.upem;
  return {
    key,
    bold,
    bytes,
    upem,
    hbFont: new hb.Font(face),
    mu,
    hasChar: (ch) => mu.encodeCharacter(ch.codePointAt(0)!) > 0,
    defaultAdvance: (gid) => mu.advanceGlyph(gid) * upem,
  };
}

const noFaces: FaceSource = async (path) => {
  throw new Error(`Installed fonts are not available here (${path})`);
};

/** Loads each font once (bytes + HarfBuzz + MuPDF objects): bundled ones by key, installed ones by path. */
export class FontRegistry {
  private fonts = new Map<string, Promise<LoadedFont>>();

  constructor(
    private readonly source: FontSource,
    public faceSource: FaceSource = noFaces,
  ) {}

  get(key: FontKey): Promise<LoadedFont> {
    return this.cached(key, async () => load(key, await this.source(key), key.endsWith("-bold")));
  }

  face(face: SystemFace): Promise<LoadedFont> {
    const key = `face:${face.path}#${face.index}`;
    return this.cached(key, async () => load(key, await this.faceSource(face.path), face.bold, face.index));
  }

  private cached(key: string, make: () => Promise<LoadedFont>): Promise<LoadedFont> {
    let font = this.fonts.get(key);
    if (!font) {
      font = make();
      font.catch(() => this.fonts.delete(key));
      this.fonts.set(key, font);
    }
    return font;
  }
}
