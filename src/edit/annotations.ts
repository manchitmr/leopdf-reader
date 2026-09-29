import * as mupdf from "mupdf";
import type { Point, Quad, Rect } from "../engine/types";
import { pageToPdf } from "./page-space";
import type { Annot, AnnotKind, AnnotPatch, NewAnnot, RGB } from "./types";

/** Annotation types that are not comments or markups. */
const HIDDEN = new Set(["Link", "Widget", "Popup"]);
const KINDS: Record<string, AnnotKind> = {
  Highlight: "highlight", Underline: "underline", StrikeOut: "strikeout", Ink: "ink", Square: "rect", Circle: "oval", Text: "note", Stamp: "stamp",
};
const MARKUP_SUBTYPE = { highlight: "Highlight", underline: "Underline", strikeout: "StrikeOut" } as const;
const SHAPE_SUBTYPE = { rect: "Square", oval: "Circle" } as const;

export const NOTE_SIZE = 20;
const NOTE_COLOR: RGB = [1, 0.84, 0];
/** /Name of signature stamps placed by LeoPDF. */
export const SIGNATURE_ICON = "LeoPDFSignature";
/** Set on every annotation LeoPDF creates. Others are edited without regenerating their appearance. */
const OWN_KEY = "LeoPDF";

/** A markup drag that covers no text. */
export class NoTextError extends Error {
  constructor() {
    super("No text under the drag");
  }
}

const idOf = (a: mupdf.PDFAnnotation) => a.getObject().asIndirect();
const isOurs = (a: mupdf.PDFAnnotation) => a.getObject().get(OWN_KEY).asBoolean();

function kindOf(a: mupdf.PDFAnnotation): AnnotKind {
  const subtype = a.getType();
  if (subtype === "Line") {
    const { start, end } = a.getLineEndingStyles();
    return start === "None" && end === "None" ? "line" : "arrow";
  }
  return KINDS[subtype] ?? "other";
}

function colorOf(a: mupdf.PDFAnnotation): RGB | null {
  const c = a.getColor();
  if (c.length === 1) return [c[0], c[0], c[0]];
  if (c.length === 3) return [c[0], c[1], c[2]];
  if (c.length === 4) return [(1 - c[0]) * (1 - c[3]), (1 - c[1]) * (1 - c[3]), (1 - c[2]) * (1 - c[3])];
  return null;
}

function modifiedOf(a: mupdf.PDFAnnotation): number | null {
  try {
    const t = a.getModificationDate().getTime();
    return Number.isFinite(t) && t > 0 ? t : null;
  } catch {
    return null;
  }
}

function describe(a: mupdf.PDFAnnotation, page: number): Annot {
  const kind = kindOf(a);
  const quads = a.hasQuadPoints() ? (a.getQuadPoints() as Quad[]) : undefined;
  const strokes = a.hasInkList() ? (a.getInkList() as Point[][]) : a.hasLine() ? [a.getLine() as Point[]] : undefined;
  const box = a.hasRect() ? (a.getRect() as Rect) : null;
  const ours = isOurs(a);
  return {
    id: idOf(a),
    page,
    kind,
    subtype: a.getType(),
    rect: a.getBounds() as Rect,
    box,
    ...(quads ? { quads } : {}),
    ...(strokes ? { strokes } : {}),
    color: colorOf(a),
    contents: a.getContents() ?? "",
    author: a.hasAuthor() ? a.getAuthor() : "",
    modified: modifiedOf(a),
    ours,
    movable: !quads && (strokes !== undefined || a.hasVertices() || box !== null),
    resizable: ours && (kind === "rect" || kind === "oval" || kind === "stamp"),
  };
}

export function listAnnotations(page: mupdf.PDFPage, pageIndex: number): Annot[] {
  return page.getAnnotations().filter((a) => !HIDDEN.has(a.getType())).map((a) => describe(a, pageIndex));
}

