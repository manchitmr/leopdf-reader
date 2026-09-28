import type { SearchHit } from "../engine/types";

/** Pages per engine call. Small enough that page renders queued behind a search wait well under a second. */
export const SEARCH_CHUNK = 10;
export const MAX_SEARCH_HITS = 1000;

type SearchPages = (docId: string, query: string, from: number, to: number) => Promise<SearchHit[]>;

/**
 * Searches a document chunk by chunk. Returns null if the search stopped being current
 * (new query, find bar closed, tab closed) so stale results are never shown.
 */
export async function runChunkedSearch(
  docId: string,
  query: string,
  pageCount: number,
  searchPages: SearchPages,
  isCurrent: () => boolean,
  limit = MAX_SEARCH_HITS,
): Promise<SearchHit[] | null> {
  const hits: SearchHit[] = [];
  for (let from = 0; from < pageCount && hits.length < limit; from += SEARCH_CHUNK) {
    const chunk = await searchPages(docId, query, from, Math.min(from + SEARCH_CHUNK, pageCount));
    if (!isCurrent()) return null;
    hits.push(...chunk.slice(0, limit - hits.length));
  }
  return hits;
}
