import { useEffect, useRef, useState } from "react";
import { getEngine } from "../engine/client";
import type { Point, Rect } from "../engine/types";
import type { ExistingImage, PageObject } from "../edit/types";
import { commitInlineEditor, replaceSelectedImage, runEdit } from "../app/edit-actions";
import { useT } from "../i18n/useT";
import { appStore, useApp, type DocTab } from "../state/store";
import type { PageTransform } from "./geometry";
import { InlineTextEditor } from "./InlineTextEditor";

interface Frame {
  id: string | null;
  kind: "text" | "image";
  rect: Rect;
  object?: PageObject;
}

type Drag = { frame: Frame; start: Point; mode: "move" | "resize"; delta: Point } | null;

export function EditLayer({ tab, page, transform, zoom }: { tab: DocTab; page: number; transform: PageTransform; zoom: number }) {
  const t = useT();
  const tool = useApp((s) => s.editTool);
  const selected = useApp((s) => s.selected);
  const editor = useApp((s) => s.inlineEditor);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [drag, setDrag] = useState<Drag>(null);
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getEngine().listObjects(tab.id, page), getEngine().listImages(tab.id, page)]).then(([objects, images]: [PageObject[], ExistingImage[]]) => {
      if (cancelled) return;
      setFrames([
        ...images.map((img) => ({ id: null, kind: "image" as const, rect: img.rect })),
        ...objects.map((o) => ({ id: o.id, kind: o.kind, rect: o.rect, object: o })),
      ]);
    });
    return () => {
      cancelled = true;
    };
  }, [tab.id, page, tab.revision]);

  const pagePoint = (e: React.PointerEvent): Point => {
    const box = layer.current!.getBoundingClientRect();
    return transform.toPage([e.clientX - box.left, e.clientY - box.top]);
  };

  const onLayerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.target !== layer.current) return;
    const s = appStore.getState();
    if (s.inlineEditor) {
      void commitInlineEditor();
      return;
    }
    if (tool === "text") s.openInlineEditor({ tabId: tab.id, page, origin: pagePoint(e), objectId: null, text: "", style: s.textStyle });
    else s.select(null);
  };

  const onFrameDown = (frame: Frame, mode: "move" | "resize") => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    appStore.getState().select({ tabId: tab.id, page, id: frame.id, rect: frame.rect });
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // No active pointer (synthetic events): dragging still works while the pointer stays on the layer.
    }
    setDrag({ frame, start: pagePoint(e), mode, delta: [0, 0] });
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = pagePoint(e);
    setDrag({ ...drag, delta: [p[0] - drag.start[0], p[1] - drag.start[1]] });
  };

  const onUp = () => {
    if (!drag) return;
    const { frame, delta, mode } = drag;
    setDrag(null);
    if (Math.hypot(delta[0], delta[1]) < 1) return;
    const engine = getEngine();
    if (mode === "resize" && frame.id) {
      const rect: Rect = [frame.rect[0], frame.rect[1], Math.max(frame.rect[0] + 8, frame.rect[2] + delta[0]), Math.max(frame.rect[1] + 8, frame.rect[3] + delta[1])];
      void runEdit(tab.id, () => engine.resizeObject(tab.id, page, frame.id!, rect));
    } else if (frame.id) {
      void runEdit(tab.id, () => engine.moveObject(tab.id, page, frame.id!, delta[0], delta[1]));
    } else {
      void runEdit(tab.id, () => engine.moveExistingImage(tab.id, page, frame.rect, delta[0], delta[1]));
    }
    appStore.getState().select(null);
  };

  const openText = (frame: Frame) => {
    const o = frame.object;
    if (!o || o.kind !== "text") return;
    appStore.getState().openInlineEditor({ tabId: tab.id, page, origin: o.origin!, objectId: o.id, text: o.text!, style: o.style! });
  };

  return (
    <div ref={layer} className={`edit-layer tool-${tool}`} onPointerDown={onLayerDown} onPointerMove={onMove} onPointerUp={onUp}>
      {frames.map((frame, i) => {
        const moving = drag?.frame === frame ? drag : null;
        const d = moving?.mode === "move" ? moving.delta : [0, 0];
        const grow = moving?.mode === "resize" ? moving.delta : [0, 0];
        const [x0, y0, x1, y1] = transform.rectToDisplay([frame.rect[0] + d[0], frame.rect[1] + d[1], frame.rect[2] + d[0] + grow[0], frame.rect[3] + d[1] + grow[1]]);
        const isSelected = selected?.page === page && selected.tabId === tab.id && selected.id === frame.id && selected.rect === frame.rect;
        const hidden = editor?.objectId && editor.objectId === frame.id;
        if (hidden) return null;
        return (
          <div
            key={frame.id ?? `img-${i}`}
            className={`edit-frame ${frame.kind} ${frame.id ? "ours" : "existing"} ${isSelected ? "selected" : ""}`}
            style={{ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }}
            onPointerDown={onFrameDown(frame, "move")}
            onDoubleClick={() => openText(frame)}
          >
            {isSelected && frame.kind === "image" && (
              <>
                {frame.id && <div className="edit-handle" onPointerDown={onFrameDown(frame, "resize")} />}
                <button className="frame-action" onPointerDown={(e) => e.stopPropagation()} onClick={() => void replaceSelectedImage()}>
                  {t("replaceImage")}
                </button>
              </>
            )}
          </div>
        );
      })}
      {editor && editor.tabId === tab.id && editor.page === page && (
        <InlineTextEditor
          state={editor}
          transform={transform}
          zoom={zoom}
          onChange={(text) => appStore.getState().updateInlineText(text)}
          onCommit={() => void commitInlineEditor()}
          onCancel={() => appStore.getState().closeInlineEditor()}
        />
      )}
    </div>
  );
}
