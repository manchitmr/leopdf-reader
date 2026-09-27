import { transfer } from "comlink";
import { DocumentEngine } from "./document-engine";
import type { Point, Rotation } from "./types";

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
    search: (docId: string, query: string) => engine.search(docId, query),
    select: (docId: string, page: number, from: Point, to: Point) => engine.select(docId, page, from, to),
    close: (docId: string) => engine.close(docId),
  };
}

export type EngineApi = ReturnType<typeof createEngineApi>;
