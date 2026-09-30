import * as mupdf from "mupdf";
import type { Point, Rect } from "../engine/types";
import { listObjects } from "./page-objects";
import type { EditableLine, RGB } from "./types";

/**
 * Pre-Unicode fonts that draw Sinhala/Tamil with Latin codes (extract as "Y%S ,dxlslhka…").
 * Names seen in real Sri Lankan documents; matched against the font name without its subset prefix.
 */
const LEGACY =
  /^(fm|dl-|dl_|sinhamethsara|apex|basuru|abhaya(?!.?libre)|derana|a-kelani|kaputa|thibus|bamini|baamini|kalaham|tharmini|kamalam|ravib|thenmoli|aabohi|vanavil|senthamil|tam-|tab-)/i;

export const isLegacyFont = (name: string) => LEGACY.test(name.replace(/^[A-Z]{6}\+/, ""));

/** Symbol fonts draw bullets; they stay on the page and out of the editable line. */
const SYMBOL = /wingdings|symbol|dingbat|webdings/i;

const SI_CONSONANT = "[\u0D9A-\u0DC6]";
const TA_CONSONANT = "[\u0B95-\u0BB9]";
/** A consonant with any conjunct/rakaransaya/yansaya parts that follow it (C + ් + ZWJ + C …). */
const SI_CLUSTER = `${SI_CONSONANT}(?:\u0DCA\u200D${SI_CONSONANT})*`;

// Visual order: the kombuva comes first, then the consonant, then any second part of the vowel sign.
const SI_VISUAL = new RegExp(`([\u0DD9\u0DDB])(${SI_CLUSTER})(\u0DCA(?!\u200D)|\u0DCF|\u0DDF)?`, "g");
const TA_VISUAL = new RegExp(`([\u0BC6-\u0BC8])(${TA_CONSONANT})(\u0BBE|\u0BD7)?`, "g");
/** A pre-base sign at the start of a word never happens in logical order: proof the text is visual. */
const VISUAL_EVIDENCE = /(?:^|[^\p{L}\p{M}])[\u0DD9\u0DDB\u0BC6-\u0BC8]/u;

const SI_JOIN: Record<string, string> = { "\u0DD9\u0DCA": "\u0DDA", "\u0DD9\u0DCF": "\u0DDC", "\u0DD9\u0DDF": "\u0DDE" };
const TA_JOIN: Record<string, string> = { "\u0BC6\u0BBE": "\u0BCA", "\u0BC7\u0BBE": "\u0BCB", "\u0BC6\u0BD7": "\u0BCC" };

const PRE_BASE = "\u0DD9\u0DDB\u0BC6-\u0BC8";

/**
 * Word and PowerPoint (Iskoola Pota, Latha) often write Sinhala/Tamil in visual order, so the text
 * extracts as "ෙසෟඛ්‍ය" instead of "සෞඛ්‍ය". Puts pre-base vowel signs back after their consonant,
 * joining two-part signs. Only when `visual` is true: in logical text the same letters are valid.
 * Also drops stray spaces extracted in front of a vowel sign ("ප ෝ" → "පෝ").
 */
export function fixVisualOrder(text: string, visual: boolean): string {
  let out = text;
  if (visual) {
    out = out.replace(SI_VISUAL, (_m, sign: string, cluster: string, tail = "") => cluster + (SI_JOIN[sign + tail] ?? sign + tail));
    out = out.replace(TA_VISUAL, (_m, sign: string, consonant: string, tail = "") => consonant + (TA_JOIN[sign + tail] ?? sign + tail));
  }
  return out
    .replace(new RegExp(`\\s+(?=(?![${PRE_BASE}])\\p{M})`, "gu"), "")
    // Some fonts map the kombuva glyph as ෙ and the rest of the glyph as the whole vowel: "පෙෝ".
    .replace(/\u0DD9(?=[\u0DDA\u0DDC\u0DDD\u0DDE])/g, "");
}

interface RawChar {
  c: string;
  origin: Point;
  font: mupdf.Font;
  size: number;
  quad: number[];
  color: number[];
}

function toRgb(color: number[]): RGB {
  if (color.length === 1) return [color[0], color[0], color[0]];
  if (color.length === 4) {
    const [c, m, y, k] = color;
    return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
  }
  return [color[0] ?? 0, color[1] ?? 0, color[2] ?? 0];
}

