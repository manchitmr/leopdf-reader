import type { Quad } from "../engine/types";
import bamini from "./legacy-maps/bamini.json";
import fm from "./legacy-maps/fm-abhaya.json";

/**
 * Pre-Unicode fonts draw Sinhala/Tamil glyphs at Latin codes, so their text extracts as "Y%S ,dxlslhka".
 * Sinhala ones (FM*, DL-*, Abhaya, Basuru, Derana, A-KELANI …) share the Wijesekara layout; the Tamil ones
 * listed share Bamini's. Names are matched without their subset prefix.
 */
const SINHALA = /^(fm|dl-|dl_|sinhamethsara|apex|basuru|abhaya(?!.?libre)|derana|a-kelani|kaputa|thibus)/i;
const TAMIL = /^(bamini|baamini|kalaham|tharmini|kamalam|ravib|thenmoli|aabohi)/i;
/** Legacy fonts with other layouts we can't convert yet (their lines stay locked). */
const OTHER = /^(vanavil|senthamil|tam-|tab-)/i;

export type LegacyScript = "sinhala" | "tamil";

const bareName = (font: string) => font.replace(/^[A-Z]{6}\+/, "");

/** Which conversion a font's text needs, or null for Unicode fonts. */
export function legacyScript(font: string): LegacyScript | null {
  const name = bareName(font);
  return SINHALA.test(name) ? "sinhala" : TAMIL.test(name) ? "tamil" : null;
}

export const isLegacyFont = (font: string) => legacyScript(font) !== null || OTHER.test(bareName(font));

interface Table {
  /** Length-preserving rewrites applied first (they fix glyph-order quirks), so positions still line up. */
  rules: [RegExp, Record<string, string>] | null;
  letters: Record<string, string>;
  pattern: RegExp;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function table(letters: Record<string, string>, rules: Record<string, string> | null): Table {
  const keys = Object.keys(letters).sort((a, b) => b.length - a.length);
  return {
    rules: rules ? [new RegExp(Object.keys(rules).map(escape).join("|"), "g"), rules] : null,
    letters,
    pattern: new RegExp(keys.map(escape).join("|"), "y"),
  };
}

const TABLES: Record<LegacyScript, Table> = {
  sinhala: table(fm.letters, fm.rules),
  // Kalaham and similar fonts draw ர before ி/ீ with the ா stroke ("hp"), which never occurs otherwise.
  tamil: table(bamini.letters, { hp: "up", hP: "uP" }),
};

/** Splits legacy text into tokens, each with its Unicode and the source range it came from. */
function tokens(text: string, script: LegacyScript): { unicode: string; start: number; end: number }[] {
  const t = TABLES[script];
  const src = t.rules ? text.replace(t.rules[0], (m) => t.rules![1][m]) : text;
  const out: { unicode: string; start: number; end: number }[] = [];
  for (let i = 0; i < src.length; ) {
    t.pattern.lastIndex = i;
    const m = t.pattern.exec(src);
    const len = m ? m[0].length : 1;
    out.push({ unicode: m ? t.letters[m[0]] : src[i], start: i, end: i + len });
    i += len;
  }
  return out;
}

/** Converts text typed in a legacy font to Unicode. */
export const convertLegacy = (text: string, script: LegacyScript) =>
  tokens(text, script)
    .map((t) => t.unicode)
    .join("");

export interface SourceChar {
  c: string;
  font: string;
  quad: Quad | null;
}

/**
 * Text items for a run of extracted characters, with legacy-font runs turned into Unicode. Each converted
 * token becomes one item placed where its source characters were (search highlights and copy use this).
 */
export function unicodeItems(chars: SourceChar[]): { c: string; quad: Quad | null }[] {
  const out: { c: string; quad: Quad | null }[] = [];
  for (let i = 0; i < chars.length; ) {
    const script = legacyScript(chars[i].font);
    let j = i + 1;
    while (j < chars.length && legacyScript(chars[j].font) === script) j++;
    const run = chars.slice(i, j);
    if (!script) out.push(...run.map(({ c, quad }) => ({ c, quad })));
    else {
      for (const t of tokens(run.map((ch) => ch.c).join(""), script)) {
        const quads = run.slice(t.start, t.end).map((ch) => ch.quad).filter((q): q is Quad => q !== null);
        out.push({ c: t.unicode, quad: quads.length ? union(quads) : null });
      }
    }
    i = j;
  }
  return out;
}

function union(quads: Quad[]): Quad {
  const xs = quads.flatMap((q) => [q[0], q[2], q[4], q[6]]);
  const ys = quads.flatMap((q) => [q[1], q[3], q[5], q[7]]);
  const [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  return [x0, y0, x1, y0, x0, y1, x1, y1];
}
