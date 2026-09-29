import { Bookmark, ChevronDown, ChevronRight, LayoutGrid, MessageSquare, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { OutlineNode } from "../engine/types";
import { useT } from "../i18n/useT";
import { appStore, useApp, type DocTab } from "../state/store";
import { pageTransform } from "../viewer/geometry";
import { PageCanvas } from "../viewer/PageCanvas";
import { BookmarksPanel } from "./BookmarksPanel";
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

/** Rename/delete support for the Bookmarks panel; without it the tree is read-only. */
export interface OutlineEditing {
  /** Path key ("0.2") of the bookmark whose name is being edited. */
  editing: string | null;
  onEdit(key: string | null): void;
  onRename(path: number[], title: string): void;
  onDelete(path: number[]): void;
}

export function OutlineTree({ nodes, onSelect, edit }: { nodes: OutlineNode[]; onSelect: (page: number) => void; edit?: OutlineEditing }) {
  return (
    <ul className="outline">
      {nodes.map((node, i) => (
        <OutlineItem key={i} node={node} onSelect={onSelect} edit={edit} />
      ))}
    </ul>
  );
}

function RenameInput({ node, edit }: { node: OutlineNode; edit: OutlineEditing }) {
  const t = useT();
  const [value, setValue] = useState(node.title);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const title = value.trim();
    if (save && title && title !== node.title) edit.onRename(node.path, title);
    edit.onEdit(null);
  };
  return (
    <input
      className="outline-rename"
      autoFocus
      aria-label={t("renameBookmark")}
      value={value}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
    />
  );
}

function OutlineItem({ node, onSelect, edit }: { node: OutlineNode; onSelect: (page: number) => void; edit?: OutlineEditing }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const renaming = edit?.editing === node.path.join(".");
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
        {renaming && edit ? (
          <RenameInput node={node} edit={edit} />
        ) : (
          <button
            className="outline-title"
            onClick={() => node.page !== null && onSelect(node.page)}
            onDoubleClick={() => edit?.onEdit(node.path.join("."))}
            disabled={node.page === null && !edit}
          >
            {node.title}
          </button>
        )}
        {edit && !renaming && (
          <button className="icon-button small outline-delete" aria-label={t("deleteBookmark")} title={t("deleteBookmark")} onClick={() => edit.onDelete(node.path)}>
            <Trash2 size={12} />
          </button>
        )}
      </div>
      {open && <OutlineTree nodes={node.children} onSelect={onSelect} edit={edit} />}
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
      {panel === "bookmarks" && <BookmarksPanel tab={tab} />}
      {panel === "comments" && <CommentsPanel tab={tab} />}
    </div>
  );
}
