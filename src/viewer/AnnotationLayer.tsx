import { useEffect, useRef, useState } from "react";
import { SIGNATURE_WIDTH, addAnnot, addNote, moveAnnot, placeSignature, resizeAnnot } from "../app/annot-actions";
import { getEngine } from "../engine/client";
import type { Annot } from "../edit/types";
import type { Point, Rect } from "../engine/types";
import { cssColor } from "../state/palette";
import { appStore, useApp, type DocTab } from "../state/store";
import { AnnotCard } from "./AnnotCard";
import { dragRect, drawSpec, fitSignature, pointsAttr, quadBox, resizeBox, shiftRect } from "./annot-geometry";
import type { PageTransform } from "./geometry";

type Gesture =
  | { kind: "move"; annot: Annot; start: Point; delta: Point }
  | { kind: "resize"; annot: Annot; start: Point; delta: Point }
  | { kind: "stroke"; points: Point[] }
  | { kind: "markup"; from: Point; rects: Rect[] }
  | null;

/** A click that wanders less than this (CSS px) selects without moving (Windows' drag threshold). */
const DRAG_THRESHOLD = 4;

/** Width in CSS px of the invisible hit area around ink and lines. */
const HIT_WIDTH = 10;

function AnnotHit({ annot, transform, onPointerDown }: { annot: Annot; transform: PageTransform; onPointerDown(e: React.PointerEvent): void }) {
  if (annot.quads?.length)
    return (
      <g className="annot-hit" onPointerDown={onPointerDown}>
        {annot.quads.map((q, i) => {
          const [x0, y0, x1, y1] = transform.rectToDisplay(quadBox(q));
          return <rect key={i} x={x0} y={y0} width={x1 - x0} height={y1 - y0} />;
        })}
      </g>
    );
  if (annot.strokes && (annot.kind === "ink" || annot.kind === "line" || annot.kind === "arrow"))
    return (
      <g className="annot-hit stroke" onPointerDown={onPointerDown}>
        {annot.strokes.map((s, i) => (
          <polyline key={i} points={pointsAttr(s, transform)} strokeWidth={HIT_WIDTH} />
        ))}
      </g>
    );
  const [x0, y0, x1, y1] = transform.rectToDisplay(annot.rect);
  return <rect className="annot-hit" x={x0} y={y0} width={x1 - x0} height={y1 - y0} onPointerDown={onPointerDown} />;
}

