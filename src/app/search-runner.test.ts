import { expect, test, vi } from "vitest";
import type { SearchHit } from "../engine/types";
import { SEARCH_CHUNK, runChunkedSearch } from "./search-runner";

const onePerPage = vi.fn(async (_doc: string, _q: string, from: number, to: number): Promise<SearchHit[]> =>
  Array.from({ length: to - from }, (_, i) => ({ page: from + i, rects: [] })),
);

test("searches the document in chunks and gathers every hit", async () => {
  onePerPage.mockClear();
  const hits = await runChunkedSearch("d", "q", 25, onePerPage, () => true);
  expect(hits?.map((h) => h.page)).toEqual(Array.from({ length: 25 }, (_, i) => i));
  expect(onePerPage.mock.calls.map((c) => [c[2], c[3]])).toEqual([
    [0, SEARCH_CHUNK],
    [SEARCH_CHUNK, 2 * SEARCH_CHUNK],
    [2 * SEARCH_CHUNK, 25],
  ]);
});

test("stops as soon as the search is no longer current", async () => {
  onePerPage.mockClear();
  let current = true;
  const search = vi.fn(async (d: string, q: string, from: number, to: number) => {
    current = false; // e.g. the user closed the find bar during the first chunk
    return onePerPage(d, q, from, to);
  });
  expect(await runChunkedSearch("d", "q", 100, search, () => current)).toBeNull();
  expect(search).toHaveBeenCalledTimes(1);
});

test("stops at the hit limit", async () => {
  const hits = await runChunkedSearch("d", "q", 100, onePerPage, () => true, 15);
  expect(hits).toHaveLength(15);
});
