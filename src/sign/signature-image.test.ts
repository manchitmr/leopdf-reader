import { expect, test } from "vitest";
import { inkBounds, removeBackground, type Pixels } from "./signature-image";

function pixels(width: number, height: number, fill: [number, number, number, number]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width, height, data };
}
const set = (px: Pixels, x: number, y: number, rgba: [number, number, number, number]) => px.data.set(rgba, (y * px.width + x) * 4);

test("photographed grey paper disappears, ink stays, and edges fade smoothly", () => {
  // 100 px: 80 grey paper (as a phone photo shows it), 18 dark ink, 2 in-between edge pixels.
  const px = pixels(100, 1, [175, 172, 168, 255]);
  for (let x = 0; x < 18; x++) set(px, x, 0, [30, 35, 80, 255]);
  set(px, 18, 0, [90, 92, 110, 255]);
  set(px, 19, 0, [130, 130, 135, 255]);
  removeBackground(px);
  const alpha = (x: number) => px.data[x * 4 + 3];
  expect(alpha(50)).toBe(0); // paper
  expect(alpha(0)).toBe(255); // ink
  expect(alpha(18)).toBeGreaterThan(0); // edge: partly visible, not a hard cut
  expect(alpha(18)).toBeLessThan(255);
  expect(px.data.slice(0, 3)).toEqual(new Uint8ClampedArray([30, 35, 80])); // colours kept
});

test("with an ink colour the kept pixels are recoloured; a blank photo is left alone", () => {
  const px = pixels(10, 1, [200, 200, 200, 255]);
  set(px, 0, 0, [60, 40, 40, 255]);
  set(px, 1, 0, [60, 40, 40, 255]);
  removeBackground(px, [17, 17, 17]);
  expect(Array.from(px.data.slice(0, 4))).toEqual([17, 17, 17, 255]);
  const blank = pixels(4, 1, [200, 200, 200, 255]);
  removeBackground(blank);
  expect(blank.data[3]).toBe(255);
});

test("a WhatsApp JPEG of a transparent signature (black background) keeps the strokes, recoloured to black ink", () => {
  const px = pixels(20, 5, [0, 0, 0, 255]); // black where the PNG was transparent
  for (let x = 4; x < 16; x++) set(px, x, 2, [230, 230, 240, 255]); // light strokes
  removeBackground(px);
  expect(px.data[3]).toBe(0); // background gone
  expect(Array.from(px.data.slice((2 * 20 + 8) * 4, (2 * 20 + 8) * 4 + 4))).toEqual([17, 17, 17, 255]); // stroke, now black
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
