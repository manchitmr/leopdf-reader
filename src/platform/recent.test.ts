import { expect, test } from "vitest";
import { addRecent, loadRecent, removeRecent, saveRecent, type RecentFile } from "./recent";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => void (data[k] = v),
  } as unknown as Storage;
}

test("adds to the front, dedupes, caps at 10", () => {
  let list: RecentFile[] = [];
  for (let i = 0; i < 12; i++) list = addRecent(list, `/d/f${i}.pdf`, i);
  list = addRecent(list, "/d/f5.pdf", 99);
  expect(list).toHaveLength(10);
  expect(list[0]).toEqual({ path: "/d/f5.pdf", name: "f5.pdf", openedAt: 99 });
  expect(list.filter((r) => r.path === "/d/f5.pdf")).toHaveLength(1);
});

test("removes by path", () => {
  const list = addRecent(addRecent([], "/a.pdf", 1), "/b.pdf", 2);
  expect(removeRecent(list, "/a.pdf").map((r) => r.path)).toEqual(["/b.pdf"]);
});

test("round-trips through storage and survives bad data", () => {
  const storage = memoryStorage();
  saveRecent(addRecent([], "/a.pdf", 1), storage);
  expect(loadRecent(storage)[0].path).toBe("/a.pdf");
  expect(loadRecent(memoryStorage({ "leopdf.recent": "{bad json" }))).toEqual([]);
  expect(loadRecent(memoryStorage({ "leopdf.recent": '{"not":"a list"}' }))).toEqual([]);
});
