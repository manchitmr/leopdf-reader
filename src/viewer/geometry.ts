import type { Point, Rect, Rotation } from "../engine/types";

export interface PageTransform {
  /** Display size in CSS pixels. */
  width: number;
  height: number;
  toDisplay(p: Point): Point;
  toPage(p: Point): Point;
  rectToDisplay(r: Rect): Rect;
}

/** Same convention as MuPDF's Matrix.rotate: x' = x·cos − y·sin, y' = x·sin + y·cos. */
function rotatePoint([x, y]: Point, rotation: Rotation): Point {
  switch (rotation) {
    case 0:
      return [x, y];
    case 90:
      return [-y, x];
    case 180:
      return [-x, -y];
    case 270:
      return [y, -x];
  }
}

function boundingBox(points: Point[]): Rect {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Maps page coordinates (PDF points) to display pixels at `zoom` and `rotation`, matching MuPDF's pixmap origin. */
export function pageTransform(bounds: Rect, zoom: number, rotation: Rotation): PageTransform {
  const corners: Point[] = [
    [bounds[0], bounds[1]],
    [bounds[2], bounds[1]],
    [bounds[0], bounds[3]],
    [bounds[2], bounds[3]],
  ];
  const [minX, minY, maxX, maxY] = boundingBox(corners.map((p) => rotatePoint(p, rotation)).map(([x, y]) => [x * zoom, y * zoom] as Point));
  const inverse = ((360 - rotation) % 360) as Rotation;

  const toDisplay = (p: Point): Point => {
    const [x, y] = rotatePoint(p, rotation);
    return [x * zoom - minX, y * zoom - minY];
  };
  return {
    width: maxX - minX,
    height: maxY - minY,
    toDisplay,
    toPage: ([dx, dy]) => rotatePoint([(dx + minX) / zoom, (dy + minY) / zoom], inverse),
    rectToDisplay: (r) =>
      boundingBox([
        toDisplay([r[0], r[1]]),
        toDisplay([r[2], r[1]]),
        toDisplay([r[0], r[3]]),
        toDisplay([r[2], r[3]]),
      ]),
  };
}
