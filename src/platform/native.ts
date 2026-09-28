import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isTauri } from "./sources";

/** Calls `handler` with dropped file paths (Tauri only). Returns an unsubscribe function. */
export async function onNativeDrop(handler: (paths: string[]) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  return getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === "drop") handler(event.payload.paths);
  });
}

export async function printWindow(): Promise<void> {
  if (isTauri()) await invoke("print_window");
  else window.print();
}

/** Delivers files the OS asked us to open (launch args, "Open with", second instance). */
export async function onOpenFiles(handler: (paths: string[]) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const drain = async () => {
    const files = await invoke<string[]>("take_pending_files");
    if (files.length > 0) handler(files);
  };
  const unlisten = await listen("open-files", () => void drain());
  await drain();
  return unlisten;
}
