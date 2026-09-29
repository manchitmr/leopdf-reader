import { useEffect, useState } from "react";
import { getEngine } from "../engine/client";
import type { Annot } from "../edit/types";
import { useT } from "../i18n/useT";
import { appStore, useApp, type DocTab } from "../state/store";
import { KIND_ICON, KIND_LABEL } from "./annot-labels";

/** Every comment and markup in the document, grouped by page (Acrobat's Comments pane). */
export function CommentsPanel({ tab }: { tab: DocTab }) {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const author = useApp((s) => s.author);
  const [annots, setAnnots] = useState<Annot[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getEngine()
      .listAnnotations(tab.id)
      .then((list: Annot[]) => !cancelled && setAnnots(list));
    return () => {
      cancelled = true;
    };
  }, [tab.id, tab.revision]);

  const open = (a: Annot) => {
    const s = appStore.getState();
    s.goToPage(tab.id, a.page);
    s.setTool("select");
    s.selectAnnot({ tabId: tab.id, page: a.page, id: a.id });
  };
  const pages = [...new Set((annots ?? []).map((a) => a.page))].sort((a, b) => a - b);

  return (
    <div className="panel comments">
      <label className="comments-name">
        {t("yourName")}
        <input value={author ?? ""} onChange={(e) => appStore.getState().setAuthor(e.target.value)} />
      </label>
      {annots?.length === 0 && <p className="muted panel-empty">{t("noComments")}</p>}
      {pages.map((page) => (
        <section key={page}>
          <h3 className="comments-page">{t("pageLabel", { label: tab.info!.pages[page].label })}</h3>
          <ul className="comments-list">
            {annots!
              .filter((a) => a.page === page)
              .map((a) => {
                const Icon = KIND_ICON[a.kind];
                return (
                  <li key={a.id}>
                    <button className="comment-item" onClick={() => open(a)}>
                      <Icon size={14} aria-hidden />
                      <span className="comment-body">
                        <span className="comment-meta muted">
                          {a.author || t("unknownAuthor")}
                          {a.modified ? ` · ${new Date(a.modified).toLocaleDateString(lang)}` : ""}
                        </span>
                        <span className="comment-text">{a.contents || t(KIND_LABEL[a.kind])}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}
