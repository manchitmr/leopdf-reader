import { expect, test } from "vitest";
import { inkBounds, whitenToTransparent, type Pixels } from "./signature-image";

function pixels(width: number, height: number, fill: [number, number, number, number]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width, height, data };
}
const set = (px: Pixels, x: number, y: number, rgba: [number, number, number, number]) => px.data.set(rgba, (y * px.width + x) * 4);

test("near-white pixels become transparent; ink stays", () => {
  const px = pixels(4, 1, [250, 250, 250, 255]);
  set(px, 1, 0, [20, 30, 120, 255]);
  set(px, 2, 0, [200, 200, 200, 255]); // light grey paper shadow stays (below threshold)
  whitenToTransparent(px);
  expect([px.data[3], px.data[7], px.data[11], px.data[15]]).toEqual([0, 255, 255, 0]);
});

test("ink bounds are padded, clamped, and null for an empty pad", () => {
  const px = pixels(100, 50, [0, 0, 0, 0]);
  expect(inkBounds(px)).toBeNull();
  set(px, 10, 20, [0, 0, 0, 255]);
  set(px, 40, 30, [0, 0, 0, 255]);
  expect(inkBounds(px, 4)).toEqual([6, 16, 45, 35]);
  set(px, 99, 49, [0, 0, 0, 255]);
  expect(inkBounds(px, 4)).toEqual([6, 16, 100, 50]);
});
