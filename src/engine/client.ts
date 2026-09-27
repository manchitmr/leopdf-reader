import { wrap, type Remote } from "comlink";
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
  }
  return engine;
}

export function onEngineCrash(listener: () => void): () => void {
  crashListeners.add(listener);
  return () => crashListeners.delete(listener);
}
