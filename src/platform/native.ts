import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isTauri } from "./sources";

/** Calls `handler` with dropped file paths (Tauri only). Returns an unsubscribe function. */
export async function onNativeDrop(handler: (paths: string[]) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  return getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === "drop") handler(event.payload.paths);
  });
}
