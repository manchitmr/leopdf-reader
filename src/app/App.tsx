import { useCallback, useEffect, useMemo, useState } from "react";
import { onEngineCrash } from "../engine/client";
import { useT } from "../i18n/useT";
import { onNativeDrop } from "../platform/native";
import { saveRecent } from "../platform/recent";
import { isPdfName, sourceFromFile, sourceFromPath } from "../platform/sources";
import { activeTab, appStore, useApp } from "../state/store";
import { PageView } from "../viewer/PageView";
import { DocMessage } from "./DocMessage";
import { LeftPanel } from "./LeftPanel";
import { openSource, reopenAll } from "./open-document";
import { SearchBar } from "./SearchBar";
import { TabBar } from "./TabBar";
import { Toolbar } from "./Toolbar";
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
      }),
    [],
  );
}

export function App() {
  const t = useT();
  const tab = useApp(activeTab);
  const lang = useApp((s) => s.lang);
  const theme = useApp((s) => s.theme);
  const busy = useApp((s) => s.busy);
  const searchOpen = useApp((s) => s.searchOpen);
  const [engineNotice, setEngineNotice] = useState(false);
  usePersistedSettings();

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dataset.theme = theme;
  }, [lang, theme]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void onNativeDrop((paths) => paths.filter(isPdfName).forEach((p) => void openSource(sourceFromPath(p)))).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);

  useEffect(
    () =>
      onEngineCrash(() => {
        setEngineNotice(true);
        void reopenAll().finally(() => setEngineNotice(false));
      }),
    [],
  );

  const onPrint = useCallback(() => {}, []);
  const onCopy = useCallback(() => {}, []);
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
      <TabBar />
      <main className="workspace">
        {!tab && <Welcome />}
        {tab?.status === "loading" && <DocMessage>{t("loading")}</DocMessage>}
        {tab?.status === "error" && <DocMessage tone="error">{t(tab.error ?? "errorCorrupt", { name: tab.name })}</DocMessage>}
        {tab?.status === "ready" && (
          <>
            <LeftPanel tab={tab} />
            <PageView key={tab.id} tab={tab} />
          </>
        )}
        {tab?.status === "ready" && searchOpen && <SearchBar key={tab.id} tab={tab} />}
      </main>
      {engineNotice && <div className="toast">{t("errorEngine")}</div>}
      {busy && <div className="busy-overlay">{t(busy)}</div>}
    </div>
  );
}
