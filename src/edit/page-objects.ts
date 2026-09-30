import * as mupdf from "mupdf";
import type { Point, Rect } from "../engine/types";
import type { EmbeddedFonts } from "./embedded-fonts";
import { appendContent, ensureOwnResources, imageMatrixFor, removeContent, textMatrixAt } from "./page-space";
import type { ShapedLine } from "./shaper";
import { fmt, textContent } from "./text-writer";
import type { PageObject, TextStyle } from "./types";

export interface EditContext {
  pdf: mupdf.PDFDocument;
  page: mupdf.PDFPage;
  fonts: EmbeddedFonts;
}

export const lineHeight = (style: TextStyle) => style.size * 1.4;

export function textRect(origin: Point, lines: ShapedLine[], style: TextStyle): Rect {
  const width = Math.max(style.size, ...lines.map((l) => l.width));
  return [origin[0], origin[1] - style.size * 1.05, origin[0] + width, origin[1] + (lines.length - 1) * lineHeight(style) + style.size * 0.4];
}

/** JSON with every non-ASCII character escaped, safe to store as a PDF string. */
function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

interface Stored {
  entry: mupdf.PDFObject;
  index: number;
  object: PageObject;
}

function storeArray(ctx: EditContext): mupdf.PDFObject {
  const pageObj = ctx.page.getObject();
  if (!pageObj.get("LeoPDFObjects").isArray()) pageObj.put("LeoPDFObjects", ctx.pdf.newArray());
  return pageObj.get("LeoPDFObjects");
}

export function listObjects(page: mupdf.PDFPage): PageObject[] {
  const array = page.getObject().get("LeoPDFObjects");
  const out: PageObject[] = [];
  for (let i = 0; i < array.length; i++) out.push(JSON.parse(array.get(i).get("Data").asString()));
  return out;
}

export function findStored(page: mupdf.PDFPage, id: string): Stored {
  const array = page.getObject().get("LeoPDFObjects");
  for (let i = 0; i < array.length; i++) {
    const entry = array.get(i);
    if (entry.get("Id").asString() === id) return { entry, index: i, object: JSON.parse(entry.get("Data").asString()) };
  }
  throw new Error(`Unknown object ${id}`);
}

function nextId(ctx: EditContext, prefix: "t" | "i"): string {
  const pageObj = ctx.page.getObject();
  const n = (pageObj.get("LeoPDFNextId").isNumber() ? pageObj.get("LeoPDFNextId").asNumber() : 0) + 1;
  pageObj.put("LeoPDFNextId", n);
  return `${prefix}${n}`;
}

function tagged(id: string, body: string): string {
  return `/LeoPDF <</Id (${id})>> BDC\n${body}EMC\n`;
}

function textBody(ctx: EditContext, origin: Point, lines: ShapedLine[], style: TextStyle): string {
  const fontDict = ensureOwnResources(ctx.pdf, ctx.page).get("Font");
  return textContent(
    {
      lines,
      size: style.size,
      color: style.color,
      lineMatrix: (i) => textMatrixAt(ctx.page, [origin[0], origin[1] + i * lineHeight(style)]),
      slant: !!style.italic && !style.face?.italic,
      fakeBold: (run) => style.bold && !run.font.bold,
      underline: style.underline,
      strike: style.strike,
    },
    (run) => {
      const use = ctx.fonts.use(run.font);
      fontDict.put(use.resourceName, use.ref);
      return use;
    },
  );
}

export function imageBody(ctx: EditContext, name: string, rect: Rect): string {
  return `q ${imageMatrixFor(ctx.page, rect).map(fmt).join(" ")} cm /${name} Do Q\n`;
}

/** Adds a stored object: a tagged content stream plus its metadata entry. Returns the entry. */
export function storeObject(ctx: EditContext, object: PageObject, body: string, extra: Record<string, unknown> = {}): mupdf.PDFObject {
  const stream = appendContent(ctx.pdf, ctx.page, tagged(object.id, body));
  const entry = ctx.pdf.newDictionary();
  entry.put("Id", ctx.pdf.newString(object.id));
  entry.put("Data", ctx.pdf.newString(asciiJson(object)));
  entry.put("Stream", stream);
  for (const [k, v] of Object.entries(extra)) entry.put(k, v);
  storeArray(ctx).push(entry);
  return entry;
}

