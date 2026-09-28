import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { appStore, useApp, type DocTab } from "../state/store";
import { PADDING, computeLayout, fitZoom, pageAtOffset, visibleSlots } from "./layout";
import { PageSlot } from "./PageSlot";

export function PageView({ tab }: { tab: DocTab }) {
  const ref = useRef<HTMLDivElement>(null);
  const tool = useApp((s) => s.tool);
  const [viewport, setViewport] = useState({ width: 0, height: 0, top: 0 });
  const info = tab.info!;
  // In continuous/two modes the layout does not depend on the current page.
  const layoutPage = tab.viewMode === "single" ? tab.currentPage : -1;
  const layout = useMemo(
    () => computeLayout(info.pages, tab.zoom, tab.rotation, tab.viewMode, Math.max(0, layoutPage)),
    [info.pages, tab.zoom, tab.rotation, tab.viewMode, layoutPage],
  );

  // Track viewport size.
  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setViewport((v) => ({ ...v, width: el.clientWidth, height: el.clientHeight })));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit width / fit page.
  useEffect(() => {
    if (!tab.fit || viewport.width === 0) return;
    const z = fitZoom(info.pages[tab.currentPage].bounds, tab.rotation, tab.viewMode, viewport, tab.fit);
    if (Math.abs(z - tab.zoom) > 0.001) appStore.getState().applyFitZoom(tab.id, z);
    // Only refit when the fit mode, viewport or page geometry changes — not on every page change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.fit, viewport.width, viewport.height, tab.rotation, tab.viewMode]);

  // Keep the same relative scroll position when the layout grows or shrinks (zoom, rotate).
  const lastHeight = useRef(layout.height);
  useLayoutEffect(() => {
    const el = ref.current!;
    if (lastHeight.current !== layout.height && lastHeight.current > 0) {
      el.scrollTop = (el.scrollTop / lastHeight.current) * layout.height;
    }
    lastHeight.current = layout.height;
  }, [layout.height]);

  // Navigation requests (thumbnails, search, page input).
  useLayoutEffect(() => {
    const request = tab.scrollRequest;
    if (!request || tab.viewMode === "single") return;
    const slot = layout.slots.find((s) => s.page === request.page);
    if (slot) ref.current!.scrollTop = slot.y - PADDING;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.scrollRequest?.nonce]);

  // Ctrl/⌘ + wheel zoom (non-passive so we can prevent page zoom).
  useEffect(() => {
    const el = ref.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const current = appStore.getState().tabs.find((t) => t.id === tab.id);
      if (current) appStore.getState().setZoom(tab.id, current.zoom * Math.exp(-e.deltaY * 0.01));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [tab.id]);

  const onScroll = () => {
    const el = ref.current!;
    setViewport((v) => ({ ...v, top: el.scrollTop }));
    if (tab.viewMode === "single") return;
    const page = pageAtOffset(layout, el.scrollTop + el.clientHeight / 3);
    if (page !== tab.currentPage) appStore.getState().setCurrentPage(tab.id, page);
  };

  // Hand tool: drag to scroll.
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (tool !== "hand") return;
    const el = ref.current!;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const el = ref.current!;
    el.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
    el.scrollTop = drag.current.top - (e.clientY - drag.current.y);
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const visible = visibleSlots(layout, viewport.top, viewport.height || 1000);

  return (
    <div
      ref={ref}
      className={`page-view tool-${tool}`}
      onScroll={onScroll}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="page-layer" style={{ width: Math.max(layout.width, viewport.width), height: layout.height }}>
        <div className="page-layer-inner" style={{ width: layout.width, height: layout.height }}>
          {visible.map((slot) => (
            <PageSlot key={slot.page} tab={tab} slot={slot} />
          ))}
        </div>
      </div>
    </div>
  );
}
