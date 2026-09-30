import * as mupdf from "mupdf";

export type Margins = { top: number; right: number; bottom: number; left: number };

/** Unique, in-range page indexes, ascending. */
function normalize(pdf: mupdf.PDFDocument, pages: number[]): number[] {
  const count = pdf.countPages();
  return [...new Set(pages)].filter((p) => Number.isInteger(p) && p >= 0 && p < count).sort((a, b) => a - b);
}

/** Turns pages by a multiple of 90° (clockwise). */
export function rotatePages(pdf: mupdf.PDFDocument, pages: number[], degrees: number): void {
  for (const p of normalize(pdf, pages)) {
    const page = pdf.findPage(p);
    const current = page.get("Rotate").isNumber() ? page.get("Rotate").asNumber() : 0;
    page.put("Rotate", (((current + degrees) % 360) + 360) % 360);
  }
}

export function deletePages(pdf: mupdf.PDFDocument, pages: number[]): void {
  const doomed = normalize(pdf, pages);
  if (doomed.length >= pdf.countPages()) throw new Error("A PDF must keep at least one page");
  for (const p of doomed.reverse()) pdf.deletePage(p);
}

/**
 * Moves `pages` (keeping their order) so they sit before the page that is currently at index `before`
 * (`before` = page count moves them to the end). Returns the pages' new indexes.
 */
export function movePages(pdf: mupdf.PDFDocument, pages: number[], before: number): number[] {
  const moving = normalize(pdf, pages);
  const count = pdf.countPages();
  const all = Array.from({ length: count }, (_, i) => i);
  const rest = all.filter((p) => !moving.includes(p));
  const at = rest.filter((p) => p < before).length;
  const order = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  if (order.some((p, i) => p !== i)) pdf.rearrangePages(order);
  return moving.map((_, i) => at + i);
}

/** Inserts an empty page at `at`, sized like `sizeLike`'s media box (A4 if none). */
export function insertBlankPage(pdf: mupdf.PDFDocument, at: number, sizeLike?: number): void {
  const like = sizeLike !== undefined && sizeLike < pdf.countPages() ? pdf.findPage(sizeLike).get("MediaBox") : null;
  const box: mupdf.Rect = like?.isArray() ? [0, 0, like.get(2).asNumber() - like.get(0).asNumber(), like.get(3).asNumber() - like.get(1).asNumber()] : [0, 0, 595.28, 841.89];
  pdf.insertPage(at, pdf.addPage(box, 0, pdf.newDictionary(), ""));
}

/** Copies all pages of another PDF into this one at `at` (-1 or the page count appends). Returns how many. */
export function insertPdf(pdf: mupdf.PDFDocument, at: number, bytes: Uint8Array): number {
  const src = new mupdf.PDFDocument(bytes);
  try {
    if (src.needsPassword()) throw new Error("That PDF is password-protected");
    const n = src.countPages();
    const start = at < 0 ? pdf.countPages() : at;
    for (let i = 0; i < n; i++) pdf.graftPage(start + i, src, i);
    return n;
  } finally {
    src.destroy();
  }
}

/** A new PDF made of `pages` of this one, in the given order. */
export function extractPages(pdf: mupdf.PDFDocument, pages: number[]): Uint8Array {
  const out = new mupdf.PDFDocument();
  try {
    for (const p of pages) out.graftPage(-1, pdf, p);
    return out.saveToBuffer("garbage,compress").asUint8Array().slice();
  } finally {
    out.destroy();
  }
}

/** Page groups for splitting every `size` pages: [[0,1],[2,3],[4]]. */
export function splitGroups(count: number, size: number): number[][] {
  const n = Math.max(1, Math.floor(size));
  return Array.from({ length: Math.ceil(count / n) }, (_, g) => Array.from({ length: Math.min(n, count - g * n) }, (_, i) => g * n + i));
}

/**
 * Trims `margins` (points, as the page is seen: top is the top of the displayed page) from each page's
 * visible area by setting its CropBox. Refuses margins that would leave less than an inch.
 */
export function cropPages(pdf: mupdf.PDFDocument, pages: number[], margins: Margins): void {
  for (const p of normalize(pdf, pages)) {
    const page = pdf.loadPage(p);
    const [x0, y0, x1, y1] = page.getBounds();
    if (x1 - x0 - margins.left - margins.right < 72 || y1 - y0 - margins.top - margins.bottom < 72) {
      throw new Error("Those margins leave almost nothing of the page");
    }
    // getBounds and setPageBox both work in the page's displayed space (rotation and y-down applied).
    page.setPageBox("CropBox", [x0 + margins.left, y0 + margins.top, x1 - margins.right, y1 - margins.bottom]);
  }
}
