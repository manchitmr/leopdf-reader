import type { RGB } from "../edit/types";

/** Yellow, green, blue, pink, red. */
export const MARKUP_COLORS: RGB[] = [[1, 0.92, 0.23], [0.49, 0.87, 0.35], [0.35, 0.72, 1], [1, 0.55, 0.8], [0.94, 0.27, 0.27]];
/** Red, blue, black, green, orange. */
export const DRAW_COLORS: RGB[] = [[0.86, 0.15, 0.15], [0.15, 0.39, 0.92], [0, 0, 0], [0.09, 0.64, 0.29], [0.98, 0.45, 0.09]];
export const DRAW_WIDTHS = [1, 2, 4, 8];

export const toHex = (c: RGB) => `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
export const sameColor = (a: RGB, b: RGB) => a.every((v, i) => Math.abs(v - b[i]) < 0.01);
export const cssColor = (c: RGB | null, alpha = 1) =>
  c ? `rgba(${c.map((v) => Math.round(v * 255)).join(", ")}, ${alpha})` : `rgba(0, 0, 0, ${alpha})`;
