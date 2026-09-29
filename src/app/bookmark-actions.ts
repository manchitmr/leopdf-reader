import { translate } from "../i18n/strings";
import { getTab } from "../state/store";
import { defaultEditDeps, runEdit, type EditDeps } from "./edit-actions";

/** Bookmarks the tab's current page ("Page 3"); returns the new bookmark's path, or null if nothing was added. */
export async function addBookmarkHere(tabId: string, deps: EditDeps = defaultEditDeps()): Promise<number[] | null> {
  const s = deps.store.getState();
  const tab = getTab(s, tabId);
  if (!tab?.info) return null;
  if (!tab.info.editable) {
    s.showNotice("editNotAllowed");
    return null;
  }
  if (tab.info.signed && !tab.signedAcknowledged) {
    s.setDialog({ kind: "signed", tabId, then: { bookmark: true } });
    return null;
  }
  const page = tab.currentPage;
  const title = translate(s.lang, "pageLabel", { label: tab.info.pages[page].label });
  const result = await runEdit(tabId, () => deps.engine.addBookmark(tabId, page, title), deps);
  return result?.id ? result.id.split(".").map(Number) : null;
}

export const renameBookmark = (tabId: string, path: number[], title: string, deps: EditDeps = defaultEditDeps()) =>
  runEdit(tabId, () => deps.engine.renameBookmark(tabId, path, title), deps);

export const deleteBookmark = (tabId: string, path: number[], deps: EditDeps = defaultEditDeps()) =>
  runEdit(tabId, () => deps.engine.deleteBookmark(tabId, path), deps);
