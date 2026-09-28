import type { PageInfo, Rect, Rotation } from "../engine/types";
import type { ViewMode } from "../state/store";
import { pageTransform } from "./geometry";

export const PAGE_GAP = 12;
export const PADDING = 16;
/** Largest bitmap rendered for one page (~64 MB RGBA). Beyond this the canvas is upscaled. */
export const MAX_RENDER_PIXELS = 16_000_000;

export interface Slot {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DocLayout {
  slots: Slot[];
  width: number;
  height: number;
}

function size(page: PageInfo, zoom: number, rotation: Rotation) {
  const t = pageTransform(page.bounds, zoom, rotation);
  return { width: t.width, height: t.height };
}

export function computeLayout(pages: PageInfo[], zoom: number, rotation: Rotation, mode: ViewMode, currentPage: number): DocLayout {
  const indices = mode === "single" ? [currentPage] : pages.map((_, i) => i);
  const perRow = mode === "two" ? 2 : 1;
  const rows: Slot[][] = [];
  for (let i = 0; i < indices.length; i += perRow) {
    rows.push(indices.slice(i, i + perRow).map((page) => ({ page, x: 0, y: 0, ...size(pages[page], zoom, rotation) })));
  }
  const rowWidth = (row: Slot[]) => row.reduce((w, s) => w + s.width, 0) + PAGE_GAP * (row.length - 1);
  const contentWidth = Math.max(0, ...rows.map(rowWidth));
  const width = contentWidth + 2 * PADDING;

  let y = PADDING;
  const slots: Slot[] = [];
  for (const row of rows) {
    // Single pages are centred; two-page spreads start at the left, like a book (a lone last page sits left).
    let x = PADDING + (perRow === 1 ? (contentWidth - rowWidth(row)) / 2 : 0);
    for (const slot of row) {
      slots.push({ ...slot, x, y });
      x += slot.width + PAGE_GAP;
    }
    y += Math.max(...row.map((s) => s.height)) + PAGE_GAP;
  }
  return { slots, width, height: y - PAGE_GAP + PADDING };
}

export function visibleSlots(layout: DocLayout, top: number, height: number, overscan = height / 2): Slot[] {
  const from = top - overscan;
  const to = top + height + overscan;
  return layout.slots.filter((s) => s.y + s.height >= from && s.y <= to);
}

export function pageAtOffset(layout: DocLayout, y: number): number {
  let page = layout.slots[0]?.page ?? 0;
  for (const s of layout.slots) {
    if (s.y > y) break;
    page = s.page;
  }
  return page;
}

export function fitZoom(bounds: Rect, rotation: Rotation, mode: ViewMode, viewport: { width: number; height: number }, fit: "width" | "page"): number {
  const t = pageTransform(bounds, 1, rotation);
  const contentWidth = mode === "two" ? 2 * t.width + PAGE_GAP : t.width;
  const byWidth = (viewport.width - 2 * PADDING) / contentWidth;
  if (fit === "width") return byWidth;
  return Math.min(byWidth, (viewport.height - 2 * PADDING) / t.height);
}

export function renderScale(bounds: Rect, zoom: number, dpr: number): number {
  const area = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]);
  return Math.min(zoom * dpr, Math.sqrt(MAX_RENDER_PIXELS / area));
}
