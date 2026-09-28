import { useMemo, useRef } from "react";
import { getEngine } from "../engine/client";
import type { Point } from "../engine/types";
import { appStore, useApp, type DocTab } from "../state/store";
import { EditLayer } from "./EditLayer";
import { pageTransform } from "./geometry";
import type { Slot } from "./layout";
import { PageCanvas } from "./PageCanvas";

export function PageSlot({ tab, slot }: { tab: DocTab; slot: Slot }) {
  const bounds = tab.info!.pages[slot.page].bounds;
  const transform = useMemo(() => pageTransform(bounds, tab.zoom, tab.rotation), [bounds, tab.zoom, tab.rotation]);
  const tool = useApp((s) => s.tool);
  const editMode = useApp((s) => s.editMode);
  const start = useRef<Point | null>(null);
  const pending = useRef(false);

  const pagePoint = (e: React.PointerEvent): Point => {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return transform.toPage([e.clientX - box.left, e.clientY - box.top]);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (tool !== "select" || e.button !== 0) return;
    start.current = pagePoint(e);
    appStore.getState().setSelection(tab.id, null);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current || pending.current) return;
    const from = start.current;
    const to = pagePoint(e);
    pending.current = true;
    void getEngine()
      .select(tab.id, slot.page, from, to)
      .then((sel) => appStore.getState().setSelection(tab.id, sel.text ? { page: slot.page, ...sel } : null))
      .finally(() => (pending.current = false));
  };
  const onPointerUp = () => {
    start.current = null;
  };

  const hits = tab.search.hits;
  const activeHit = hits[tab.search.active];
  const pageHits = hits.filter((h) => h.page === slot.page);
  const selection = tab.selection?.page === slot.page ? tab.selection : null;
  return (
    <div
      className="page-slot"
      data-page={slot.page}
      style={{ left: slot.x, top: slot.y, width: slot.width, height: slot.height }}
      onPointerDown={editMode ? undefined : onPointerDown}
      onPointerMove={editMode ? undefined : onPointerMove}
      onPointerUp={editMode ? undefined : onPointerUp}
    >
      <PageCanvas docId={tab.id} page={slot.page} bounds={bounds} zoom={tab.zoom} rotation={tab.rotation} width={transform.width} height={transform.height} revision={tab.revision} />
      <div className="page-overlay">
        {pageHits.flatMap((hit, i) =>
          hit.rects.map((r, j) => {
            const [x0, y0, x1, y1] = transform.rectToDisplay(r);
            return <div key={`h${i}-${j}`} className={`hit ${hit === activeHit ? "active" : ""}`} style={{ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }} />;
          }),
        )}
        {selection?.rects.map((r, i) => {
          const [x0, y0, x1, y1] = transform.rectToDisplay(r);
          return <div key={`s${i}`} className="selection" style={{ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }} />;
        })}
      </div>
      {editMode && <EditLayer tab={tab} page={slot.page} transform={transform} zoom={tab.zoom} />}
    </div>
  );
}
