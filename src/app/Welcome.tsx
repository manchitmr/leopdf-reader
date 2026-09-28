import { FileText, FolderOpen } from "lucide-react";
import { useT } from "../i18n/useT";
import { sourceFromPath } from "../platform/sources";
import { useApp } from "../state/store";
import { openSource } from "./open-document";
import { openFromPicker } from "./Toolbar";

export function Welcome() {
  const t = useT();
  const recent = useApp((s) => s.recent);
  return (
    <div className="welcome">
      <h1>{t("welcomeTitle")}</h1>
      <p className="muted">{t("welcomeHint")}</p>
      <button className="primary-button" onClick={() => void openFromPicker()}>
        <FolderOpen size={18} /> {t("openFile")}
      </button>
      <h2>{t("recentFiles")}</h2>
      {recent.length === 0 ? (
        <p className="muted">{t("noRecent")}</p>
      ) : (
        <ul className="recent-list">
          {recent.map((r) => (
            <li key={r.path}>
              <button onClick={() => void openSource(sourceFromPath(r.path))} title={r.path}>
                <FileText size={16} />
                <span className="recent-name">{r.name}</span>
                <span className="muted recent-path">{r.path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
