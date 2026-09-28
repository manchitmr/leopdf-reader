import { expect, test } from "vitest";
import { findInPage, mergeLineRects, preparePage, quadToRect, type TextChar } from "./search";
import type { Quad } from "./types";

/** One fake 10×10 box per code point, laid out left to right on line `lineIndex`. */
function line(text: string, lineIndex = 0, startX = 0): TextChar[] {
  return Array.from(text).map((c, i) => {
    const x = startX + i * 10;
    const y = lineIndex * 20;
    const quad: Quad = [x, y, x + 10, y, x, y + 10, x + 10, y + 10];
    return { c, quad };
  });
}

test("quadToRect takes the bounding box", () => {
  expect(quadToRect([1, 2, 5, 2, 1, 8, 5, 8])).toEqual([1, 2, 5, 8]);
});

test("mergeLineRects joins neighbours on one line and splits across lines", () => {
  expect(mergeLineRects([[0, 0, 10, 10], [10, 0, 20, 10], [0, 20, 10, 30]])).toEqual([
    [0, 0, 20, 10],
    [0, 20, 10, 30],
  ]);
});

test("finds Sinhala text typed without ZWJ", () => {
  const page = preparePage(line("ශ්‍රී ලංකාව"));
  const hits = findInPage(page, "ශ්රී");
  expect(hits).toHaveLength(1);
  expect(hits[0]).toEqual([[0, 0, 50, 10]]);
});

test("finds Tamil text", () => {
  expect(findInPage(preparePage(line("தமிழ் நாடு")), "நாடு")).toHaveLength(1);
});

test("match spanning a line break returns one rect per line", () => {
  const chars = [...line("hello"), { c: "\n", quad: null }, ...line("world", 1)];
  const hits = findInPage(preparePage(chars), "hello world");
  expect(hits).toEqual([[[0, 0, 50, 10], [0, 20, 50, 30]]]);
});

test("finds every occurrence, case-insensitively, up to the limit", () => {
  const page = preparePage(line("Ab ab AB"));
  expect(findInPage(page, "ab")).toHaveLength(3);
  expect(findInPage(page, "ab", 2)).toHaveLength(2);
});

test("empty or whitespace query finds nothing", () => {
  const page = preparePage(line("abc"));
  expect(findInPage(page, "")).toEqual([]);
  expect(findInPage(page, "   ")).toEqual([]);
});
