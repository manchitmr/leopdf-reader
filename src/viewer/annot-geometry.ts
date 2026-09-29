import type { NewAnnot } from "../edit/types";
import type { Point, Quad, Rect } from "../engine/types";
import type { DrawStyle } from "../state/store";
import type { PageTransform } from "./geometry";

export function dragRect([ax, ay]: Point, [bx, by]: Point): Rect {
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}

export const shiftRect = ([x0, y0, x1, y1]: Rect, [dx, dy]: Point): Rect => [x0 + dx, y0 + dy, x1 + dx, y1 + dy];

export function quadBox(q: Quad): Rect {
  const xs = [q[0], q[2], q[4], q[6]];
  const ys = [q[1], q[3], q[5], q[7]];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** A `width`-wide box with the image's aspect ratio (width / height), centred on `at`. */
export function fitSignature([x, y]: Point, width: number, aspect: number): Rect {
  const height = width / aspect;
  return [x - width / 2, y - height / 2, x + width / 2, y + height / 2];
}

/** Grows/shrinks from the top-left corner by the drag delta. */
export function resizeBox([x0, y0, x1, y1]: Rect, [dx, dy]: Point, keepAspect: boolean, min = 8): Rect {
  const width = Math.max(min, x1 - x0 + dx);
  const height = keepAspect ? (width * (y1 - y0)) / (x1 - x0) : Math.max(min, y1 - y0 + dy);
  return [x0, y0, x0 + width, y0 + height];
}

export function pathLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return total;
}

/** Turns a pointer path (page space) into a new annotation, or null if it is too small to mean anything. */
export function drawSpec({ shape, color, width }: DrawStyle, points: Point[], minSize: number): NewAnnot | null {
  if (points.length < 2) return null;
  if (shape === "pen") return pathLength(points) >= minSize ? { kind: "ink", strokes: [points], color, width } : null;
  const from = points[0];
  const to = points[points.length - 1];
  if (shape === "line" || shape === "arrow") return Math.hypot(to[0] - from[0], to[1] - from[1]) >= minSize ? { kind: shape, from, to, color, width } : null;
  const rect = dragRect(from, to);
  return rect[2] - rect[0] >= minSize && rect[3] - rect[1] >= minSize ? { kind: shape, rect, color, width } : null;
}

export function pointsAttr(points: Point[], t: PageTransform): string {
  return points.map((p) => t.toDisplay(p).join(",")).join(" ");
}
