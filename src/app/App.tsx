import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { convertToUnicode, quitHandler, requestQuit } from "./edit-actions";
import { EditBar } from "./EditBar";
import { onEngineCrash } from "../engine/client";
import { useT } from "../i18n/useT";
import { onNativeDrop, onOpenFiles } from "../platform/native";
import { saveAuthor, saveSignatures } from "../platform/prefs";
import { saveRecent } from "../platform/recent";
import { isPdfName, isTauri, sourceFromFile, sourceFromPath } from "../platform/sources";
import { activeTab, appStore, useApp } from "../state/store";
import { PageView } from "../viewer/PageView";
import { OrganizeView } from "../viewer/OrganizeView";
import { copySelection } from "./copy";
import { DocMessage } from "./DocMessage";
import { LeftPanel } from "./LeftPanel";
import { openSource, reopenAll } from "./open-document";
import { PasswordDialog } from "./PasswordDialog";
import { printDocument } from "./print";
import { SearchBar } from "./SearchBar";
import { TabBar } from "./TabBar";
import { TabErrorBoundary } from "./TabErrorBoundary";
import { Toolbar } from "./Toolbar";
import { ToolOptionsBar } from "./ToolOptionsBar";
import { ToolRail } from "./ToolRail";
import { AuthorDialog } from "./AuthorDialog";
import { SignatureDialog } from "../sign/SignatureDialog";
import { useShortcuts } from "./useShortcuts";
import { Welcome } from "./Welcome";

function usePersistedSettings() {
  useEffect(
    () =>
      appStore.subscribe((s, prev) => {
        try {
          if (s.lang !== prev.lang) localStorage.setItem("leopdf.lang", s.lang);
          if (s.theme !== prev.theme) localStorage.setItem("leopdf.theme", s.theme);
        } catch {
          // Storage unavailable: settings last for this session only.
        }
        if (s.recent !== prev.recent) saveRecent(s.recent);
        if (s.author !== prev.author && s.author !== null) saveAuthor(s.author);
        if (s.signatures !== prev.signatures && !saveSignatures(s.signatures)) s.showNotice("signatureNotSaved");
      }),
    [],
  );
}

function Notice() {
  const t = useT();
  const notice = useApp((s) => s.notice);
  const clear = useApp((s) => s.clearNotice);
  useEffect(() => {
    if (!notice || notice.key === "saving") return;
    const timer = setTimeout(clear, 2500);
    return () => clearTimeout(timer);
  }, [notice, clear]);
  return notice ? <div className="toast notice">{t(notice.key, notice.vars)}</div> : null;
}

/** Asks about unsaved changes before the window closes (Tauri) or the page unloads (browser). */
function useQuitGuard() {
  useEffect(() => {
    if (!isTauri()) {
      const onBeforeUnload = (e: BeforeUnloadEvent) => {
        if (appStore.getState().tabs.some((t) => t.dirty)) e.preventDefault();
      };
      window.addEventListener("beforeunload", onBeforeUnload);
      return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      quitHandler.quit = () => void win.destroy();
      void win
        .onCloseRequested((event) => {
          if (!requestQuit()) event.preventDefault();
        })
        .then((u) => (disposed ? u() : (unlisten = u)));
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}

export function App() {
  const t = useT();
  const tab = useApp(activeTab);
  const lang = useApp((s) => s.lang);
  const theme = useApp((s) => s.theme);
  const busy = useApp((s) => s.busy);
  const searchOpen = useApp((s) => s.searchOpen);
  const [engineNotice, setEngineNotice] = useState(false);
  /** Tabs whose "old fonts" banner was closed this session. */
  const [legacyDismissed, setLegacyDismissed] = useState<Set<string>>(new Set());
  usePersistedSettings();
  useQuitGuard();
  const editMode = useApp((s) => s.editMode);
  const organizing = useApp((s) => s.organizing);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dataset.theme = theme;
  }, [lang, theme]);

  useEffect(() => {
    const open = (paths: string[]) => paths.filter(isPdfName).forEach((p) => void openSource(sourceFromPath(p)));
    const cleanups: Array<() => void> = [];
    let disposed = false;
    const keep = (unlisten: () => void) => (disposed ? unlisten() : cleanups.push(unlisten));
    void onNativeDrop(open).then(keep);
    void onOpenFiles(open).then(keep);
    return () => {
      disposed = true;
      cleanups.forEach((u) => u());
    };
  }, []);

  useEffect(
    () =>
      onEngineCrash(() => {
        setEngineNotice(true);
        void reopenAll().finally(() => setEngineNotice(false));
      }),
    [],
  );

  const onPrint = useCallback(() => {
    const current = activeTab(appStore.getState());
    if (current?.status === "ready") void printDocument(current);
  }, []);
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    copySelection()
      .then((ok) => {
        if (!ok) return;
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {
        // Clipboard write refused (no permission / no user gesture): nothing to show.
      });
  }, []);
  const handlers = useMemo(() => ({ onPrint, onCopy }), [onPrint, onCopy]);
  useShortcuts(handlers);

  return (
    <div
      className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        Array.from(e.dataTransfer.files)
          .filter((f) => isPdfName(f.name))
          .forEach((f) => void openSource(sourceFromFile(f)));
      }}
    >
      <Toolbar onPrint={onPrint} />
      {tab?.status === "ready" && !organizing && (editMode ? <EditBar tab={tab} /> : <ToolOptionsBar />)}
      <TabBar />
      <main className="workspace">
        {!tab && <Welcome />}
        {tab?.status === "loading" && <DocMessage>{t("loading")}</DocMessage>}
        {tab?.status === "locked" && <PasswordDialog key={tab.id} tab={tab} />}
        {tab?.status === "error" && <DocMessage tone="error">{t(tab.error ?? "errorCorrupt", { name: tab.name })}</DocMessage>}
        {tab?.status === "ready" && (
          <TabErrorBoundary key={tab.id} fallback={<DocMessage tone="error">{t("errorCorrupt", { name: tab.name })}</DocMessage>}>
            <ToolRail />
            {organizing ? (
              <OrganizeView tab={tab} />
            ) : (
              <>
                <LeftPanel tab={tab} />
                <div className="doc-area">
                  {tab.info?.repaired && <div className="banner">{t("repairedBanner")}</div>}
                  {tab.info?.legacyText && tab.info.editable && !tab.info.signed && !legacyDismissed.has(tab.id) && (
                    <div className="banner legacy-banner">
                      <span>{t("legacyBanner")}</span>
                      <button className="primary-button" onClick={() => void convertToUnicode(tab.id)}>
                        {t("convertToUnicode")}
                      </button>
                      <button className="icon-button" aria-label={t("dismiss")} title={t("dismiss")} onClick={() => setLegacyDismissed(new Set(legacyDismissed).add(tab.id))}>
                        ×
                      </button>
                    </div>
                  )}
                  <PageView tab={tab} />
                </div>
              </>
            )}
            {searchOpen && <SearchBar tab={tab} />}
          </TabErrorBoundary>
        )}
      </main>
      {engineNotice && <div className="toast">{t("errorEngine")}</div>}
      {copied && <div className="toast">{t("copied")}</div>}
      {busy && <div className="busy-overlay">{t(busy)}</div>}
      <Notice />
      <ConfirmDialog />
      <AuthorDialog />
      <SignatureDialog />
    </div>
  );
}