/** Annotation input and selection for one page (not used in Edit mode). The annotations themselves are drawn by MuPDF. */
export function AnnotationLayer({ tab, page, transform }: { tab: DocTab; page: number; transform: PageTransform }) {
  const tool = useApp((s) => s.tool);
  const selected = useApp((s) => s.selectedAnnot);
  const markup = useApp((s) => s.markupStyle);
  const draw = useApp((s) => s.drawStyle);
  const signature = useApp((s) => s.signatures.find((x) => x.id === s.signatureId) ?? null);
  const [annots, setAnnots] = useState<Annot[]>([]);
  const [gesture, setGesture] = useState<Gesture>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  const pending = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void getEngine()
      .listAnnotations(tab.id, page)
      .then((list: Annot[]) => !cancelled && setAnnots(list));
    return () => {
      cancelled = true;
    };
  }, [tab.id, page, tab.revision]);

  const pagePoint = (e: React.PointerEvent): Point => {
    const box = layer.current!.getBoundingClientRect();
    return transform.toPage([e.clientX - box.left, e.clientY - box.top]);
  };
  const capture = (e: React.PointerEvent) => {
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured; the gesture still works while the pointer stays on the page.
    }
  };
  const minSize = 2 / tab.zoom;
  const current = annots.find((a) => selected?.tabId === tab.id && selected.page === page && selected.id === a.id) ?? null;

  const onAnnotDown = (annot: Annot, kind: "move" | "resize") => (e: React.PointerEvent) => {
    if (tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    const s = appStore.getState();
    s.setSelection(tab.id, null);
    s.selectAnnot({ tabId: tab.id, page, id: annot.id });
    if (kind === "resize" ? annot.resizable : annot.movable) {
      capture(e);
      setGesture(kind === "move" ? { kind, annot, start: pagePoint(e), delta: [0, 0] } : { kind, annot, start: pagePoint(e), delta: [0, 0] });
    }
  };

  const onCaptureDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = pagePoint(e);
    if (tool === "comment") return void addNote(tab.id, page, p);
    if (tool === "sign") return void placeSignature(tab.id, page, p);
    capture(e);
    setGesture(tool === "markup" ? { kind: "markup", from: p, rects: [] } : { kind: "stroke", points: [p] });
  };

  const onMove = (e: React.PointerEvent) => {
    const p = pagePoint(e);
    if (tool === "sign") setHover(p);
    const g = gesture;
    if (!g) return;
    if (g.kind === "move" || g.kind === "resize") setGesture({ ...g, delta: [p[0] - g.start[0], p[1] - g.start[1]] });
    else if (g.kind === "stroke") {
      if (draw.shape !== "pen") setGesture({ kind: "stroke", points: [g.points[0], p] });
      else {
        const last = g.points[g.points.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= minSize) setGesture({ kind: "stroke", points: [...g.points, p] });
      }
    } else if (!pending.current) {
      pending.current = true;
      const from = g.from;
      void getEngine()
        .select(tab.id, page, from, p)
        .then((sel: { rects: Rect[] }) => setGesture((cur) => (cur?.kind === "markup" && cur.from === from ? { ...cur, rects: sel.rects } : cur)))
        .finally(() => (pending.current = false));
    }
  };

  const onUp = (e: React.PointerEvent) => {
    const g = gesture;
    if (!g) return;
    setGesture(null);
    const p = pagePoint(e);
    const moved = (d: Point) => Math.hypot(d[0], d[1]) * tab.zoom >= DRAG_THRESHOLD;
    const sel = { tabId: tab.id, page, id: g.kind === "move" || g.kind === "resize" ? g.annot.id : 0 };
    if (g.kind === "move") {
      if (moved(g.delta)) void moveAnnot(sel, g.delta[0], g.delta[1]);
    } else if (g.kind === "resize") {
      if (moved(g.delta)) void resizeAnnot(sel, resizeBox(g.annot.box ?? g.annot.rect, g.delta, g.annot.kind === "stamp"));
    } else if (g.kind === "markup") {
      if (moved([p[0] - g.from[0], p[1] - g.from[1]])) void addAnnot(tab.id, page, { kind: markup.kind, from: g.from, to: p, color: markup.colors[markup.kind] });
    } else {
      const points = draw.shape === "pen" ? [...g.points, p] : [g.points[0], p];
      const spec = drawSpec(draw, points, minSize);
      if (spec) void addAnnot(tab.id, page, spec);
    }
  };

  // Frame of the selected annotation, following an in-progress move/resize.
  let frame: Rect | null = null;
  if (current) {
    const g = gesture?.kind === "move" || gesture?.kind === "resize" ? gesture : null;
    const pageRect =
      g?.kind === "move" ? shiftRect(current.rect, g.delta) : g?.kind === "resize" ? resizeBox(current.box ?? current.rect, g.delta, current.kind === "stamp") : current.rect;
    frame = transform.rectToDisplay(pageRect);
  }

  const creating = tool === "comment" || tool === "markup" || tool === "draw" || tool === "sign";
  const stroke = gesture?.kind === "stroke" ? gesture.points : null;
  const strokeStyle = { stroke: cssColor(draw.color), strokeWidth: draw.width * tab.zoom, fill: "none" };
  const ghost = tool === "sign" && hover && signature ? transform.rectToDisplay(fitSignature(hover, SIGNATURE_WIDTH, signature.width / signature.height)) : null;

  return (
    <div ref={layer} className={`annot-layer tool-${tool}`} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setHover(null)}>
      <svg className="annot-svg" width={transform.width} height={transform.height}>
        {tool === "select" && annots.map((a) => <AnnotHit key={a.id} annot={a} transform={transform} onPointerDown={onAnnotDown(a, "move")} />)}
        {frame && <rect className="annot-frame" x={frame[0]} y={frame[1]} width={frame[2] - frame[0]} height={frame[3] - frame[1]} />}
        {gesture?.kind === "markup" &&
          gesture.rects.map((r, i) => {
            const [x0, y0, x1, y1] = transform.rectToDisplay(r);
            return <rect key={i} x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={cssColor(markup.colors[markup.kind], 0.35)} />;
          })}
        {stroke && draw.shape === "pen" && <polyline points={pointsAttr(stroke, transform)} style={strokeStyle} />}
        {stroke && (draw.shape === "line" || draw.shape === "arrow") && <polyline points={pointsAttr([stroke[0], stroke[stroke.length - 1]], transform)} style={strokeStyle} />}
        {stroke &&
          (draw.shape === "rect" || draw.shape === "oval") &&
          (() => {
            const [x0, y0, x1, y1] = transform.rectToDisplay(dragRect(stroke[0], stroke[stroke.length - 1]));
            return draw.shape === "rect" ? (
              <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} style={strokeStyle} />
            ) : (
              <ellipse cx={(x0 + x1) / 2} cy={(y0 + y1) / 2} rx={(x1 - x0) / 2} ry={(y1 - y0) / 2} style={strokeStyle} />
            );
          })()}
      </svg>
      {creating && <div className="annot-capture" onPointerDown={onCaptureDown} />}
      {ghost && signature && <img className="signature-ghost" src={signature.png} alt="" style={{ left: ghost[0], top: ghost[1], width: ghost[2] - ghost[0], height: ghost[3] - ghost[1] }} />}
      {current && frame && tool === "select" && current.resizable && (
        <div className="edit-handle annot-handle" style={{ left: frame[2] - 6, top: frame[3] - 6 }} onPointerDown={onAnnotDown(current, "resize")} />
      )}
      {current && frame && tool === "select" && !gesture && <AnnotCard annot={current} tab={tab} anchor={frame} pageWidth={transform.width} />}
    </div>
  );
}
