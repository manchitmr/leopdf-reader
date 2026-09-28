import * as mupdf from "mupdf";
import { findInPage, preparePage, quadToRect, type PreparedPage, type TextChar } from "./search";
import type { OpenResult, OutlineNode, PageInfo, Point, Quad, Rect, RenderedPage, Rotation, SearchHit, Selection } from "./types";

const MAX_HITS = 1000;
const STEXT_CACHE = 4;

type MuOutline = NonNullable<ReturnType<mupdf.Document["loadOutline"]>>[number];

let logSink: string[] | null = null;
mupdf.setLog({
  warning: (m) => void logSink?.push(m),
  error: (m) => void logSink?.push(m),
});

/** Runs `fn` while collecting MuPDF warnings (used to detect repaired files). */
function withLog<T>(fn: () => T): { value: T; log: string[] } {
  const log: string[] = [];
  logSink = log;
  try {
    return { value: fn(), log };
  } finally {
    logSink = null;
  }
}

function convertOutline(items: MuOutline[]): OutlineNode[] {
  return items.map((item) => ({
    title: item.title ?? "",
    page: typeof item.page === "number" && item.page >= 0 ? item.page : null,
    children: convertOutline(item.down ?? []),
  }));
}

interface OpenDoc {
  doc: mupdf.Document;
  repaired: boolean;
  stext: Map<number, mupdf.StructuredText>;
  prepared: Map<number, PreparedPage>;
}

export class DocumentEngine {
  private docs = new Map<string, OpenDoc>();

  open(docId: string, bytes: Uint8Array): OpenResult {
    let opened: { value: mupdf.Document; log: string[] };
    try {
      opened = withLog(() => mupdf.Document.openDocument(bytes, "application/pdf"));
    } catch {
      return { status: "error", reason: "corrupt" };
    }
    const repaired = opened.log.some((m) => m.includes("repair"));
    this.docs.set(docId, { doc: opened.value, repaired, stext: new Map(), prepared: new Map() });
    if (opened.value.needsPassword()) return { status: "needs-password" };
    return this.describe(docId);
  }

  unlock(docId: string, password: string): OpenResult {
    if (this.get(docId).doc.authenticatePassword(password) === 0) return { status: "wrong-password" };
    return this.describe(docId);
  }

  render(docId: string, pageIndex: number, scale: number, rotation: Rotation): RenderedPage {
    const page = this.get(docId).doc.loadPage(pageIndex);
    const matrix = mupdf.Matrix.concat(mupdf.Matrix.scale(scale, scale), mupdf.Matrix.rotate(rotation));
    const pix = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
    const width = pix.getWidth();
    const height = pix.getHeight();
    const stride = pix.getStride();
    const rgb = pix.getPixels();
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      let s = y * stride;
      let d = y * width * 4;
      for (let x = 0; x < width; x++, s += 3, d += 4) {
        pixels[d] = rgb[s];
        pixels[d + 1] = rgb[s + 1];
        pixels[d + 2] = rgb[s + 2];
        pixels[d + 3] = 255;
      }
    }
    pix.destroy();
    page.destroy();
    return { width, height, pixels };
  }

  renderPng(docId: string, pageIndex: number, scale: number): Uint8Array {
    const page = this.get(docId).doc.loadPage(pageIndex);
    const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
    const png = pix.asPNG().slice();
    pix.destroy();
    page.destroy();
    return png;
  }

  search(docId: string, query: string): SearchHit[] {
    const hits: SearchHit[] = [];
    const count = this.get(docId).doc.countPages();
    for (let p = 0; p < count && hits.length < MAX_HITS; p++) {
      for (const rects of findInPage(this.prepared(docId, p), query, MAX_HITS - hits.length)) {
        hits.push({ page: p, rects });
      }
    }
    return hits;
  }

  select(docId: string, pageIndex: number, from: Point, to: Point): Selection {
    const st = this.stext(docId, pageIndex);
    return {
      rects: st.highlight(from, to).map((q) => quadToRect(q as Quad)),
      text: st.copy(from, to),
    };
  }

  close(docId: string): void {
    const entry = this.docs.get(docId);
    if (!entry) return;
    entry.stext.forEach((st) => st.destroy());
    entry.doc.destroy();
    this.docs.delete(docId);
  }

  private describe(docId: string): OpenResult {
    const { doc, repaired } = this.get(docId);
    try {
      const pageCount = doc.countPages();
      if (pageCount === 0) return { status: "error", reason: "corrupt" };
      const pages: PageInfo[] = [];
      for (let i = 0; i < pageCount; i++) {
        const page = doc.loadPage(i);
        pages.push({ bounds: page.getBounds() as Rect, label: page.getLabel() || String(i + 1) });
        page.destroy();
      }
      return {
        status: "ok",
        info: {
          pageCount,
          pages,
          outline: convertOutline(doc.loadOutline() ?? []),
          title: doc.getMetaData(mupdf.Document.META_INFO_TITLE) || null,
          repaired,
        },
      };
    } catch {
      return { status: "error", reason: "corrupt" };
    }
  }

  private stext(docId: string, pageIndex: number): mupdf.StructuredText {
    const entry = this.get(docId);
    let st = entry.stext.get(pageIndex);
    if (!st) {
      const page = entry.doc.loadPage(pageIndex);
      st = page.toStructuredText("preserve-whitespace");
      page.destroy();
      entry.stext.set(pageIndex, st);
      if (entry.stext.size > STEXT_CACHE) {
        const oldest = entry.stext.keys().next().value!;
        entry.stext.get(oldest)!.destroy();
        entry.stext.delete(oldest);
      }
    }
    return st;
  }

  private prepared(docId: string, pageIndex: number): PreparedPage {
    const entry = this.get(docId);
    let prepared = entry.prepared.get(pageIndex);
    if (!prepared) {
      const chars: TextChar[] = [];
      const page = entry.doc.loadPage(pageIndex);
      const st = page.toStructuredText("preserve-whitespace");
      st.walk({
        onChar: (c, _origin, _font, _size, quad) => void chars.push({ c, quad: quad as Quad }),
        endLine: () => void chars.push({ c: "\n", quad: null }),
        endTextBlock: () => void chars.push({ c: "\n", quad: null }),
      });
      st.destroy();
      page.destroy();
      prepared = preparePage(chars);
      entry.prepared.set(pageIndex, prepared);
    }
    return prepared;
  }

  private get(docId: string): OpenDoc {
    const entry = this.docs.get(docId);
    if (!entry) throw new Error(`Unknown document ${docId}`);
    return entry;
  }
}
