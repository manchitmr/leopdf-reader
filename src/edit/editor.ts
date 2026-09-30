import * as mupdf from "mupdf";
import type { Point, Rect } from "../engine/types";
import { EmbeddedFonts } from "./embedded-fonts";
import { deleteExistingImage, listExistingImages, takeExistingImage } from "./existing-images";
import type { FontRegistry } from "./font-registry";
import {
  addImageObject, addTextObject, defaultImageRect, deleteObject, listObjects, moveObject, replaceObjectImage, resizeObject,
  updateTextObject, type EditContext,
} from "./page-objects";
import { fitSize, listLines, OverlapError, removeLineText } from "./lines";
import { loadStyleFonts, shapeText, type ShapedLine } from "./shaper";
import * as annots from "./annotations";
import * as bookmarks from "./bookmarks";
import type { OutlineNode } from "../engine/types";
import type { Annot, AnnotPatch, EditableLine, EditResult, ExistingImage, HistoryState, NewAnnot, PageObject, TextStyle } from "./types";

/** Edits one PDF document. Every change is one journal operation, so undo/redo cover it. */
export class DocumentEditor {
  private readonly fonts: EmbeddedFonts;
  private savedPosition: number;

  constructor(
    private readonly pdf: mupdf.PDFDocument,
    private readonly registry: FontRegistry,
  ) {
    pdf.enableJournal();
    this.fonts = new EmbeddedFonts(pdf);
    this.savedPosition = pdf.getJournal().position;
  }

  history(): HistoryState {
    return { canUndo: this.pdf.canUndo(), canRedo: this.pdf.canRedo(), dirty: this.pdf.getJournal().position !== this.savedPosition };
  }

  listObjects(page: number): PageObject[] {
    return listObjects(this.pdf.loadPage(page));
  }

  listImages(page: number): ExistingImage[] {
    return listExistingImages(this.pdf.loadPage(page));
  }

  /** Original text lines, with the size set so the bundled font spans the same width as the original. */
  async listLines(page: number): Promise<EditableLine[]> {
    const lines = listLines(this.pdf.loadPage(page));
    for (const line of lines) {
      if (line.locked) continue;
      const [shaped] = await this.shape(line.text, line.style);
      line.style.size = fitSize(line.style.size, shaped.width, line.rect[2] - line.origin[0]);
    }
    return lines;
  }

  /** Replaces an original line with new text (a LeoPDF text object on the same baseline); empty text just removes it. */
  async replaceLine(page: number, line: EditableLine, text: string, style: TextStyle): Promise<EditResult> {
    const lines = text ? await this.shape(text, style) : [];
    let id: string | undefined;
    try {
      id = this.op("Edit text", page, (ctx) => {
        removeLineText(ctx.page, line);
        return text ? addTextObject(ctx, line.origin, text, style, lines) : undefined;
      });
    } catch (e) {
      if (e instanceof OverlapError) return { ...this.result(), refused: "overlap" };
      throw e;
    }
    const right = line.origin[0] + Math.max(0, ...lines.map((l) => l.width));
    return { ...this.result(id, lines), ...(right > line.maxRight + 1 ? { overflow: true } : {}) };
  }

  async addText(page: number, origin: Point, text: string, style: TextStyle): Promise<EditResult> {
    const lines = await this.shape(text, style);
    const id = this.op("Add text", page, (ctx) => addTextObject(ctx, origin, text, style, lines));
    return this.result(id, lines);
  }

  async updateText(page: number, id: string, text: string, style: TextStyle): Promise<EditResult> {
    const lines = await this.shape(text, style);
    this.op("Edit text", page, (ctx) => updateTextObject(ctx, id, text, style, lines));
    return this.result(id, lines);
  }

  async moveObject(page: number, id: string, dx: number, dy: number): Promise<EditResult> {
    const object = listObjects(this.pdf.loadPage(page)).find((o) => o.id === id);
    const lines = object?.kind === "text" ? await this.shape(object.text!, object.style!) : [];
    this.op("Move", page, (ctx) => moveObject(ctx, id, dx, dy, () => lines));
    return this.result(id);
  }

  async resizeObject(page: number, id: string, rect: Rect): Promise<EditResult> {
    this.op("Resize", page, (ctx) => resizeObject(ctx, id, rect));
    return this.result(id);
  }

  async deleteObject(page: number, id: string): Promise<EditResult> {
    this.op("Delete", page, (ctx) => deleteObject(ctx, id));
    return this.result();
  }

  async addImage(page: number, bytes: Uint8Array, rect: Rect | null): Promise<EditResult> {
    const image = new mupdf.Image(bytes);
    const id = this.op("Add image", page, (ctx) => addImageObject(ctx, image, rect ?? defaultImageRect(ctx.page.getBounds() as Rect, image)));
    return this.result(id);
  }

  async replaceImage(page: number, target: { id: string } | { rect: Rect }, bytes: Uint8Array): Promise<EditResult> {
    const image = new mupdf.Image(bytes);
    const id = this.op("Replace image", page, (ctx) => {
      if ("id" in target) {
        replaceObjectImage(ctx, target.id, image);
        return target.id;
      }
      deleteExistingImage(ctx.page, target.rect);
      return addImageObject(ctx, image, target.rect);
    });
    return this.result(id);
  }

