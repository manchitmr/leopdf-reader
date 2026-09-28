import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getEngine } from "../engine/client";
import type { SearchHit } from "../engine/types";
import { useT } from "../i18n/useT";
import { appStore, getTab, type DocTab } from "../state/store";
import { runChunkedSearch } from "./search-runner";

/** Resolves to the hits, or null if the search was superseded or cancelled. */
type RunSearch = (docId: string, query: string) => Promise<SearchHit[] | null>;

const engineSearch: RunSearch = (docId, query) => {
  const pageCount = getTab(appStore.getState(), docId)?.info?.pageCount ?? 0;
  const isCurrent = () => {
    const tab = getTab(appStore.getState(), docId);
    return tab !== undefined && tab.search.running && tab.search.query === query;
  };
  return runChunkedSearch(docId, query, pageCount, (id, q, from, to) => getEngine().search(id, q, from, to), isCurrent);
};

export function SearchBar({ tab, runSearch = engineSearch }: { tab: DocTab; runSearch?: RunSearch }) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(tab.search.query);
  const s = appStore.getState();
  const { hits, active, running, query } = tab.search;

  useEffect(() => inputRef.current?.select(), []);

  const submit = async (direction: 1 | -1) => {
    if (text === query && hits.length > 0) {
      s.stepSearch(tab.id, direction);
      return;
    }
    if (!text.trim()) {
      s.clearSearch(tab.id);
      return;
    }
    s.startSearch(tab.id, text);
    let results: SearchHit[] | null;
    try {
      results = await runSearch(tab.id, text);
    } catch {
      results = [];
    }
    if (results) appStore.getState().setSearchResults(tab.id, text, results);
  };

  const close = () => {
    s.clearSearch(tab.id);
    s.setSearchOpen(false);
  };

  let status = "";
  if (running) status = t("searching");
  else if (query && hits.length === 0) status = t("searchNone");
  else if (hits.length > 0) status = t("searchResults", { index: active + 1, count: hits.length });

  return (
    <div className="search-bar" role="search">
      <input
        ref={inputRef}
        value={text}
        placeholder={t("searchPlaceholder")}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit(e.shiftKey ? -1 : 1);
          if (e.key === "Escape") close();
        }}
      />
      <span className="muted search-status" aria-live="polite">
        {status}
      </span>
      <button className="icon-button" aria-label={t("prevPage")} disabled={hits.length === 0} onClick={() => s.stepSearch(tab.id, -1)}>
        <ChevronUp size={16} />
      </button>
      <button className="icon-button" aria-label={t("nextPage")} disabled={hits.length === 0} onClick={() => s.stepSearch(tab.id, 1)}>
        <ChevronDown size={16} />
      </button>
      <button className="icon-button" aria-label={t("closeTab")} onClick={close}>
        <X size={16} />
      </button>
    </div>
  );
}
