import { Crop, FilePlus2, FileStack, RotateCcw, RotateCw, Scissors, SquarePlus, Trash2, FileOutput } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  cropPages, deletePages, extractToFile, insertBlankPage, insertFromFiles, movePages, rotatePages, splitToFiles,
} from "../app/organize-actions";
import type { Margins } from "../edit/pages";
import { useT } from "../i18n/useT";
import { appStore, type DocTab } from "../state/store";
import { pageTransform } from "./geometry";
import { PageCanvas } from "./PageCanvas";

const THUMB = 150;

/** One page in the grid; its canvas exists only while it is (nearly) on screen. */
function OrganizeThumb({ tab, page, selected, dropBefore, onPointer, onDragStart, onDragOver }: {
  tab: DocTab;
  page: number;
  selected: boolean;
  dropBefore: boolean;
  onPointer(e: React.MouseEvent): void;
  onDragStart(e: React.DragEvent): void;
  onDragOver(e: React.DragEvent): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const bounds = tab.info!.pages[page].bounds;
  const zoom = THUMB / Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]);
  const t = pageTransform(bounds, zoom, 0);
  useEffect(() => {
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "300px" });
    io.observe(ref.current!);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`organize-thumb ${selected ? "selected" : ""} ${dropBefore ? "drop-before" : ""}`}
      role="option"
      aria-selected={selected}
      draggable
      onClick={onPointer}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
    >
      <div className="organize-page" style={{ width: t.width, height: t.height }}>
        {visible && <PageCanvas docId={tab.id} page={page} bounds={bounds} zoom={zoom} rotation={0} width={t.width} height={t.height} revision={tab.revision} />}
      </div>
      <span>{page + 1}</span>
    </div>
  );
}

type Dialog = null | "split" | "crop";

/** Organize Pages: every page as a thumbnail; select, reorder by dragging, and turn, delete, insert, extract, split, crop. */
export function OrganizeView({ tab }: { tab: DocTab }) {
  const t = useT();
  const count = tab.info!.pageCount;
  const [selected, setSelected] = useState<number[]>([]);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const dragging = useRef<number[] | null>(null);

  // Keep the selection valid when the page list changes (undo, deletes).
  useEffect(() => setSelected((s) => s.filter((p) => p < count)), [count]);

  const pick = (pages: number[] | null) => pages && setSelected(pages);
  const targets = selected.length ? selected : [];
  const insertAt = selected.length ? Math.max(...selected) + 1 : count;

  const onPointer = (page: number) => (e: React.MouseEvent) => {
    if (e.shiftKey && anchor !== null) {
      const [a, b] = [Math.min(anchor, page), Math.max(anchor, page)];
      setSelected(Array.from({ length: b - a + 1 }, (_, i) => a + i));
    } else if (e.metaKey || e.ctrlKey) {
      setSelected((s) => (s.includes(page) ? s.filter((p) => p !== page) : [...s, page]));
      setAnchor(page);
    } else {
      setSelected([page]);
      setAnchor(page);
    }
  };

  const onDragStart = (page: number) => (e: React.DragEvent) => {
    const moving = selected.includes(page) ? selected : [page];
    if (!selected.includes(page)) setSelected([page]);
    dragging.current = moving;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", moving.join(","));
  };
  const onDragOver = (page: number) => (e: React.DragEvent) => {
    if (!dragging.current) return;
    e.preventDefault();
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropAt(e.clientX < box.left + box.width / 2 ? page : page + 1);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const moving = dragging.current;
    dragging.current = null;
    const before = dropAt;
    setDropAt(null);
    if (moving && before !== null) void movePages(tab.id, moving, before).then(pick);
  };

  const remove = () => targets.length && void deletePages(tab.id, targets).then(pick);
  const rotate = (deg: number) => targets.length && void rotatePages(tab.id, targets, deg).then(pick);

  // Keyboard: Delete removes, Ctrl/⌘+A selects all, Escape leaves the view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element | null)?.closest?.("input, textarea, select") || dialog) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(Array.from({ length: count }, (_, i) => i));
      } else if (e.key === "Escape") appStore.getState().setOrganizing(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const button = (label: string, icon: React.ReactNode, onClick: () => void, disabled = false) => (
    <button className="icon-button" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {icon}
    </button>
  );

  return (
    <div className="organize">
      <div className="editbar" role="toolbar" aria-label={t("organizePages")}>
        {button(t("rotateLeft"), <RotateCcw size={18} />, () => rotate(-90), !targets.length)}
        {button(t("rotateRight"), <RotateCw size={18} />, () => rotate(90), !targets.length)}
        {button(t("deletePagesLabel"), <Trash2 size={18} />, remove, !targets.length)}
        <div className="separator" />
        {button(t("insertBlank"), <SquarePlus size={18} />, () => void insertBlankPage(tab.id, insertAt).then(pick))}
        {button(t("insertFromFile"), <FilePlus2 size={18} />, () => void insertFromFiles(tab.id, insertAt).then(pick))}
        {button(t("combineFiles"), <FileStack size={18} />, () => void insertFromFiles(tab.id, -1).then(pick))}
        <div className="separator" />
        {button(t("extractPagesLabel"), <FileOutput size={18} />, () => void extractToFile(tab.id, targets), !targets.length)}
        {button(t("splitDocument"), <Scissors size={18} />, () => setDialog("split"), count < 2)}
        {button(t("cropPagesLabel"), <Crop size={18} />, () => setDialog("crop"))}
        <div className="spacer" />
        <span className="muted">{selected.length ? t("pagesSelected", { count: selected.length }) : t("organizeHint")}</span>
        <button className="primary-button" onClick={() => appStore.getState().setOrganizing(false)}>
          {t("done")}
        </button>
      </div>
      <div className="organize-grid" role="listbox" aria-multiselectable aria-label={t("organizePages")} onDrop={onDrop} onDragOver={(e) => e.preventDefault()} onDragEnd={() => setDropAt(null)}>
        {Array.from({ length: count }, (_, page) => (
          <OrganizeThumb
            key={page}
            tab={tab}
            page={page}
            selected={selected.includes(page)}
            dropBefore={dropAt === page}
            onPointer={onPointer(page)}
            onDragStart={onDragStart(page)}
            onDragOver={onDragOver(page)}
          />
        ))}
        {dropAt === count && <div className="drop-end" />}
      </div>
      {dialog === "split" && <SplitDialog count={count} onCancel={() => setDialog(null)} onSplit={(size) => (setDialog(null), void splitToFiles(tab.id, size))} />}
      {dialog === "crop" && (
        <CropDialog
          hasSelection={targets.length > 0}
          onCancel={() => setDialog(null)}
          onCrop={(margins, all) => {
            setDialog(null);
            void cropPages(tab.id, all ? Array.from({ length: count }, (_, i) => i) : targets, margins).then(pick);
          }}
        />
      )}
    </div>
  );
}

