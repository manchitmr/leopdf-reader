export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 8;
const STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

export function stepZoom(zoom: number, direction: 1 | -1): number {
  if (direction > 0) return STEPS.find((s) => s > zoom + 0.001) ?? ZOOM_MAX;
  return [...STEPS].reverse().find((s) => s < zoom - 0.001) ?? ZOOM_MIN;
}
