import { expect, test } from "vitest";
import type { PageInfo } from "../engine/types";
import { MAX_RENDER_PIXELS, PADDING, PAGE_GAP, computeLayout, fitZoom, pageAtOffset, renderScale, visibleSlots } from "./layout";

const pages = (n: number): PageInfo[] => Array.from({ length: n }, (_, i) => ({ bounds: [0, 0, 600, 800], label: String(i + 1) }));

test("continuous layout stacks pages with gaps and padding", () => {
  const l = computeLayout(pages(3), 1, 0, "continuous", 0);
  expect(l.slots.map((s) => s.y)).toEqual([PADDING, PADDING + 800 + PAGE_GAP, PADDING + 2 * (800 + PAGE_GAP)]);
  expect(l.width).toBe(600 + 2 * PADDING);
  expect(l.height).toBe(3 * 800 + 2 * PAGE_GAP + 2 * PADDING);
});

test("single-page layout contains only the current page", () => {
  const l = computeLayout(pages(3), 1, 0, "single", 2);
  expect(l.slots.map((s) => s.page)).toEqual([2]);
});

test("two-page layout puts pairs side by side", () => {
  const l = computeLayout(pages(3), 1, 0, "two", 0);
  expect(l.slots.map((s) => [s.page, s.x, s.y])).toEqual([
    [0, PADDING, PADDING],
    [1, PADDING + 600 + PAGE_GAP, PADDING],
    [2, PADDING, PADDING + 800 + PAGE_GAP],
  ]);
});

test("rotation swaps slot dimensions", () => {
  const [slot] = computeLayout(pages(1), 1, 90, "continuous", 0).slots;
  expect([slot.width, slot.height]).toEqual([800, 600]);
});

test("only pages near the viewport are visible in a 1000-page document", () => {
  const l = computeLayout(pages(1000), 1, 0, "continuous", 0);
  const visible = visibleSlots(l, 500 * 812, 900);
  expect(visible.length).toBeLessThanOrEqual(4);
  expect(visible.map((s) => s.page)).toContain(500);
});

test("pageAtOffset finds the page under a y offset", () => {
  const l = computeLayout(pages(5), 1, 0, "continuous", 0);
  expect(pageAtOffset(l, 0)).toBe(0);
  expect(pageAtOffset(l, PADDING + 812 * 2 + 5)).toBe(2);
  expect(pageAtOffset(l, 1e9)).toBe(4);
});

test("fit width and fit page", () => {
  const vp = { width: 632, height: 432 };
  expect(fitZoom([0, 0, 600, 800], 0, "continuous", vp, "width")).toBeCloseTo(1);
  expect(fitZoom([0, 0, 600, 800], 0, "continuous", vp, "page")).toBeCloseTo(0.5);
  expect(fitZoom([0, 0, 600, 800], 0, "two", { width: 1244, height: 2000 }, "width")).toBeCloseTo(1);
});

test("render scale is capped by the pixel budget", () => {
  expect(renderScale([0, 0, 600, 800], 1, 2)).toBe(2);
  const capped = renderScale([0, 0, 600, 800], 8, 2);
  expect(600 * capped * 800 * capped).toBeLessThanOrEqual(MAX_RENDER_PIXELS + 1);
});
