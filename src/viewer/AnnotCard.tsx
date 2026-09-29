import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { deleteSelectedAnnot, updateAnnot } from "../app/annot-actions";
import { DRAW_KINDS, KIND_LABEL, MARKUP_KINDS } from "../app/annot-labels";
import { Swatches } from "../app/Swatches";
import type { Annot } from "../edit/types";
import type { Rect } from "../engine/types";
import { useT } from "../i18n/useT";
import { DRAW_COLORS, MARKUP_COLORS } from "../state/palette";
import { appStore, useApp, type DocTab } from "../state/store";

const CARD_WIDTH = 240;

/** Comment box for the selected annotation: author/date, comment text, colour, delete. */
export function AnnotCard({ annot, tab, anchor, pageWidth }: { annot: Annot; tab: DocTab; anchor: Rect; pageWidth: number }) {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const focus = useApp((s) => s.focusComment);
  const [text, setText] = useState(annot.contents);
  const saved = useRef(annot.contents);
  const latest = useRef(text);
  latest.current = text;
  const box = useRef<HTMLTextAreaElement>(null);
  const sel = { tabId: tab.id, page: annot.page, id: annot.id };

  useEffect(() => {
    setText(annot.contents);
    saved.current = annot.contents;
  }, [annot.id, annot.contents]);
  useEffect(() => {
    if (focus) box.current?.focus();
  }, [focus, annot.id]);

  const commit = () => {
    if (latest.current === saved.current) return;
    saved.current = latest.current;
    void updateAnnot(sel, { contents: latest.current });
  };
  // Clicking elsewhere can unmount the card before the textarea's blur fires: save then.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => commit, [annot.id]);

  const colors = MARKUP_KINDS.has(annot.kind) ? MARKUP_COLORS : DRAW_KINDS.has(annot.kind) ? DRAW_COLORS : null;
  const left = anchor[2] + 8 + CARD_WIDTH <= pageWidth ? anchor[2] + 8 : Math.max(0, anchor[0] - CARD_WIDTH - 8);
  const when = annot.modified ? ` · ${new Date(annot.modified).toLocaleString(lang)}` : "";

  return (
    <div className="annot-card" style={{ left, top: anchor[1], width: CARD_WIDTH }} role="dialog" aria-label={t(KIND_LABEL[annot.kind])} onPointerDown={(e) => e.stopPropagation()}>
      <div className="annot-card-head">
        <strong>{t(KIND_LABEL[annot.kind])}</strong>
        <span className="muted">
          {annot.author || t("unknownAuthor")}
          {when}
        </span>
      </div>
      <textarea
        ref={box}
        value={text}
        rows={3}
        placeholder={t("commentPlaceholder")}
        aria-label={t("commentPlaceholder")}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") appStore.getState().selectAnnot(null);
        }}
      />
      <div className="annot-card-actions">
        {colors && <Swatches colors={colors} value={annot.color} onPick={(color) => void updateAnnot(sel, { color })} />}
        <div className="spacer" />
        <button
          className="icon-button"
          aria-label={t("deleteItem")}
          title={t("deleteItem")}
          onClick={() => {
            saved.current = latest.current; // nothing to save for an annotation being deleted
            void deleteSelectedAnnot();
          }}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}
