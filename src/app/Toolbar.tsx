import {
  ChevronLeft, ChevronRight, FolderOpen, Hand, Monitor, Moon, Printer, RotateCw, Search, Sun, TextCursor, ZoomIn, ZoomOut,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { LANGUAGES, type Lang } from "../i18n/strings";
import { useT } from "../i18n/useT";
import { pickPdfs } from "../platform/sources";
import { activeTab, useApp, type Theme, type ViewMode } from "../state/store";
import { openSource } from "./open-document";

function IconButton(props: { label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; children: ReactNode }) {
  return (
    <button
      className={`icon-button ${props.pressed ? "pressed" : ""}`}
      aria-label={props.label}
      aria-pressed={props.pressed}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export async function openFromPicker() {
  for (const src of await pickPdfs()) void openSource(src);
}

const ZOOM_PRESETS = [50, 75, 100, 125, 150, 200, 300, 400];
const THEME_ICON: Record<Theme, ReactNode> = { system: <Monitor size={18} />, light: <Sun size={18} />, dark: <Moon size={18} /> };
const THEME_LABEL = { system: "themeSystem", light: "themeLight", dark: "themeDark" } as const;
const NEXT_THEME: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

export function Toolbar({ onPrint }: { onPrint: () => void }) {
  const t = useT();
  const tab = useApp(activeTab);
  const s = useApp((st) => st);
  const ready = tab?.status === "ready" && tab.info !== null;
  const pageCount = tab?.info?.pageCount ?? 0;
  const [pageInput, setPageInput] = useState("");

  useEffect(() => setPageInput(tab ? String(tab.currentPage + 1) : ""), [tab?.currentPage, tab?.id]);

  const zoomValue = !tab ? "" : (tab.fit ?? String(Math.round(tab.zoom * 100)));

  return (
    <div className="toolbar">
      <IconButton label={t("openFile")} onClick={() => void openFromPicker()}>
        <FolderOpen size={18} />
      </IconButton>
      <IconButton label={t("print")} onClick={onPrint} disabled={!ready}>
        <Printer size={18} />
      </IconButton>
      <div className="separator" />

      <IconButton label={t("prevPage")} disabled={!ready || tab.currentPage === 0} onClick={() => s.goToPage(tab!.id, tab!.currentPage - 1)}>
        <ChevronLeft size={18} />
      </IconButton>
      <input
        className="page-input"
        aria-label={t("pageOf", { current: pageInput, total: pageCount })}
        disabled={!ready}
        value={pageInput}
        onChange={(e) => setPageInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && tab) s.goToPage(tab.id, Number(pageInput) - 1);
        }}
        onBlur={() => setPageInput(tab ? String(tab.currentPage + 1) : "")}
      />
      <span className="muted">/ {pageCount || "–"}</span>
      <IconButton label={t("nextPage")} disabled={!ready || tab.currentPage >= pageCount - 1} onClick={() => s.goToPage(tab!.id, tab!.currentPage + 1)}>
        <ChevronRight size={18} />
      </IconButton>
      <div className="separator" />

      <IconButton label={t("zoomOut")} disabled={!ready} onClick={() => s.zoomBy(tab!.id, -1)}>
        <ZoomOut size={18} />
      </IconButton>
      <select
        className="zoom-select"
        aria-label={t("zoomIn")}
        disabled={!ready}
        value={zoomValue}
        onChange={(e) => {
          if (!tab) return;
          const v = e.target.value;
          if (v === "width" || v === "page") s.setFit(tab.id, v);
          else s.setZoom(tab.id, Number(v) / 100);
        }}
      >
        {tab && !tab.fit && !ZOOM_PRESETS.includes(Math.round(tab.zoom * 100)) && <option value={zoomValue}>{zoomValue}%</option>}
        <option value="width">{t("fitWidth")}</option>
        <option value="page">{t("fitPage")}</option>
        {ZOOM_PRESETS.map((z) => (
          <option key={z} value={String(z)}>
            {z}%
          </option>
        ))}
      </select>
      <IconButton label={t("zoomIn")} disabled={!ready} onClick={() => s.zoomBy(tab!.id, 1)}>
        <ZoomIn size={18} />
      </IconButton>
      <IconButton label={t("rotate")} disabled={!ready} onClick={() => s.rotate(tab!.id)}>
        <RotateCw size={18} />
      </IconButton>
      <select
        aria-label={t("viewMode")}
        title={t("viewMode")}
        disabled={!ready}
        value={tab?.viewMode ?? "continuous"}
        onChange={(e) => tab && s.setViewMode(tab.id, e.target.value as ViewMode)}
      >
        <option value="continuous">{t("viewContinuous")}</option>
        <option value="single">{t("viewSingle")}</option>
        <option value="two">{t("viewTwo")}</option>
      </select>
      <div className="separator" />

      <IconButton label={t("toolSelect")} pressed={s.tool === "select"} onClick={() => s.setTool("select")}>
        <TextCursor size={18} />
      </IconButton>
      <IconButton label={t("toolHand")} pressed={s.tool === "hand"} onClick={() => s.setTool("hand")}>
        <Hand size={18} />
      </IconButton>

      <div className="spacer" />
      <IconButton label={t("find")} disabled={!ready} pressed={s.searchOpen} onClick={() => s.setSearchOpen(!s.searchOpen)}>
        <Search size={18} />
      </IconButton>
      <IconButton label={`${t("theme")}: ${t(THEME_LABEL[s.theme])}`} onClick={() => s.setTheme(NEXT_THEME[s.theme])}>
        {THEME_ICON[s.theme]}
      </IconButton>
      <select aria-label={t("language")} title={t("language")} value={s.lang} onChange={(e) => s.setLang(e.target.value as Lang)}>
        {(Object.keys(LANGUAGES) as Lang[]).map((l) => (
          <option key={l} value={l}>
            {LANGUAGES[l].label}
          </option>
        ))}
      </select>
    </div>
  );
}
