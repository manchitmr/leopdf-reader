import { useEffect } from "react";
import { activeTab, appStore } from "../state/store";
import { deleteSelectedAnnot } from "./annot-actions";
import { deleteSelected, redo, requestClose, saveTab, undo } from "./edit-actions";
import { openFromPicker } from "./Toolbar";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Acrobat-style keyboard shortcuts. `onPrint` and `onCopy` come from App. */
export function useShortcuts(handlers: { onPrint: () => void; onCopy: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = appStore.getState();
      const tab = activeTab(s);
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
      const ready = tab?.status === "ready";

      if (mod) {
        const key = e.key.toLowerCase();
        const actions: Record<string, (() => void) | undefined> = {
          o: () => void openFromPicker(),
          p: ready ? handlers.onPrint : undefined,
          f: ready ? () => s.setSearchOpen(true) : undefined,
          w: tab ? () => void requestClose(tab.id) : undefined,
          "=": ready ? () => s.zoomBy(tab.id, 1) : undefined,
          "+": ready ? () => s.zoomBy(tab.id, 1) : undefined,
          "-": ready ? () => s.zoomBy(tab.id, -1) : undefined,
          "0": ready ? () => s.setFit(tab.id, "page") : undefined,
          "1": ready ? () => s.setZoom(tab.id, 1) : undefined,
          "2": ready ? () => s.setFit(tab.id, "width") : undefined,
          c: !inField && tab?.selection ? handlers.onCopy : undefined,
          z: ready && !inField ? () => void (e.shiftKey ? redo(tab.id) : undo(tab.id)) : undefined,
          y: ready && !inField ? () => void redo(tab.id) : undefined,
          s: ready ? () => void saveTab(tab.id, { as: e.shiftKey }) : undefined,
        };
        const action = actions[key];
        if (action) {
          e.preventDefault();
          action();
        }
        return;
      }

      if (inField || !ready) return;
      if ((e.key === "Delete" || e.key === "Backspace") && s.editMode && s.selected) {
        e.preventDefault();
        void deleteSelected();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && s.selectedAnnot) {
        e.preventDefault();
        void deleteSelectedAnnot();
        return;
      }
      const step = tab.viewMode === "two" ? 2 : 1;
      const pageKeys: Record<string, number | undefined> = {
        PageDown: tab.currentPage + step,
        PageUp: tab.currentPage - step,
        Home: 0,
        End: tab.info!.pageCount - 1,
        ArrowRight: tab.viewMode === "continuous" ? undefined : tab.currentPage + step,
        ArrowLeft: tab.viewMode === "continuous" ? undefined : tab.currentPage - step,
      };
      const target = pageKeys[e.key];
      if (target !== undefined) {
        e.preventDefault();
        s.goToPage(tab.id, target);
      } else if (e.key === "Escape") {
        s.setSelection(tab.id, null);
        s.setSearchOpen(false);
        if (s.selectedAnnot) s.selectAnnot(null);
        else if (!s.editMode && s.tool !== "select" && s.tool !== "hand") s.setTool("select");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlers]);
}
