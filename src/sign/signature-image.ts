import type { Rect } from "../engine/types";

/** RGBA pixels (same shape as the browser's ImageData). */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const luminance = (d: Uint8ClampedArray, i: number) => (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;

/** Luminance below which `fraction` of the visible pixels lie. */
function percentile(px: Pixels, fraction: number): number {
  const counts = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < px.data.length; i += 4) {
    if (px.data[i + 3] < 128) continue;
    counts[Math.round(luminance(px.data, i) * 255)]++;
    total++;
  }
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += counts[v];
    if (seen >= total * fraction) return v / 255;
  }
  return 1;
}

/**
 * Removes the paper behind a photographed or scanned signature. The paper's shade is measured (photos of
 * paper are grey, not white) and pixels fade out smoothly between ink and paper, so edges stay smooth.
 * With `ink`, the kept pixels are recoloured to that colour (a crisp black or blue pen look).
 */
export function removeBackground(px: Pixels, ink: [number, number, number] | null = null): void {
  // ponytail: one paper shade for the whole photo; per-region shades if uneven lighting leaves shadows.
  const paper = percentile(px, 0.6);
  const dark = percentile(px, 0.01);
  if (paper - dark < 0.1) return; // no contrast: nothing to separate
  // Ink fully opaque up to 20% of the way to the paper, gone from 70% on (shadows and paper grain).
  const opaque = dark + (paper - dark) * 0.2;
  const clear = dark + (paper - dark) * 0.7;
  const { data } = px;
  for (let i = 0; i < data.length; i += 4) {
    const t = Math.min(1, Math.max(0, (clear - luminance(data, i)) / (clear - opaque)));
    data[i + 3] = Math.round(data[i + 3] * t * t * (3 - 2 * t));
    if (ink) data.set(ink, i);
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
