import { invoke } from "@tauri-apps/api/core";
import type { SystemFace } from "../edit/types";
import type { StringKey } from "../i18n/strings";
import { isTauri } from "./sources";

export interface SystemFont extends SystemFace {
  sinhala: boolean;
  tamil: boolean;
}

let listing: Promise<SystemFont[]> | null = null;

/** Fonts installed on this computer (scanned once by the Rust side; none in the browser build). */
export function listSystemFonts(): Promise<SystemFont[]> {
  if (!listing) {
    listing = isTauri() ? invoke<SystemFont[]>("list_fonts").catch(() => []) : Promise.resolve([]);
  }
  return listing;
}

export async function readFontFile(path: string): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>("read_font", { path }));
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** "XQTPST+IskoolaPota-Bold", "Iskoola Pota,Bold", "TimesNewRomanPSMT" → "iskoolapota", "timesnewroman". */
const baseKey = (name: string) =>
  key(name.replace(/^[A-Z]{6}\+/, "").split(/[-,]/)[0]).replace(/(psmt|mt|ps)$/, "");

/** The face of `family` closest to bold/italic (exact style first, then regular). */
export function faceOf(fonts: SystemFont[], family: string, bold: boolean, italic: boolean): SystemFont | undefined {
  const all = fonts.filter((f) => f.family === family);
  return all.find((f) => f.bold === bold && f.italic === italic) ?? all.find((f) => !f.bold && !f.italic) ?? all[0];
}

/** The installed font a PDF font name refers to, if any. */
export function findInstalled(fonts: SystemFont[], pdfFontName: string, bold: boolean, italic: boolean): SystemFont | undefined {
  const want = baseKey(pdfFontName);
  if (!want) return undefined;
  const hit = fonts.find((f) => key(f.family) === want || baseKey(f.postscript) === want);
  return hit && faceOf(fonts, hit.family, bold, italic);
}

/** Where to get fonts that come with Windows as optional features. */
export function installHint(pdfFontName: string): StringKey | null {
  const base = baseKey(pdfFontName);
  if (["iskoolapota"].includes(base)) return "hintSinhalaFonts";
  if (["latha", "vijaya"].includes(base)) return "hintTamilFonts";
  return null;
}

const previews = new Map<string, Promise<string>>();

/**
 * A CSS font-family that shows `face` in the inline editor. Fonts shipped inside apps (Office's Latha)
 * aren't known to the browser by name, so the file itself is loaded as a web font.
 */
export function previewFamily(face: SystemFace): Promise<string> {
  const id = `${face.path}#${face.index}`;
  let family = previews.get(id);
  if (!family) {
    const name = `LeoFace${previews.size}`;
    family = readFontFile(face.path)
      .then(async (bytes) => {
        // A .ttc can't be picked by index here; the family name still works for installed collections.
        if (face.index > 0) return `"${face.family}"`;
        const font = new FontFace(name, bytes.buffer as ArrayBuffer);
        document.fonts.add(await font.load());
        return `"${name}", "${face.family}"`;
      })
      .catch(() => `"${face.family}"`);
    previews.set(id, family);
  }
  return family;
}
