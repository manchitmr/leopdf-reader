import { useEffect, useRef, useState } from "react";
import { getEngine } from "../engine/client";
import type { Point, Rect } from "../engine/types";
import type { EditableLine, ExistingImage, PageObject } from "../edit/types";
import { commitInlineEditor, replaceSelectedImage, runEdit } from "../app/edit-actions";
import { useT } from "../i18n/useT";
import { appStore, useApp, type DocTab } from "../state/store";
import type { PageTransform } from "./geometry";
import { InlineTextEditor } from "./InlineTextEditor";
import { findInstalled, listSystemFonts } from "../platform/fonts";

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
  const [lines, setLines] = useState<EditableLine[]>([]);
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

  useEffect(() => {
    let cancelled = false;
    if (tool === "select") void getEngine().listLines(tab.id, page).then((l: EditableLine[]) => !cancelled && setLines(l));
    else setLines([]);
    return () => {
      cancelled = true;
    };
  }, [tab.id, page, tab.revision, tool]);

  // Opens on click, not pointerdown: the pointerdown's default focus change would blur (and so commit) the new editor.
  // An editor already open on another line is committed by that same blur first.
  const onLineClick = (line: EditableLine) => (e: React.MouseEvent) => {
    e.stopPropagation();
    const s = appStore.getState();
    if (line.locked) {
      s.showNotice(line.locked === "legacy" ? "lineLegacy" : "lineNoUnicode");
      return;
    }
    // Same font installed → write with it at the original size; otherwise the fitted Noto style.
    void listSystemFonts().then((fonts) => {
      // Never a legacy font: it would draw the Unicode text as gibberish.
      const face = line.legacyFont ? undefined : findInstalled(fonts, line.fontName, line.style.bold, !!line.style.italic);
      const style = face ? { ...line.style, face, size: line.fontSize } : line.style;
      // `line.style` becomes the style it opened with, so committing it untouched changes nothing.
      appStore.getState().openInlineEditor({ tabId: tab.id, page, origin: line.origin, objectId: null, line: { ...line, style }, text: line.text, style });
    });
  };

  const pagePoint = (e: React.PointerEvent): Point => {
    const box = layer.current!.getBoundingClientRect();
    return transform.toPage([e.clientX - box.left, e.clientY - box.top]);
  };

  /** Set when a pointerdown just closed an open editor, so the click that follows doesn't open a new one. */
  const closedEditor = useRef(false);
  const onLayerDown = (e: React.PointerEvent) => {
    closedEditor.current = false;
    if (e.button !== 0 || e.target !== layer.current) return;
    const s = appStore.getState();
    if (s.inlineEditor) {
      closedEditor.current = true;
      void commitInlineEditor();
      return;
    }
    if (tool !== "text") s.select(null);
  };
  // New text opens on click, not pointerdown: the pointerdown's default focus change would blur (and so
  // commit and close) the editor the moment it appears.
  const onLayerClick = (e: React.MouseEvent) => {
    if (tool !== "text" || e.target !== layer.current || closedEditor.current) return;
    const box = layer.current!.getBoundingClientRect();
    const s = appStore.getState();
    s.openInlineEditor({ tabId: tab.id, page, origin: transform.toPage([e.clientX - box.left, e.clientY - box.top]), objectId: null, text: "", style: s.textStyle });
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
    <div ref={layer} className={`edit-layer tool-${tool}`} onPointerDown={onLayerDown} onClick={onLayerClick} onPointerMove={onMove} onPointerUp={onUp}>
      {lines.map((line, i) => {
        if (editor?.line?.rect === line.rect) return null;
        const [x0, y0, x1, y1] = transform.rectToDisplay(line.rect);
        return (
          <div
            key={`line-${i}`}
            className={`edit-line ${line.locked ? "locked" : ""}`}
            style={{ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }}
            title={line.locked ? t(line.locked === "legacy" ? "lineLegacy" : "lineNoUnicode") : t("editLine")}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onLineClick(line)}
          />
        );
      })}
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
