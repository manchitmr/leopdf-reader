import type { Rect } from "../engine/types";

/** RGBA pixels (same shape as the browser's ImageData). */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Makes near-white pixels transparent (for photographed or scanned signatures). */
export function whitenToTransparent(px: Pixels, threshold = 0.9): void {
  const { data } = px;
  for (let i = 0; i < data.length; i += 4) {
    const luminance = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    if (luminance >= threshold) data[i + 3] = 0;
  }
}

/** Bounding box [x0, y0, x1, y1) of visible ink, grown by `pad` and clamped to the image; null if there is none. */
export function inkBounds(px: Pixels, pad = 8): Rect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < px.height; y++) {
    for (let x = 0; x < px.width; x++) {
      if (px.data[(y * px.width + x) * 4 + 3] <= 16) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return [Math.max(0, x0 - pad), Math.max(0, y0 - pad), Math.min(px.width, x1 + 1 + pad), Math.min(px.height, y1 + 1 + pad)];
}
