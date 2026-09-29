import { Bookmark, ChevronDown, ChevronRight, LayoutGrid, MessageSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { OutlineNode } from "../engine/types";
import { useT } from "../i18n/useT";
import { appStore, useApp, type DocTab } from "../state/store";
import { pageTransform } from "../viewer/geometry";
import { PageCanvas } from "../viewer/PageCanvas";
import { CommentsPanel } from "./CommentsPanel";

const THUMB_WIDTH = 120;

/** One page thumbnail. Its canvas exists only while it is (nearly) on screen, to bound memory and worker load. */
export function Thumbnail({ tab, page }: { tab: DocTab; page: number }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const bounds = tab.info!.pages[page].bounds;
  const zoom = THUMB_WIDTH / (tab.rotation % 180 === 0 ? bounds[2] - bounds[0] : bounds[3] - bounds[1]);
  const t = pageTransform(bounds, zoom, tab.rotation);
  const active = tab.currentPage === page;

  useEffect(() => {
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "200px" });
    io.observe(ref.current!);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <button ref={ref} className={`thumb ${active ? "active" : ""}`} onClick={() => appStore.getState().goToPage(tab.id, page)}>
      <div className="thumb-page" style={{ width: t.width, height: t.height }}>
        {visible && <PageCanvas docId={tab.id} page={page} bounds={bounds} zoom={zoom} rotation={tab.rotation} width={t.width} height={t.height} revision={tab.revision} />}
      </div>
      <span>{tab.info!.pages[page].label}</span>
    </button>
  );
}

export function OutlineTree({ nodes, onSelect }: { nodes: OutlineNode[]; onSelect: (page: number) => void }) {
  return (
    <ul className="outline">
      {nodes.map((node, i) => (
        <OutlineItem key={i} node={node} onSelect={onSelect} />
      ))}
    </ul>
  );
}

function OutlineItem({ node, onSelect }: { node: OutlineNode; onSelect: (page: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <div className="outline-row">
        {node.children.length > 0 ? (
          <button className="icon-button small" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={node.title}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="outline-indent" />
        )}
        <button className="outline-title" onClick={() => node.page !== null && onSelect(node.page)} disabled={node.page === null}>
          {node.title}
        </button>
      </div>
      {open && <OutlineTree nodes={node.children} onSelect={onSelect} />}
    </li>
  );
}

export function LeftPanel({ tab }: { tab: DocTab }) {
  const t = useT();
  const panel = useApp((s) => s.leftPanel);
  const toggle = useApp((s) => s.toggleLeftPanel);
  return (
    <div className="left">
      <div className="rail">
        <button className={`icon-button ${panel === "thumbnails" ? "pressed" : ""}`} aria-label={t("thumbnails")} title={t("thumbnails")} onClick={() => toggle("thumbnails")}>
          <LayoutGrid size={18} />
        </button>
        <button className={`icon-button ${panel === "bookmarks" ? "pressed" : ""}`} aria-label={t("bookmarks")} title={t("bookmarks")} onClick={() => toggle("bookmarks")}>
          <Bookmark size={18} />
        </button>
        <button className={`icon-button ${panel === "comments" ? "pressed" : ""}`} aria-label={t("comments")} title={t("comments")} onClick={() => toggle("comments")}>
          <MessageSquare size={18} />
        </button>
      </div>
      {panel === "thumbnails" && (
        <div className="panel thumbs">
          {tab.info!.pages.map((_, i) => (
            <Thumbnail key={i} tab={tab} page={i} />
          ))}
        </div>
      )}
      {panel === "bookmarks" && (
        <div className="panel">
          {tab.info!.outline.length === 0 ? (
            <p className="muted panel-empty">{t("noBookmarks")}</p>
          ) : (
            <OutlineTree nodes={tab.info!.outline} onSelect={(page) => appStore.getState().goToPage(tab.id, page)} />
          )}
        </div>
      )}
      {panel === "comments" && <CommentsPanel tab={tab} />}
    </div>
  );
}
