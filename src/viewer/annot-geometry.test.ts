import { expect, test } from "vitest";
import type { Annot } from "../edit/types";
import type { DrawStyle } from "../state/store";
import { annotAt, dragRect, drawSpec, fitSignature, pathLength, pointsAttr, quadBox, resizeBox, shiftRect } from "./annot-geometry";
import { pageTransform } from "./geometry";

const style = (shape: DrawStyle["shape"]): DrawStyle => ({ shape, color: [1, 0, 0], width: 2 });

test("drag rectangles are normalised whichever way the user drags", () => {
  expect(dragRect([50, 80], [10, 20])).toEqual([10, 20, 50, 80]);
  expect(shiftRect([0, 0, 10, 10], [5, -2])).toEqual([5, -2, 15, 8]);
  expect(quadBox([10, 20, 60, 20, 10, 32, 60, 32])).toEqual([10, 20, 60, 32]);
});

test("signatures are centred on the click with their aspect ratio", () => {
  expect(fitSignature([200, 300], 150, 3)).toEqual([125, 275, 275, 325]);
});

test("resize keeps a minimum size and optionally the aspect ratio", () => {
  expect(resizeBox([0, 0, 100, 50], [20, 30], false)).toEqual([0, 0, 120, 80]);
  expect(resizeBox([0, 0, 100, 50], [20, 99], true)).toEqual([0, 0, 120, 60]);
  expect(resizeBox([0, 0, 100, 50], [-200, -200], false)).toEqual([0, 0, 8, 8]);
});

test("pointer paths become annotations only when they are big enough", () => {
  const pen = [[0, 0], [3, 4], [6, 8]] as [number, number][];
  expect(pathLength(pen)).toBe(10);
  expect(drawSpec(style("pen"), pen, 2)).toEqual({ kind: "ink", strokes: [pen], color: [1, 0, 0], width: 2 });
  expect(drawSpec(style("pen"), [[0, 0], [0.5, 0]], 2)).toBeNull();
  expect(drawSpec(style("arrow"), [[0, 0], [5, 5], [30, 40]], 2)).toEqual({ kind: "arrow", from: [0, 0], to: [30, 40], color: [1, 0, 0], width: 2 });
  expect(drawSpec(style("oval"), [[40, 50], [10, 10]], 2)).toEqual({ kind: "oval", rect: [10, 10, 40, 50], color: [1, 0, 0], width: 2 });
  expect(drawSpec(style("rect"), [[0, 0], [40, 1]], 2)).toBeNull();
});

test("points are converted to display space for SVG", () => {
  const t = pageTransform([0, 0, 100, 200], 2, 0);
  expect(pointsAttr([[1, 2], [3, 4]], t)).toBe("2,4 6,8");
});

const annot = (over: Partial<Annot> & Pick<Annot, "id" | "rect">): Annot => ({
  page: 0, kind: "note", subtype: "Text", box: null, color: null, contents: "", author: "", modified: null, ours: true, movable: true, resizable: false, ...over,
});

test("the annotation under a point is found, topmost first; markup by its quads, drawings by their strokes", () => {
  const note = annot({ id: 1, rect: [10, 10, 30, 30] });
  const mark = annot({ id: 2, kind: "highlight", rect: [0, 0, 200, 100], quads: [[50, 50, 150, 50, 50, 60, 150, 60]] });
  const top = annot({ id: 3, rect: [20, 20, 40, 40] });
  const ink = annot({ id: 4, kind: "ink", rect: [300, 300, 400, 400], strokes: [[[300, 300], [400, 400]]] });
  const list = [note, mark, top, ink];
  expect(annotAt(list, [25, 25], 3)?.id).toBe(3);
  expect(annotAt(list, [15, 15], 3)?.id).toBe(1);
  expect(annotAt(list, [100, 55], 3)?.id).toBe(2);
  expect(annotAt(list, [100, 80], 3)).toBeNull(); // inside the highlight's bounds, not on its text
  expect(annotAt(list, [351, 349], 3)?.id).toBe(4);
  expect(annotAt(list, [390, 310], 3)).toBeNull(); // inside the drawing's box, far from the stroke
});
