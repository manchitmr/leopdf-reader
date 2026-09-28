import * as mupdf from "mupdf";
import type { Point, Rect } from "../engine/types";
import { EmbeddedFonts } from "./embedded-fonts";
import { deleteExistingImage, listExistingImages, takeExistingImage } from "./existing-images";
import type { FontRegistry } from "./font-registry";
import {
  addImageObject, addTextObject, defaultImageRect, deleteObject, listObjects, moveObject, replaceObjectImage, resizeObject,
  updateTextObject, type EditContext,
} from "./page-objects";
import { loadStyleFonts, shapeText, type ShapedLine } from "./shaper";
import type { EditResult, ExistingImage, HistoryState, PageObject, TextStyle } from "./types";

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
    this.pdf.beginOperation(name);
    try {
      const value = fn(ctx);
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
