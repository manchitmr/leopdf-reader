import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

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

const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8;

/**
 * PNG/JPEG as they are; anything else the system can decode (WebP from WhatsApp, iPhone HEIC, GIF, BMP,
 * TIFF) re-encoded as PNG, the formats the PDF engine reads. Throws if the image can't be decoded.
 */
export async function toPngOrJpeg(bytes: Uint8Array): Promise<Uint8Array> {
  if (isPng(bytes) || isJpeg(bytes)) return bytes;
  const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Image could not be converted");
  return new Uint8Array(await blob.arrayBuffer());
}

export const isImageName = (name: string) => /\.(png|jpe?g|webp|hei[cf]|gif|bmp|tiff?)$/i.test(name);

/** An image file dropped onto the app (a path from the OS), as PNG or JPEG. Throws if unreadable. */
export async function readDroppedImage(path: string): Promise<Uint8Array> {
  return toPngOrJpeg(new Uint8Array(await invoke<ArrayBuffer>("read_image", { path })));
}

/** Picks an image and returns it as PNG or JPEG; null if cancelled. Throws if the image can't be read. */
export async function pickImage(): Promise<Uint8Array | null> {
  const bytes = await pickRawImage();
  return bytes && toPngOrJpeg(bytes);
}

/**
 * The web view's own file chooser, in the app too: the app crashed inside macOS (HIServices) while the
 * native dialog plugin was picking an image, and the web view knows every image type the system decodes.
 */
function pickRawImage(): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? new Uint8Array(await file.arrayBuffer()) : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