/** Rewrites a stored object's content and metadata in place. */
export function rewriteObject(ctx: EditContext, stored: Stored, object: PageObject, body: string): void {
  stored.entry.get("Stream").writeStream(tagged(object.id, body));
  stored.entry.put("Data", ctx.pdf.newString(asciiJson(object)));
}

export function addTextObject(ctx: EditContext, origin: Point, text: string, style: TextStyle, lines: ShapedLine[]): string {
  const object: PageObject = { id: nextId(ctx, "t"), kind: "text", rect: textRect(origin, lines, style), text, style, origin };
  storeObject(ctx, object, textBody(ctx, origin, lines, style));
  return object.id;
}

export function updateTextObject(ctx: EditContext, id: string, text: string, style: TextStyle, lines: ShapedLine[]): void {
  const stored = findStored(ctx.page, id);
  const origin = stored.object.origin!;
  rewriteObject(ctx, stored, { ...stored.object, text, style, rect: textRect(origin, lines, style) }, textBody(ctx, origin, lines, style));
}

/**
 * Moves an object by (dx, dy) in page space. Text is re-laid out by `relayout` (which re-shapes with
 * the stored style) because its content embeds absolute positions; images just get a new matrix.
 */
export function moveObject(ctx: EditContext, id: string, dx: number, dy: number, relayout?: (object: PageObject) => ShapedLine[]): void {
  const stored = findStored(ctx.page, id);
  const o = stored.object;
  const rect: Rect = [o.rect[0] + dx, o.rect[1] + dy, o.rect[2] + dx, o.rect[3] + dy];
  if (o.kind === "text") {
    const origin: Point = [o.origin![0] + dx, o.origin![1] + dy];
    const lines = relayout ? relayout(o) : [];
    rewriteObject(ctx, stored, { ...o, origin, rect }, textBody(ctx, origin, lines, o.style!));
  } else {
    rewriteObject(ctx, stored, { ...o, rect }, imageBody(ctx, stored.entry.get("Name").asName(), rect));
  }
}

export function deleteObject(ctx: EditContext, id: string): void {
  const stored = findStored(ctx.page, id);
  removeContent(ctx.page, stored.entry.get("Stream"));
  ctx.page.getObject().get("LeoPDFObjects").delete(stored.index);
}
export function defaultImageRect(pageBounds: Rect, image: mupdf.Image): Rect {
  const [px0, py0, px1, py1] = pageBounds;
  const pageW = px1 - px0;
  const pageH = py1 - py0;
  // Assume 96 dpi for images without useful resolution info.
  let w = (image.getWidth() * 72) / 96;
  let h = (image.getHeight() * 72) / 96;
  const scale = Math.min(1, (pageW * 0.8) / w, (pageH * 0.8) / h);
  w *= scale;
  h *= scale;
  const x0 = px0 + (pageW - w) / 2;
  const y0 = py0 + (pageH - h) / 2;
  return [x0, y0, x0 + w, y0 + h];
}

function registerImage(ctx: EditContext, image: mupdf.Image): { name: string; ref: mupdf.PDFObject } {
  const xobjects = ensureOwnResources(ctx.pdf, ctx.page).get("XObject");
  const ref = ctx.pdf.addImage(image);
  let n = 1;
  while (!xobjects.get(`LeoIm${n}`).isNull()) n++;
  const name = `LeoIm${n}`;
  xobjects.put(name, ref);
  return { name, ref };
}

export function addImageObject(ctx: EditContext, image: mupdf.Image, rect: Rect): string {
  const { name, ref } = registerImage(ctx, image);
  const object: PageObject = { id: nextId(ctx, "i"), kind: "image", rect };
  storeObject(ctx, object, imageBody(ctx, name, rect), { Image: ref, Name: ctx.pdf.newName(name) });
  return object.id;
}

export function resizeObject(ctx: EditContext, id: string, rect: Rect): void {
  const stored = findStored(ctx.page, id);
  if (stored.object.kind !== "image") throw new Error(`Object ${id} is not an image`);
  rewriteObject(ctx, stored, { ...stored.object, rect }, imageBody(ctx, stored.entry.get("Name").asName(), rect));
}

export function replaceObjectImage(ctx: EditContext, id: string, image: mupdf.Image): void {
  const stored = findStored(ctx.page, id);
  const { name, ref } = registerImage(ctx, image);
  stored.entry.put("Image", ref);
  stored.entry.put("Name", ctx.pdf.newName(name));
  rewriteObject(ctx, stored, stored.object, imageBody(ctx, name, stored.object.rect));
}
