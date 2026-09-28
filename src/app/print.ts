import { getEngine } from "../engine/client";
import { printWindow } from "../platform/native";
import { appStore, type AppStore, type DocTab } from "../state/store";
import { renderScale } from "../viewer/layout";

/** 2× = 144 dpi: sharp on paper without huge memory use. */
export const PRINT_SCALE = 2;

interface PrintDeps {
  renderPng: (docId: string, page: number, scale: number) => Promise<Uint8Array>;
  print: () => Promise<void>;
  root: HTMLElement;
  store: AppStore;
  decode: (img: HTMLImageElement) => Promise<void>;
  /** Resolves when printing has finished. Some webviews return from print() while the dialog is still open. */
  afterPrint: () => Promise<void>;
}

const PRINT_CLEANUP_TIMEOUT = 10 * 60_000;

/** One print job at a time: a second job would share #print-root and interleave pages. */
let printing = false;

/**
 * Waits for an image to load. (HTMLImageElement.decode() never settles for images inside the hidden
 * print root in Chromium-based webviews, so use load events.)
 */
export function waitForImage(img: HTMLImageElement): Promise<void> {
  if (img.complete) return Promise.resolve();
  return new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Page image could not load for printing"));
  });
}

const defaults = (): PrintDeps => ({
  renderPng: (docId, page, scale) => getEngine().renderPng(docId, page, scale),
  print: printWindow,
  root: document.getElementById("print-root")!,
  store: appStore,
  decode: waitForImage,
  afterPrint: () =>
    new Promise((resolve) => {
      window.addEventListener("afterprint", () => resolve(), { once: true });
      setTimeout(resolve, PRINT_CLEANUP_TIMEOUT);
    }),
});

export async function printDocument(tab: DocTab, deps: Partial<PrintDeps> = {}): Promise<void> {
  if (printing) return;
  printing = true;
  const { renderPng, print, root, store, decode, afterPrint } = { ...defaults(), ...deps };
  const urls: string[] = [];
  store.getState().setBusy("preparingPrint");
  try {
    for (let page = 0; page < tab.info!.pageCount; page++) {
      const png = await renderPng(tab.id, page, renderScale(tab.info!.pages[page].bounds, PRINT_SCALE, 1));
      const url = URL.createObjectURL(new Blob([png as Uint8Array<ArrayBuffer>], { type: "image/png" }));
      urls.push(url);
      const img = document.createElement("img");
      img.src = url;
      root.appendChild(img);
      await decode(img);
    }
    store.getState().setBusy(null);
    const finished = afterPrint();
    await print();
    await finished;
  } finally {
    printing = false;
    store.getState().setBusy(null);
    root.replaceChildren();
    urls.forEach((u) => URL.revokeObjectURL(u));
  }
}