function find(page: mupdf.PDFPage, id: number): mupdf.PDFAnnotation {
  const annot = page.getAnnotations().find((a) => idOf(a) === id);
  if (!annot) throw new Error(`Unknown annotation ${id}`);
  return annot;
}

function textQuads(page: mupdf.PDFPage, from: Point, to: Point): Quad[] {
  const st = page.toStructuredText("preserve-whitespace");
  try {
    return st.highlight(from, to) as Quad[];
  } finally {
    st.destroy();
  }
}

function touch(a: mupdf.PDFAnnotation, now: Date): void {
  a.setModificationDate(now);
  a.update();
}

function pdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/**
 * Moves another program's annotation by editing its dictionary only. MuPDF's setters would regenerate
 * the appearance and lose the original artwork (stamps, seals, typewriter text); the appearance stream
 * is mapped into /Rect, so shifting the coordinates moves it intact.
 */
function shiftRaw(page: mupdf.PDFPage, a: mupdf.PDFAnnotation, dx: number, dy: number, now: Date): void {
  const [m0, m1, m2, m3] = pageToPdf(page);
  const ux = m0 * dx + m2 * dy;
  const uy = m1 * dx + m3 * dy;
  const obj = a.getObject();
  const shifted = (arr: mupdf.PDFObject): number[] => {
    const out: number[] = [];
    for (let i = 0; i < arr.length; i++) out.push(arr.get(i).asNumber() + (i % 2 === 0 ? ux : uy));
    return out;
  };
  for (const key of ["Rect", "L", "Vertices", "CL"]) {
    const arr = obj.get(key);
    if (arr.isArray()) obj.put(key, shifted(arr));
  }
  const ink = obj.get("InkList");
  if (ink.isArray()) {
    const strokes: number[][] = [];
    for (let i = 0; i < ink.length; i++) strokes.push(shifted(ink.get(i)));
    obj.put("InkList", strokes);
  }
  obj.put("M", page._doc.newString(pdfDate(now)));
}

/** The page's /Rotate, normalised to 0/90/180/270. */
function pageRotation(page: mupdf.PDFPage): number {
  const r = page.getObject().getInheritable("Rotate");
  return r.isNumber() ? (((Math.round(r.asNumber() / 90) * 90) % 360) + 360) % 360 : 0;
}

/**
 * Stamp appearances are drawn in unrotated PDF space, so on a /Rotate page the image would appear turned.
 * Counter-rotate the pixels so the signature looks upright on screen.
 */
function uprightImage(png: Uint8Array, rotation: number): mupdf.Image {
  const image = new mupdf.Image(png);
  if (rotation === 0) return image;
  const src = image.toPixmap();
  const w = src.getWidth();
  const h = src.getHeight();
  const n = src.getNumberOfComponents();
  const swap = rotation !== 180;
  const dst = new mupdf.Pixmap(src.getColorSpace()!, [0, 0, swap ? h : w, swap ? w : h], src.getAlpha() === 1);
  const from = src.getPixels();
  const to = dst.getPixels();
  const fromStride = src.getStride();
  const toStride = dst.getStride();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [tx, ty] = rotation === 90 ? [y, w - 1 - x] : rotation === 180 ? [w - 1 - x, h - 1 - y] : [h - 1 - y, x];
      const s = y * fromStride + x * n;
      const d = ty * toStride + tx * n;
      for (let c = 0; c < n; c++) to[d + c] = from[s + c];
    }
  }
  return new mupdf.Image(dst);
}

