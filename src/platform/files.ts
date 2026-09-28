import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { isTauri } from "./sources";

export function ensurePdfName(name: string): string {
  return name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`;
}

export async function writePdf(path: string, bytes: Uint8Array): Promise<void> {
  await invoke("write_file", bytes, { headers: { "x-path": encodeURIComponent(path) } });
}

export async function pickSavePath(suggested: string): Promise<string | null> {
  const path = await save({ defaultPath: ensurePdfName(suggested), filters: [{ name: "PDF", extensions: ["pdf"] }] });
  return path ? ensurePdfName(path) : null;
}

/** Browser/dev fallback: hand the file to the browser as a download. */
export function downloadPdf(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = ensurePdfName(name);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function pickImage(): Promise<Uint8Array | null> {
  if (isTauri()) {
    const path = await open({ multiple: false, filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg"] }] });
    if (!path || Array.isArray(path)) return null;
    return new Uint8Array(await invoke<ArrayBuffer>("read_image", { path }));
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg";
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? new Uint8Array(await file.arrayBuffer()) : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
