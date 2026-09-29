import * as mupdf from "mupdf";
import type { OutlineNode } from "../engine/types";

type MuOutline = NonNullable<ReturnType<mupdf.Document["loadOutline"]>>[number];

function convert(items: MuOutline[], parent: number[]): OutlineNode[] {
  return items.map((item, i) => {
    const path = [...parent, i];
    return {
      title: item.title ?? "",
      page: typeof item.page === "number" && item.page >= 0 ? item.page : null,
      path,
      children: convert(item.down ?? [], path),
    };
  });
}

/** The document's bookmarks (PDF outline); `path` addresses an item for editing. */
export function listOutline(doc: mupdf.Document): OutlineNode[] {
  return convert(doc.loadOutline() ?? [], []);
}

const AT_ITEM = mupdf.OutlineIterator.ITERATOR_AT_ITEM;

function iteratorAt(doc: mupdf.PDFDocument, path: number[]): mupdf.OutlineIterator {
  const it = doc.outlineIterator();
  const missing = () => new Error(`No bookmark at ${path.join(".")}`);
  path.forEach((index, depth) => {
    if (depth > 0 && it.down() !== AT_ITEM) throw missing();
    for (let i = 0; i < index; i++) if (it.next() !== AT_ITEM) throw missing();
  });
  if (!it.item()) throw missing();
  return it;
}

/** Appends a top-level bookmark to `page` (0-based) and returns its path. */
export function addBookmark(doc: mupdf.PDFDocument, page: number, title: string): number[] {
  const it = doc.outlineIterator();
  let count = 0;
  if (it.item()) {
    count = 1;
    while (it.next() === AT_ITEM) count++;
  }
  const uri = doc.formatLinkURI({ type: "Fit", chapter: 0, page, x: 0, y: 0, width: 0, height: 0, zoom: 0 });
  it.insert({ title, uri, open: false });
  return [count];
}

export function renameBookmark(doc: mupdf.PDFDocument, path: number[], title: string): void {
  const it = iteratorAt(doc, path);
  it.update({ ...it.item()!, title });
}

export function deleteBookmark(doc: mupdf.PDFDocument, path: number[]): void {
  iteratorAt(doc, path).delete();
}
