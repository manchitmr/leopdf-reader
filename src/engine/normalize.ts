/** Invisible characters that affect shaping but not meaning: ZWSP, ZWNJ, ZWJ, soft hyphen, BOM. */
const IGNORABLE = /[​-‍­﻿]/g;
const WHITESPACE = /^\s+$/;

export interface NormalizedText {
  /** Text used for matching. */
  text: string;
  /** For each UTF-16 unit of `text`, the index of the source item it came from. */
  map: number[];
}

/**
 * Normalises a sequence of source items (one per extracted character) for search.
 * Each item is decomposed (NFD) on its own so the mapping back to source items stays exact;
 * queries go through the same per-code-point path, so both sides agree.
 */
export function normalizeItems(items: string[]): NormalizedText {
  let text = "";
  const map: number[] = [];
  let lastWasSpace = true;
  items.forEach((item, index) => {
    if (WHITESPACE.test(item)) {
      if (!lastWasSpace) {
        text += " ";
        map.push(index);
        lastWasSpace = true;
      }
      return;
    }
    const piece = item.normalize("NFD").replace(IGNORABLE, "").toLowerCase();
    for (let i = 0; i < piece.length; i++) map.push(index);
    text += piece;
    if (piece.length > 0) lastWasSpace = false;
  });
  return { text, map };
}

export function normalizeQuery(query: string): string {
  return normalizeItems(Array.from(query)).text.trimEnd();
}