function SplitDialog({ count, onCancel, onSplit }: { count: number; onCancel(): void; onSplit(size: number): void }) {
  const t = useT();
  const [size, setSize] = useState(1);
  const valid = Number.isInteger(size) && size >= 1 && size < count;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t("splitTitle")}>
      <div className="doc-message">
        <h2>{t("splitTitle")}</h2>
        <label className="field-row">
          {t("splitEvery")}
          <input type="number" min={1} max={count - 1} value={size} onChange={(e) => setSize(Number(e.target.value))} autoFocus />
        </label>
        {valid && <p className="muted">{t("splitResult", { count: Math.ceil(count / size) })}</p>}
        <div className="form-actions">
          <button onClick={onCancel}>{t("cancel")}</button>
          <button className="primary-button" disabled={!valid} onClick={() => onSplit(size)}>
            {t("splitDocument").replace("…", "")}
          </button>
        </div>
      </div>
    </div>
  );
}

function CropDialog({ hasSelection, onCancel, onCrop }: { hasSelection: boolean; onCancel(): void; onCrop(margins: Margins, all: boolean): void }) {
  const t = useT();
  const [margins, setMargins] = useState<Margins>({ top: 10, right: 10, bottom: 10, left: 10 });
  const [all, setAll] = useState(!hasSelection);
  const sides: [keyof Margins, string][] = [["top", t("marginTop")], ["right", t("marginRight")], ["bottom", t("marginBottom")], ["left", t("marginLeft")]];
  const valid = sides.every(([k]) => Number.isFinite(margins[k]) && margins[k] >= 0);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t("cropTitle")}>
      <div className="doc-message">
        <h2>{t("cropTitle")}</h2>
        <div className="crop-grid">
          {sides.map(([key, label]) => (
            <label key={key} className="field-row">
              {label}
              <input type="number" min={0} step={1} value={margins[key]} onChange={(e) => setMargins({ ...margins, [key]: Number(e.target.value) })} />
            </label>
          ))}
        </div>
        <div className="segmented" role="radiogroup">
          <button role="radio" aria-checked={!all} className={!all ? "pressed" : ""} disabled={!hasSelection} onClick={() => setAll(false)}>
            {t("applyToSelected")}
          </button>
          <button role="radio" aria-checked={all} className={all ? "pressed" : ""} onClick={() => setAll(true)}>
            {t("applyToAll")}
          </button>
        </div>
        <div className="form-actions">
          <button onClick={onCancel}>{t("cancel")}</button>
          <button className="primary-button" disabled={!valid} onClick={() => onCrop(margins, all)}>
            {t("apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
