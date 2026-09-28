import { transfer } from "comlink";
import { DocumentEngine } from "./document-engine";
import type { TextStyle } from "../edit/types";
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
    addText: (docId: string, page: number, origin: Point, text: string, style: TextStyle) => engine.addText(docId, page, origin, text, style),
    updateText: (docId: string, page: number, id: string, text: string, style: TextStyle) => engine.updateText(docId, page, id, text, style),
    moveObject: (docId: string, page: number, id: string, dx: number, dy: number) => engine.moveObject(docId, page, id, dx, dy),
    resizeObject: (docId: string, page: number, id: string, rect: Rect) => engine.resizeObject(docId, page, id, rect),
    deleteObject: (docId: string, page: number, id: string) => engine.deleteObject(docId, page, id),
    addImage: (docId: string, page: number, bytes: Uint8Array, rect: Rect | null) => engine.addImage(docId, page, bytes, rect),
    replaceImage: (docId: string, page: number, target: { id: string } | { rect: Rect }, bytes: Uint8Array) =>
      engine.replaceImage(docId, page, target, bytes),
    deleteImage: (docId: string, page: number, rect: Rect) => engine.deleteImage(docId, page, rect),
    moveExistingImage: (docId: string, page: number, rect: Rect, dx: number, dy: number) => engine.moveExistingImage(docId, page, rect, dx, dy),
    listObjects: (docId: string, page: number) => engine.listObjects(docId, page),
    listImages: (docId: string, page: number) => engine.listImages(docId, page),
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
