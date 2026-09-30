import type { Rect } from "../engine/types";

/** RGBA pixels (same shape as the browser's ImageData). */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}


/** Median colour of the image's outer frame of pixels: the paper (or whatever surrounds the signature). */
function backgroundColor(px: Pixels): [number, number, number] {
  const samples: number[][] = [[], [], []];
  const take = (x: number, y: number) => {
    const i = (y * px.width + x) * 4;
    for (let c = 0; c < 3; c++) samples[c].push(px.data[i + c]);
  };
  for (let x = 0; x < px.width; x++) {
    take(x, 0);
    take(x, px.height - 1);
  }
  for (let y = 0; y < px.height; y++) {
    take(0, y);
    take(px.width - 1, y);
  }
  return samples.map((v) => v.sort((a, b) => a - b)[v.length >> 1]) as [number, number, number];
}

/**
 * Removes whatever surrounds a photographed or scanned signature: grey photographed paper, or the black a
 * transparent PNG gets when WhatsApp turns it into a JPEG. The background is the colour of the image's
 * edges; pixels fade out smoothly as they get closer to it, so edges stay smooth. With `ink` the kept
 * pixels are recoloured; ink lighter than its background (white on black) is always recoloured, black by
 * default, since it would vanish on paper.
 */
export function removeBackground(px: Pixels, ink: [number, number, number] | null = null): void {
  const { data } = px;
  const bg = backgroundColor(px);
  const distance = (i: number) => Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]) / 441.7;
  // ponytail: one background colour for the whole photo; per-region colours if uneven lighting leaves shadows.
  const counts = new Uint32Array(101);
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] >= 128) counts[Math.round(distance(i) * 100)]++;
  const total = counts.reduce((a, b) => a + b, 0);
  let seen = 0;
  let far = 0; // distance of the ink: the 99.5th percentile, robust to a few odd pixels
  for (let d = 0; d <= 100; d++) {
    seen += counts[d];
    if (seen >= total * 0.995) {
      far = d / 100;
      break;
    }
  }
  if (far < 0.1) return; // no contrast: nothing to separate
  // Ink fully opaque from 80% of the way out to the ink's distance; gone below 30% (shadows, grain).
  const clear = far * 0.3;
  const opaque = far * 0.8;
  const bgLight = (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]) / 255 >= 0.5;
  const color = ink ?? (bgLight ? null : ([17, 17, 17] as [number, number, number]));
  for (let i = 0; i < data.length; i += 4) {
    const t = Math.min(1, Math.max(0, (distance(i) - clear) / (opaque - clear)));
    data[i + 3] = Math.round(data[i + 3] * t * t * (3 - 2 * t));
    if (color) data.set(color, i);
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