function quadRect(chars: RawChar[]): Rect {
  const xs = chars.flatMap((ch) => [ch.quad[0], ch.quad[2], ch.quad[4], ch.quad[6]]);
  const ys = chars.flatMap((ch) => [ch.quad[1], ch.quad[3], ch.quad[5], ch.quad[7]]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const overlaps = (a: Rect, b: Rect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

function mostUsedFont(chars: RawChar[]): mupdf.Font {
  const counts = new Map<string, { font: mupdf.Font; n: number }>();
  for (const ch of chars) {
    const name = ch.font.getName();
    const e = counts.get(name) ?? { font: ch.font, n: 0 };
    e.n++;
    counts.set(name, e);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.font ?? chars[0].font;
}

/** Text lines from the original page content (not LeoPDF's own text objects), in page space. */
export function listLines(page: mupdf.PDFPage): EditableLine[] {
  const raw: { chars: RawChar[]; blockRight: number }[] = [];
  let block: Rect = [0, 0, 0, 0];
  const stext = page.toStructuredText("preserve-whitespace");
  stext.walk({
    beginTextBlock: (bbox) => void (block = bbox as Rect),
    beginLine: () => void raw.push({ chars: [], blockRight: block[2] }),
    onChar: (c, origin, font, size, quad, color) => void raw[raw.length - 1].chars.push({ c, origin: origin as Point, font, size, quad, color }),
  });
  stext.destroy();

  // Visual order is a property of the font/producer: decide per font from word-initial pre-base signs.
  const visualFonts = new Set<string>();
  for (const { chars } of raw) {
    const text = chars.map((ch) => ch.c).join("");
    if (VISUAL_EVIDENCE.test(text)) chars.forEach((ch) => visualFonts.add(ch.font.getName()));
  }

  const ours = listObjects(page).filter((o) => o.kind === "text").map((o) => o.rect);
  const lines: EditableLine[] = [];
  for (const { chars, blockRight } of raw) {
    const kept = chars.filter((ch) => !SYMBOL.test(ch.font.getName()));
    const visible = kept.filter((ch) => ch.c.trim());
    if (!visible.length) continue;
    const rect = quadRect(visible);
    if (ours.some((r) => overlaps(r, rect))) continue;
    const font = mostUsedFont(visible);
    const text = fixVisualOrder(kept.map((ch) => ch.c).join(""), visualFonts.has(font.getName())).trim();
    // Real Sinhala/Tamil code points prove a Unicode font, whatever its name.
    const legacy = visible.some((ch) => isLegacyFont(ch.font.getName())) && !/[\u0D80-\u0DFF\u0B80-\u0BFF]/.test(text);
    const garbled = /[\uFFFD\uE000-\uF8FF]/.test(text) || !text;
    const first = visible[0];
    const name = font.getName();
    const fontSize = Math.round(first.size * 10) / 10;
    lines.push({
      rect,
      origin: first.origin,
      text,
      chars: visible.length,
      fontName: name.replace(/^[A-Z]{6}\+/, ""),
      fontSize,
      style: {
        family: font.isSerif() ? "serif" : "sans",
        bold: font.isBold() || /bold|black|heavy/i.test(name),
        ...(font.isItalic() || /italic|oblique/i.test(name) ? { italic: true } : {}),
        size: fontSize,
        color: toRgb(first.color),
      },
      maxRight: Math.max(blockRight, rect[2]),
      ...(legacy ? { locked: "legacy" as const } : garbled ? { locked: "no-unicode" as const } : {}),
    });
  }
  return lines;
}

const countChars = (page: mupdf.PDFPage) => {
  let n = 0;
  const stext = page.toStructuredText("preserve-whitespace");
  stext.walk({ onChar: (c) => void (c.trim() && n++) });
  stext.destroy();
  return n;
};

export class OverlapError extends Error {}

/** Font size at which `width` (measured at `size`) spans the original line; limited so odd extractions can't blow it up. */
export function fitSize(size: number, width: number, original: number): number {
  if (width <= 0 || original <= 0) return size;
  return Math.round(size * Math.min(1.15, Math.max(0.7, original / width)) * 10) / 10;
}

/**
 * Removes the text drawn in a line's box (text-only redaction; images and drawings stay). The box is
 * trimmed vertically so neighbouring lines that touch it survive; if more text disappears than the
 * line had anyway, throws OverlapError so the caller's journal operation rolls back.
 */
export function removeLineText(page: mupdf.PDFPage, line: Pick<EditableLine, "rect" | "chars">): void {
  const [x0, y0, x1, y1] = line.rect;
  const trim = (y1 - y0) * 0.2;
  const before = countChars(page);
  const annot = page.createAnnotation("Redact");
  annot.setRect([x0 - 0.5, y0 + trim, x1 + 0.5, y1 - trim]);
  page.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);
  if (before - countChars(page) > line.chars) throw new OverlapError("Redaction removed text outside the line");
}
