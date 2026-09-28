import * as mupdf from "mupdf";
import type { Matrix, Point, Rect } from "../engine/types";

/** Maps page space (what the viewer shows: y down, rotation applied) to PDF user space. */
export function pageToPdf(page: mupdf.PDFPage): Matrix {
  return mupdf.Matrix.invert(page.getTransform()) as Matrix;
}

/** Text matrix for a baseline starting at `origin` (page space), upright as seen in the viewer. */
export function textMatrixAt(page: mupdf.PDFPage, origin: Point): Matrix {
  return mupdf.Matrix.concat([1, 0, 0, -1, origin[0], origin[1]], pageToPdf(page)) as Matrix;
}

/** `cm` matrix that draws an image's unit square into `rect` (page space), upright. */
export function imageMatrixFor(page: mupdf.PDFPage, rect: Rect): Matrix {
  const [x0, y0, x1, y1] = rect;
  return mupdf.Matrix.concat([x1 - x0, 0, 0, -(y1 - y0), x0, y1], pageToPdf(page)) as Matrix;
}

/** Shallow copy of a dictionary (resolving an indirect reference); missing/null gives an empty dict. */
function copyDict(pdf: mupdf.PDFDocument, from: mupdf.PDFObject): mupdf.PDFObject {
  const copy = pdf.newDictionary();
  const source = from.isIndirect() ? from.resolve() : from;
  if (source.isDictionary()) source.forEach((value, key) => copy.put(key, value));
  return copy;
}

/**
 * Gives the page its own Resources dictionary (with its own Font and XObject sub-dictionaries), so
 * adding resources never changes other pages that shared or inherited the original.
 */
export function ensureOwnResources(pdf: mupdf.PDFDocument, page: mupdf.PDFPage): mupdf.PDFObject {
  const pageObj = page.getObject();
  if (pageObj.get("LeoPDFOwnResources").asBoolean()) return pageObj.get("Resources");
  const own = copyDict(pdf, pageObj.getInheritable("Resources"));
  own.put("Font", copyDict(pdf, own.get("Font")));
  own.put("XObject", copyDict(pdf, own.get("XObject")));
  pageObj.put("Resources", pdf.addObject(own));
  pageObj.put("LeoPDFOwnResources", true);
  return pageObj.get("Resources");
}

function contentsArray(pdf: mupdf.PDFDocument, pageObj: mupdf.PDFObject): mupdf.PDFObject {
  const contents = pageObj.get("Contents");
  if (contents.isArray()) return contents;
  const array = pdf.newArray();
  if (!contents.isNull()) array.push(contents);
  pageObj.put("Contents", array);
  return pageObj.get("Contents");
}

/** Wraps the original content in q … Q once, so its graphics state cannot leak into added content. */
export function wrapContents(pdf: mupdf.PDFDocument, page: mupdf.PDFPage): void {
  const pageObj = page.getObject();
  if (pageObj.get("LeoPDFWrapped").asBoolean()) return;
  const original = contentsArray(pdf, pageObj);
  const wrapped = pdf.newArray();
  wrapped.push(pdf.addStream("q\n", pdf.newDictionary()));
  for (let i = 0; i < original.length; i++) wrapped.push(original.get(i));
  wrapped.push(pdf.addStream("Q\n", pdf.newDictionary()));
  pageObj.put("Contents", wrapped);
  pageObj.put("LeoPDFWrapped", true);
}

export function appendContent(pdf: mupdf.PDFDocument, page: mupdf.PDFPage, content: string): mupdf.PDFObject {
  wrapContents(pdf, page);
  const stream = pdf.addStream(content, pdf.newDictionary());
  contentsArray(pdf, page.getObject()).push(stream);
  return stream;
}

export function removeContent(page: mupdf.PDFPage, ref: mupdf.PDFObject): void {
  const contents = page.getObject().get("Contents");
  for (let i = 0; i < contents.length; i++) {
    if (contents.get(i).asIndirect() === ref.asIndirect()) {
      contents.delete(i);
      return;
    }
  }
}
