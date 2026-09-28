import { X } from "lucide-react";
import { useT } from "../i18n/useT";
import { useApp } from "../state/store";
import { requestClose } from "./edit-actions";

export function TabBar() {
  const t = useT();
  const tabs = useApp((s) => s.tabs);
  const activeId = useApp((s) => s.activeId);
  const activate = useApp((s) => s.activate);
  if (tabs.length === 0) return null;
  return (
    <div className="tabbar" role="tablist">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeId}
          className={`tab ${tab.id === activeId ? "active" : ""}`}
          onClick={() => activate(tab.id)}
          onAuxClick={(e) => e.button === 1 && void requestClose(tab.id)}
          title={tab.path ?? tab.name}
        >
          <span className="tab-name">
            {tab.dirty && <span className="dirty-dot" aria-hidden="true">• </span>}
            {tab.name}
          </span>
          <button
            className="icon-button small"
            aria-label={t("closeTab")}
            onClick={(e) => {
              e.stopPropagation();
              void requestClose(tab.id);
            }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
