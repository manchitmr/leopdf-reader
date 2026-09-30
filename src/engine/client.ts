import { proxy, wrap, type Remote } from "comlink";
import { readFontFile } from "../platform/fonts";
import { isTauri } from "../platform/sources";
import type { EngineApi } from "./engine-api";

let engine: Remote<EngineApi> | null = null;
const crashListeners = new Set<() => void>();

/** Returns the engine worker, starting a fresh one if none is running (or the last one crashed). */
export function getEngine(): Remote<EngineApi> {
  if (!engine) {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("error", () => {
      worker.terminate();
      engine = null;
      crashListeners.forEach((listener) => listener());
    });
    engine = wrap<EngineApi>(worker);
    // The worker can't call Tauri; it reads installed fonts through this main-thread function.
    if (isTauri()) void engine.setFaceSource(proxy(readFontFile));
  }
  return engine;
}

export function onEngineCrash(listener: () => void): () => void {
  crashListeners.add(listener);
  return () => crashListeners.delete(listener);
}
