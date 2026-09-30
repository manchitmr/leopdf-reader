import type { EngineApi } from "./engine-api";

const METHODS = [
  "open", "unlock", "render", "renderPng", "search", "select", "close",
  "addText", "updateText", "moveObject", "resizeObject", "deleteObject", "addImage", "replaceImage", "deleteImage",
  "moveExistingImage", "listObjects", "listImages", "listLines", "replaceLine", "setFaceSource", "undo", "redo", "history", "save", "markSaved",
  "addAnnotation", "updateAnnotation", "moveAnnotation", "resizeAnnotation", "deleteAnnotation", "listAnnotations",
  "addBookmark", "renameBookmark", "deleteBookmark", "outline",
] as const satisfies readonly (keyof EngineApi)[];

type LazyApi = { [K in keyof EngineApi]: (...args: Parameters<EngineApi[K]>) => Promise<Awaited<ReturnType<EngineApi[K]>>> };

/**
 * Wraps an engine that loads asynchronously (MuPDF's WASM uses top-level await) so the worker can
 * register its message listener immediately. Messages that arrive before a module worker's listener
 * exists are dropped, which would leave the first calls hanging forever.
 */
export function lazyApi(load: () => Promise<EngineApi>): LazyApi {
  const ready = load();
  return Object.fromEntries(
    METHODS.map((name) => [name, async (...args: unknown[]) => ((await ready)[name] as (...a: unknown[]) => unknown)(...args)]),
  ) as LazyApi;
}
