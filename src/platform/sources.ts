import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

/** Something the app can open: a file on disk (Tauri) or a browser File (web/dev). */
export interface PdfSource {
  /** Stable identity used to detect the same file opened twice. */
  key: string;
  name: string;
  /** Absolute path when opened from disk; null for browser files. */
  path: string | null;
  load(): Promise<Uint8Array>;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function isPdfName(name: string): boolean {
  return name.toLowerCase().endsWith(".pdf");
}

export function sourceFromPath(path: string): PdfSource {
  return {
    key: path,
    name: baseName(path),
    path,
    load: async () => new Uint8Array(await invoke<ArrayBuffer>("read_file", { path })),
  };
}

export function sourceFromFile(file: File): PdfSource {
  return {
    key: `web:${file.name}:${file.size}:${file.lastModified}`,
    name: file.name,
    path: null,
    load: async () => new Uint8Array(await file.arrayBuffer()),
  };
}

export async function pickPdfs(): Promise<PdfSource[]> {
  if (isTauri()) {
    const picked = await open({ multiple: true, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!picked) return [];
    return (Array.isArray(picked) ? picked : [picked]).map(sourceFromPath);
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files ?? []).map(sourceFromFile));
    input.oncancel = () => resolve([]);
    input.click();
  });
}
