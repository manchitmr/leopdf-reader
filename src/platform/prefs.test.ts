import { expect, test } from "vitest";
import { MAX_SIGNATURES, loadAuthor, loadSignatures, saveAuthor, saveSignatures, withSignature, type SavedSignature } from "./prefs";

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  };
}
const sig = (id: string): SavedSignature => ({ id, png: "data:image/png;base64,AA==", width: 100, height: 40 });

test("author is null until saved, then remembered (empty means 'skipped')", () => {
  const s = memory();
  expect(loadAuthor(s)).toBeNull();
  saveAuthor("", s);
  expect(loadAuthor(s)).toBe("");
  saveAuthor("මනිත්", s);
  expect(loadAuthor(s)).toBe("මනිත්");
});

test("signatures round-trip and bad data is ignored", () => {
  const s = memory();
  expect(saveSignatures([sig("a")], s)).toBe(true);
  expect(loadSignatures(s)).toEqual([sig("a")]);
  s.setItem("leopdf.signatures", "{not json");
  expect(loadSignatures(s)).toEqual([]);
  s.setItem("leopdf.signatures", JSON.stringify([{ id: 1 }, sig("b")]));
  expect(loadSignatures(s)).toEqual([sig("b")]);
});

test("a full or missing storage reports failure instead of throwing", () => {
  const full = { ...memory(), setItem: () => { throw new Error("QuotaExceededError"); } } as Storage;
  expect(saveSignatures([sig("a")], full)).toBe(false);
  expect(() => saveAuthor("x", full)).not.toThrow();
});

test("new signatures go first and the oldest is dropped past the limit", () => {
  let list: SavedSignature[] = [];
  for (let i = 0; i < MAX_SIGNATURES; i++) list = withSignature(list, sig(String(i))).list;
  const r = withSignature(list, sig("new"));
  expect(r.dropped).toBe(true);
  expect(r.list.map((x) => x.id)).toEqual(["new", "4", "3", "2", "1"]);
});
