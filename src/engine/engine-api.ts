import { transfer } from "comlink";
import { DocumentEngine } from "./document-engine";
import type { FaceSource } from "../edit/font-registry";
import type { Margins } from "../edit/pages";
import type { AnnotPatch, EditableLine, NewAnnot, TextStyle } from "../edit/types";
import type { Point, Rect, Rotation } from "./types";

export function createEngineApi(engine = new DocumentEngine()) {
  return {
    open: (docId: string, bytes: Uint8Array) => engine.open(docId, bytes),
    unlock: (docId: string, password: string) => engine.unlock(docId, password),
    render: (docId: string, page: number, scale: number, rotation: Rotation) => {
      const result = engine.render(docId, page, scale, rotation);
      return transfer(result, [result.pixels.buffer as ArrayBuffer]);
    },
    renderPng: (docId: string, page: number, scale: number) => {
      const png = engine.renderPng(docId, page, scale);
      return transfer(png, [png.buffer as ArrayBuffer]);
    },
    search: (docId: string, query: string, from?: number, to?: number) => engine.search(docId, query, from, to),
    select: (docId: string, page: number, from: Point, to: Point) => engine.select(docId, page, from, to),
    close: (docId: string) => engine.close(docId),
    setFaceSource: (source: FaceSource) => engine.setFaceSource(source),
    addText: (docId: string, page: number, origin: Point, text: string, style: TextStyle) => engine.addText(docId, page, origin, text, style),
    updateText: (docId: string, page: number, id: string, text: string, style: TextStyle) => engine.updateText(docId, page, id, text, style),
    listFields: (docId: string, page: number) => engine.listFields(docId, page),
    fillText: (docId: string, page: number, id: number, value: string) => engine.fillText(docId, page, id, value),
    setFieldChecked: (docId: string, page: number, id: number, checked: boolean) => engine.setFieldChecked(docId, page, id, checked),
    setFieldChoice: (docId: string, page: number, id: number, value: string) => engine.setFieldChoice(docId, page, id, value),
    replaceLine: (docId: string, page: number, line: EditableLine, text: string, style: TextStyle) => engine.replaceLine(docId, page, line, text, style),
    moveObject: (docId: string, page: number, id: string, dx: number, dy: number) => engine.moveObject(docId, page, id, dx, dy),
    resizeObject: (docId: string, page: number, id: string, rect: Rect) => engine.resizeObject(docId, page, id, rect),
    deleteObject: (docId: string, page: number, id: string) => engine.deleteObject(docId, page, id),
    addImage: (docId: string, page: number, bytes: Uint8Array, rect: Rect | null) => engine.addImage(docId, page, bytes, rect),
    replaceImage: (docId: string, page: number, target: { id: string } | { rect: Rect }, bytes: Uint8Array) =>
      engine.replaceImage(docId, page, target, bytes),
    deleteImage: (docId: string, page: number, rect: Rect) => engine.deleteImage(docId, page, rect),
    moveExistingImage: (docId: string, page: number, rect: Rect, dx: number, dy: number) => engine.moveExistingImage(docId, page, rect, dx, dy),
    addAnnotation: (docId: string, page: number, spec: NewAnnot, author: string) => engine.addAnnotation(docId, page, spec, author),
    updateAnnotation: (docId: string, page: number, id: number, patch: AnnotPatch) => engine.updateAnnotation(docId, page, id, patch),
    moveAnnotation: (docId: string, page: number, id: number, dx: number, dy: number) => engine.moveAnnotation(docId, page, id, dx, dy),
    resizeAnnotation: (docId: string, page: number, id: number, rect: Rect) => engine.resizeAnnotation(docId, page, id, rect),
    deleteAnnotation: (docId: string, page: number, id: number) => engine.deleteAnnotation(docId, page, id),
    listAnnotations: (docId: string, page?: number) => engine.listAnnotations(docId, page),
    addBookmark: (docId: string, page: number, title: string) => engine.addBookmark(docId, page, title),
    renameBookmark: (docId: string, path: number[], title: string) => engine.renameBookmark(docId, path, title),
    deleteBookmark: (docId: string, path: number[]) => engine.deleteBookmark(docId, path),
    outline: (docId: string) => engine.outline(docId),
    listObjects: (docId: string, page: number) => engine.listObjects(docId, page),
    listLines: (docId: string, page: number) => engine.listLines(docId, page),
    listImages: (docId: string, page: number) => engine.listImages(docId, page),
    rotatePages: (docId: string, pages: number[], degrees: number) => engine.rotatePages(docId, pages, degrees),
    deletePages: (docId: string, pages: number[]) => engine.deletePages(docId, pages),
    movePages: (docId: string, pages: number[], before: number) => engine.movePages(docId, pages, before),
    insertBlankPage: (docId: string, at: number) => engine.insertBlankPage(docId, at),
    insertPdf: (docId: string, at: number, bytes: Uint8Array) => engine.insertPdf(docId, at, bytes),
    cropPages: (docId: string, pages: number[], margins: Margins) => engine.cropPages(docId, pages, margins),
    extractPages: (docId: string, pages: number[]) => {
      const bytes = engine.extractPages(docId, pages);
      return transfer(bytes, [bytes.buffer as ArrayBuffer]);
    },
    splitEvery: (docId: string, size: number) => {
      const parts = engine.splitEvery(docId, size);
      return transfer(parts, parts.map((p) => p.buffer as ArrayBuffer));
    },
    undo: (docId: string) => engine.undo(docId),
    redo: (docId: string) => engine.redo(docId),
    history: (docId: string) => engine.history(docId),
    save: (docId: string) => {
      const bytes = engine.save(docId);
      return transfer(bytes, [bytes.buffer as ArrayBuffer]);
    },
    markSaved: (docId: string) => engine.markSaved(docId),
  };
}

export type EngineApi = ReturnType<typeof createEngineApi>;
