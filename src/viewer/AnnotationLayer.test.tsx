// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Annot } from "../edit/types";
import { appStore, getTab } from "../state/store";
import { AnnotationLayer } from "./AnnotationLayer";
import { pageTransform } from "./geometry";

if (!window.PointerEvent) (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;

const ink: Annot = {
  id: 7, page: 0, kind: "ink", subtype: "Ink", rect: [10, 10, 60, 60], box: [10, 10, 60, 60], strokes: [[[10, 10], [60, 60]]],
  color: [1, 0, 0], contents: "", author: "", modified: null, ours: true, movable: true, resizable: false,
};
const engine = vi.hoisted(() => ({
  listAnnotations: vi.fn(async () => [] as Annot[]),
  addAnnotation: vi.fn(async () => ({ history: { canUndo: true, canRedo: false, dirty: true }, id: "8" })),
  select: vi.fn(async () => ({ rects: [], text: "" })),
  moveAnnotation: vi.fn(async () => ({ history: { canUndo: true, canRedo: false, dirty: true }, id: "7" })),
}));
vi.mock("../engine/client", () => ({ getEngine: () => engine }));

let tabId: string;
beforeEach(() => {
  engine.addAnnotation.mockClear();
  engine.listAnnotations.mockResolvedValue([ink]);
  appStore.setState({ tabs: [], activeId: null, lang: "en", tool: "select", editMode: false, selectedAnnot: null, author: "Leo" });
  tabId = appStore.getState().addTab({ key: "/a.pdf", name: "a.pdf", path: "/a.pdf" }).id;
});
afterEach(cleanup);

async function renderLayer() {
  const view = render(<AnnotationLayer tab={getTab(appStore.getState(), tabId)!} page={0} transform={pageTransform([0, 0, 600, 800], 1, 0)} />);
  await act(async () => {});
  return view;
}

test("clicking an annotation's stroke selects it", async () => {
  const { container } = await renderLayer();
  fireEvent.pointerDown(container.querySelector(".annot-hit")!, { button: 0, clientX: 30, clientY: 30, pointerId: 1 });
  expect(appStore.getState().selectedAnnot).toEqual({ tabId, page: 0, id: 7 });
});

test("the pen tool turns a drag into an ink annotation", async () => {
  appStore.setState({ tool: "draw", drawStyle: { shape: "pen", color: [0, 0, 0], width: 2 } });
  const { container } = await renderLayer();
  const capture = container.querySelector(".annot-capture")!;
  fireEvent.pointerDown(capture, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(capture, { clientX: 120, clientY: 110, pointerId: 1 });
  fireEvent.pointerUp(capture, { clientX: 140, clientY: 120, pointerId: 1 });
  await act(async () => {});
  expect(engine.addAnnotation).toHaveBeenCalledWith(tabId, 0, { kind: "ink", strokes: [[[100, 100], [120, 110], [140, 120]]], color: [0, 0, 0], width: 2 }, "Leo");
});

test("a small jitter while clicking selects without moving", async () => {
  const { container } = await renderLayer();
  const hit = container.querySelector(".annot-hit")!;
  fireEvent.pointerDown(hit, { button: 0, clientX: 30, clientY: 30, pointerId: 1 });
  fireEvent.pointerMove(hit, { clientX: 32, clientY: 31, pointerId: 1 });
  fireEvent.pointerUp(hit, { clientX: 32, clientY: 31, pointerId: 1 });
  await act(async () => {});
  expect(engine.moveAnnotation).not.toHaveBeenCalled();
  expect(appStore.getState().selectedAnnot?.id).toBe(7);
});

test("the Comment tool places a note on a click, selects an annotation it clicks, and highlights dragged text", async () => {
  appStore.setState({ tool: "comment" });
  const { container } = await renderLayer();
  const capture = container.querySelector(".annot-capture")!;
  const click = async (x: number, y: number, toX = x) => {
    fireEvent.pointerDown(capture, { button: 0, clientX: x, clientY: y, pointerId: 1 });
    fireEvent.pointerMove(capture, { clientX: toX, clientY: y, pointerId: 1 });
    fireEvent.pointerUp(capture, { clientX: toX, clientY: y, pointerId: 1 });
    await act(async () => {});
  };
  await click(35, 35); // on the ink stroke
  expect(engine.addAnnotation).not.toHaveBeenCalled();
  expect(appStore.getState().selectedAnnot?.id).toBe(7);
  await click(300, 400);
  expect(engine.addAnnotation).toHaveBeenLastCalledWith(tabId, 0, { kind: "note", at: [300, 400], contents: "" }, "Leo");
  await click(100, 500, 250);
  expect(engine.addAnnotation).toHaveBeenLastCalledWith(tabId, 0, expect.objectContaining({ kind: "highlight", from: [100, 500], to: [250, 500] }), "Leo");
  expect(appStore.getState().tool).toBe("comment");
});
