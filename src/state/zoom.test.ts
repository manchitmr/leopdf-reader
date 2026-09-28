import { expect, test } from "vitest";
import { clampZoom, stepZoom } from "./zoom";

test("clamps to 10%–800%", () => {
  expect(clampZoom(0.01)).toBe(0.1);
  expect(clampZoom(20)).toBe(8);
});

test("steps to the next preset", () => {
  expect(stepZoom(1, 1)).toBe(1.25);
  expect(stepZoom(1, -1)).toBe(0.75);
  expect(stepZoom(1.1, 1)).toBe(1.25);
  expect(stepZoom(1.1, -1)).toBe(1);
  expect(stepZoom(8, 1)).toBe(8);
  expect(stepZoom(0.1, -1)).toBe(0.1);
});