  async deleteImage(page: number, rect: Rect): Promise<EditResult> {
    this.op("Delete image", page, (ctx) => deleteExistingImage(ctx.page, rect));
    return this.result();
  }

  /** Moves an image from the original content by turning it into a LeoPDF object at the new place. */
  async moveExistingImage(page: number, rect: Rect, dx: number, dy: number): Promise<EditResult> {
    const id = this.op("Move image", page, (ctx) => {
      const image = takeExistingImage(ctx.page, rect);
      return addImageObject(ctx, image, [rect[0] + dx, rect[1] + dy, rect[2] + dx, rect[3] + dy]);
    });
    return this.result(id);
  }

  listAnnotations(page: number): Annot[] {
    return annots.listAnnotations(this.pdf.loadPage(page), page);
  }

  async addAnnotation(page: number, spec: NewAnnot, author: string): Promise<EditResult> {
    try {
      const id = this.op("Add annotation", page, (ctx) => annots.addAnnotation(ctx.page, spec, author));
      return this.result(String(id));
    } catch (e) {
      if (e instanceof annots.NoTextError) return { ...this.result(), empty: true };
      throw e;
    }
  }

  async updateAnnotation(page: number, id: number, patch: AnnotPatch): Promise<EditResult> {
    this.op("Edit annotation", page, (ctx) => annots.updateAnnotation(ctx.page, id, patch));
    return this.result(String(id));
  }

  async moveAnnotation(page: number, id: number, dx: number, dy: number): Promise<EditResult> {
    this.op("Move annotation", page, (ctx) => annots.moveAnnotation(ctx.page, id, dx, dy));
    return this.result(String(id));
  }

  async resizeAnnotation(page: number, id: number, rect: Rect): Promise<EditResult> {
    this.op("Resize annotation", page, (ctx) => annots.resizeAnnotation(ctx.page, id, rect));
    return this.result(String(id));
  }

  async deleteAnnotation(page: number, id: number): Promise<EditResult> {
    this.op("Delete annotation", page, (ctx) => annots.deleteAnnotation(ctx.page, id));
    return this.result();
  }

  outline(): OutlineNode[] {
    return bookmarks.listOutline(this.pdf);
  }

  /** Adds a top-level bookmark; the result's id is its path (e.g. "2"). */
  async addBookmark(page: number, title: string): Promise<EditResult> {
    const path = this.journaled("Add bookmark", () => bookmarks.addBookmark(this.pdf, page, title));
    return this.result(path.join("."));
  }

  async renameBookmark(path: number[], title: string): Promise<EditResult> {
    this.journaled("Rename bookmark", () => bookmarks.renameBookmark(this.pdf, path, title));
    return this.result();
  }

  async deleteBookmark(path: number[]): Promise<EditResult> {
    this.journaled("Delete bookmark", () => bookmarks.deleteBookmark(this.pdf, path));
    return this.result();
  }

  undo(): EditResult {
    if (this.pdf.canUndo()) this.pdf.undo();
    this.fonts.reset();
    return this.result();
  }

  redo(): EditResult {
    if (this.pdf.canRedo()) this.pdf.redo();
    this.fonts.reset();
    return this.result();
  }

  /** Full rewrite with font subsetting, done on a copy so the journal and open document are untouched. */
  save(): Uint8Array {
    const copy = new mupdf.PDFDocument(this.pdf.saveToBuffer("").asUint8Array().slice());
    try {
      copy.subsetFonts();
      return copy.saveToBuffer("garbage,compress").asUint8Array().slice();
    } finally {
      copy.destroy();
    }
  }

  /** Call after the saved bytes were written successfully. */
  markSaved(): HistoryState {
    this.savedPosition = this.pdf.getJournal().position;
    return this.history();
  }

  private async shape(text: string, style: TextStyle): Promise<ShapedLine[]> {
    return shapeText(text, style, await loadStyleFonts(this.registry, style));
  }

  private op<T>(name: string, page: number, fn: (ctx: EditContext) => T): T {
    const ctx: EditContext = { pdf: this.pdf, page: this.pdf.loadPage(page), fonts: this.fonts };
    return this.journaled(name, () => {
      const value = fn(ctx);
      annots.restoreSignatures(ctx.page);
      return value;
    });
  }

  /** Runs `fn` as one undoable journal operation; a failure rolls it back completely. */
  private journaled<T>(name: string, fn: () => T): T {
    this.pdf.beginOperation(name);
    try {
      const value = fn();
      this.fonts.flush();
      this.pdf.endOperation();
      return value;
    } catch (e) {
      this.pdf.abandonOperation();
      this.fonts.reset();
      throw e;
    }
  }

  private result(id?: string, lines: ShapedLine[] = []): EditResult {
    const missing = [...new Set(lines.flatMap((l) => l.missing))];
    return { history: this.history(), ...(id ? { id } : {}), ...(missing.length ? { missing } : {}) };
  }
}
