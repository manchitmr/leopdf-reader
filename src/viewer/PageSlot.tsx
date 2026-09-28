import { useMemo } from "react";
import type { DocTab } from "../state/store";
import { pageTransform } from "./geometry";
import type { Slot } from "./layout";
import { PageCanvas } from "./PageCanvas";

export function PageSlot({ tab, slot }: { tab: DocTab; slot: Slot }) {
  const bounds = tab.info!.pages[slot.page].bounds;
  const transform = useMemo(() => pageTransform(bounds, tab.zoom, tab.rotation), [bounds, tab.zoom, tab.rotation]);
  return (
    <div className="page-slot" data-page={slot.page} style={{ left: slot.x, top: slot.y, width: slot.width, height: slot.height }}>
      <PageCanvas docId={tab.id} page={slot.page} bounds={bounds} zoom={tab.zoom} rotation={tab.rotation} width={transform.width} height={transform.height} />
    </div>
  );
}