/** Creates the annotation and returns its id. Throws NoTextError for a markup drag over no text. */
export function addAnnotation(page: mupdf.PDFPage, spec: NewAnnot, author: string, now = new Date()): number {
  let a: mupdf.PDFAnnotation;
  switch (spec.kind) {
    case "highlight":
    case "underline":
    case "strikeout": {
      const quads = textQuads(page, spec.from, spec.to);
      if (quads.length === 0) throw new NoTextError();
      a = page.createAnnotation(MARKUP_SUBTYPE[spec.kind]);
      a.setQuadPoints(quads);
      a.setColor(spec.color);
      break;
    }
    case "ink":
      a = page.createAnnotation("Ink");
      a.setInkList(spec.strokes);
      a.setColor(spec.color);
      a.setBorderWidth(spec.width);
      break;
    case "line":
    case "arrow":
      a = page.createAnnotation("Line");
      a.setLine(spec.from, spec.to);
      a.setLineEndingStyles("None", spec.kind === "arrow" ? "OpenArrow" : "None");
      a.setColor(spec.color);
      a.setBorderWidth(spec.width);
      break;
    case "rect":
    case "oval":
      a = page.createAnnotation(SHAPE_SUBTYPE[spec.kind]);
      a.setRect(spec.rect);
      a.setColor(spec.color);
      a.setBorderWidth(spec.width);
      break;
    case "note": {
      const [x, y] = spec.at;
      const h = NOTE_SIZE / 2;
      a = page.createAnnotation("Text");
      a.setRect([x - h, y - h, x + h, y + h]);
      a.setIcon("Comment");
      a.setColor(NOTE_COLOR);
      a.setContents(spec.contents);
      break;
    }
    case "stamp":
      a = page.createAnnotation("Stamp");
      a.setRect(spec.rect);
      // Name first: setStampImage then replaces the icon's appearance with the image.
      a.setIcon(SIGNATURE_ICON);
      a.setStampImage(uprightImage(spec.png, pageRotation(page)));
      break;
  }
  a.getObject().put(OWN_KEY, true);
  if (author) a.setAuthor(author);
  a.setCreationDate(now);
  touch(a, now);
  return idOf(a);
}

export function updateAnnotation(page: mupdf.PDFPage, id: number, patch: AnnotPatch, now = new Date()): void {
  const a = find(page, id);
  if (!isOurs(a)) {
    if (patch.color) throw new Error("Only annotations made in LeoPDF can change colour");
    if (patch.contents !== undefined) a.getObject().put("Contents", page._doc.newString(patch.contents));
    a.getObject().put("M", page._doc.newString(pdfDate(now)));
    return;
  }
  if (patch.contents !== undefined) a.setContents(patch.contents);
  if (patch.color) a.setColor(patch.color);
  touch(a, now);
}

export function moveAnnotation(page: mupdf.PDFPage, id: number, dx: number, dy: number, now = new Date()): void {
  const a = find(page, id);
  const shift = ([x, y]: Point): Point => [x + dx, y + dy];
  if (a.hasQuadPoints()) throw new Error("Text markup cannot be moved");
  if (!isOurs(a)) return shiftRaw(page, a, dx, dy, now);
  if (a.hasInkList()) a.setInkList((a.getInkList() as Point[][]).map((s) => s.map(shift)));
  else if (a.hasLine()) {
    const [p, q] = a.getLine() as Point[];
    a.setLine(shift(p), shift(q));
  } else if (a.hasVertices()) a.setVertices((a.getVertices() as Point[]).map(shift));
  else if (a.hasRect()) {
    const [x0, y0, x1, y1] = a.getRect();
    a.setRect([x0 + dx, y0 + dy, x1 + dx, y1 + dy]);
  } else throw new Error(`${a.getType()} annotations cannot be moved`);
  touch(a, now);
}

export function resizeAnnotation(page: mupdf.PDFPage, id: number, rect: Rect, now = new Date()): void {
  const a = find(page, id);
  if (!describe(a, 0).resizable) throw new Error(`${a.getType()} annotations cannot be resized`);
  a.setRect(rect);
  touch(a, now);
}

export function deleteAnnotation(page: mupdf.PDFPage, id: number): void {
  page.deleteAnnotation(find(page, id));
}
