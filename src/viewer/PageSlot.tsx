import { useMemo } from "react";
import type { DocTab } from "../state/store";
import { pageTransform } from "./geometry";
import type { Slot } from "./layout";
import { PageCanvas } from "./PageCanvas";

export function PageSlot({ tab, slot }: { tab: DocTab; slot: Slot }) {
  const bounds = tab.info!.pages[slot.page].bounds;
  const transform = useMemo(() => pageTransform(bounds, tab.zoom, tab.rotation), [bounds, tab.zoom, tab.rotation]);
  const hits = tab.search.hits;
  const activeHit = hits[tab.search.active];
  const pageHits = hits.filter((h) => h.page === slot.page);
  return (
    <div className="page-slot" data-page={slot.page} style={{ left: slot.x, top: slot.y, width: slot.width, height: slot.height }}>
      <PageCanvas docId={tab.id} page={slot.page} bounds={bounds} zoom={tab.zoom} rotation={tab.rotation} width={transform.width} height={transform.height} />
      <div className="page-overlay">
        {pageHits.flatMap((hit, i) =>
          hit.rects.map((r, j) => {
            const [x0, y0, x1, y1] = transform.rectToDisplay(r);
            return <div key={`h${i}-${j}`} className={`hit ${hit === activeHit ? "active" : ""}`} style={{ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }} />;
          }),
        )}
      </div>
    </div>
  );
}
