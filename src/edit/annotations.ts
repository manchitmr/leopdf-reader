import * as mupdf from "mupdf";
import type { Point, Quad, Rect } from "../engine/types";
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

/** A markup drag that covers no text. */
export class NoTextError extends Error {
  constructor() {
    super("No text under the drag");
  }
}

const idOf = (a: mupdf.PDFAnnotation) => a.getObject().asIndirect();

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
    movable: !quads && (strokes !== undefined || a.hasVertices() || box !== null),
    resizable: kind === "rect" || kind === "oval" || kind === "stamp",
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
      a.setStampImage(new mupdf.Image(spec.png));
      break;
  }
  if (author) a.setAuthor(author);
  a.setCreationDate(now);
  touch(a, now);
  return idOf(a);
}

export function updateAnnotation(page: mupdf.PDFPage, id: number, patch: AnnotPatch, now = new Date()): void {
  const a = find(page, id);
  if (patch.contents !== undefined) a.setContents(patch.contents);
  if (patch.color) a.setColor(patch.color);
  touch(a, now);
}

export function moveAnnotation(page: mupdf.PDFPage, id: number, dx: number, dy: number, now = new Date()): void {
  const a = find(page, id);
  const shift = ([x, y]: Point): Point => [x + dx, y + dy];
  if (a.hasQuadPoints()) throw new Error("Text markup cannot be moved");
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
