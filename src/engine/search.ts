import { normalizeItems, normalizeQuery, type NormalizedText } from "./normalize";
import type { Quad, Rect } from "./types";

export interface TextChar {
  c: string;
  /** Null for synthetic separators (line and block breaks). */
  quad: Quad | null;
}

export interface PreparedPage {
  norm: NormalizedText;
  chars: TextChar[];
}

export function quadToRect(q: Quad): Rect {
  const xs = [q[0], q[2], q[4], q[6]];
  const ys = [q[1], q[3], q[5], q[7]];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Joins consecutive rects on the same line into one rect per line run. */
export function mergeLineRects(rects: Rect[]): Rect[] {
  const out: Rect[] = [];
  for (const r of rects) {
    const last = out[out.length - 1];
    const sameLine = last !== undefined && Math.abs(last[1] - r[1]) < (last[3] - last[1]) / 2 && r[0] >= last[0] - 1;
    if (sameLine) {
      out[out.length - 1] = [Math.min(last[0], r[0]), Math.min(last[1], r[1]), Math.max(last[2], r[2]), Math.max(last[3], r[3])];
    } else {
      out.push([...r]);
    }
  }
  return out;
}

export function preparePage(chars: TextChar[]): PreparedPage {
  return { norm: normalizeItems(chars.map((ch) => ch.c)), chars };
}

/** Returns one entry per match; each entry is the match's rects (one per line). */
export function findInPage(page: PreparedPage, query: string, limit = Infinity): Rect[][] {
  const needle = normalizeQuery(query);
  if (!needle) return [];
  const results: Rect[][] = [];
  let from = 0;
  while (results.length < limit) {
    const at = page.norm.text.indexOf(needle, from);
    if (at < 0) break;
    const sources = new Set<number>();
    for (let i = at; i < at + needle.length; i++) sources.add(page.norm.map[i]);
    const rects = [...sources]
      .sort((a, b) => a - b)
      .map((i) => page.chars[i].quad)
      .filter((q): q is Quad => q !== null)
      .map(quadToRect);
    results.push(mergeLineRects(rects));
    from = at + needle.length;
  }
  return results;
}
