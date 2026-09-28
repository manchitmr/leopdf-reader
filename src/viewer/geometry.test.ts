import { expect, test } from "vitest";
import type { Point, Rect, Rotation } from "../engine/types";
import { pageTransform } from "./geometry";

const bounds: Rect = [0, 0, 600, 800];

test("no rotation scales by zoom", () => {
  const t = pageTransform(bounds, 2, 0);
  expect([t.width, t.height]).toEqual([1200, 1600]);
  expect(t.toDisplay([10, 20])).toEqual([20, 40]);
});

test("90° rotation puts the page's top-left at the display's top-right", () => {
  const t = pageTransform(bounds, 1, 90);
  expect([t.width, t.height]).toEqual([800, 600]);
  expect(t.toDisplay([0, 0])).toEqual([800, 0]);
  expect(t.toDisplay([600, 800])).toEqual([0, 600]);
});

test("toPage inverts toDisplay for every rotation", () => {
  for (const rotation of [0, 90, 180, 270] as Rotation[]) {
    const t = pageTransform([10, 20, 610, 820], 1.5, rotation);
    const p: Point = [123, 456];
    const back = t.toPage(t.toDisplay(p));
    expect(back[0]).toBeCloseTo(123);
    expect(back[1]).toBeCloseTo(456);
  }
});

test("rectToDisplay returns an axis-aligned display rect", () => {
  const t = pageTransform(bounds, 1, 90);
  expect(t.rectToDisplay([0, 0, 100, 50])).toEqual([750, 0, 800, 100]);
});
