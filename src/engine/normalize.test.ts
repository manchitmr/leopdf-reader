import { expect, test } from "vitest";
import { normalizeItems, normalizeQuery } from "./normalize";

const items = (s: string) => Array.from(s);

test("Sinhala with and without ZWJ normalise the same", () => {
  expect(normalizeQuery("ශ්‍රී")).toBe(normalizeQuery("ශ්රී"));
});

test("precomposed and decomposed Sinhala vowel signs match", () => {
  expect(normalizeQuery("කො")).toBe(normalizeQuery("කො"));
});

test("precomposed and decomposed Tamil vowel signs match", () => {
  expect(normalizeQuery("கொ")).toBe(normalizeQuery("கொ"));
});

test("Latin is case-insensitive", () => {
  expect(normalizeQuery("Hello")).toBe("hello");
});

test("whitespace runs collapse to one space and are trimmed", () => {
  expect(normalizeItems(items("  a \n\t b ")).text).toBe("a b ");
  expect(normalizeQuery("  a \n b  ")).toBe("a b");
});

test("map points each output unit at its source item", () => {
  const n = normalizeItems(["A", "‍", " ", " ", "b"]);
  expect(n.text).toBe("a b");
  expect(n.map).toEqual([0, 2, 4]);
});
