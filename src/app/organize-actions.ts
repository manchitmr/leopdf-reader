import type { Margins } from "../edit/pages";
import type { EditResult } from "../edit/types";
import { joinPath, pickFolder } from "../platform/files";
import { pickPdfs } from "../platform/sources";
import { activeTab, getTab } from "../state/store";
import { defaultEditDeps, runEdit, type EditDeps } from "./edit-actions";

export const MM = 72 / 25.4;

/** Opens Organize Pages for the active tab, after the same permission and signed-PDF checks as editing. */
export function enterOrganize(deps: EditDeps = defaultEditDeps()): void {
  const s = deps.store.getState();
  const tab = activeTab(s);
  if (!tab?.info) return;
  if (!tab.info.editable) return s.showNotice("editNotAllowed");
  if (tab.info.signed && !tab.signedAcknowledged) return s.setDialog({ kind: "signed", tabId: tab.id, then: { organize: true } });
  s.setOrganizing(true);
}

/** Page indexes the view should select after the operation, or null if it failed. */
type Selection = number[] | null;
const pagesOf = async (tabId: string, call: () => Promise<EditResult>, deps: EditDeps): Promise<Selection> =>
  (await runEdit(tabId, call, deps))?.pages ?? null;

export const rotatePages = (tabId: string, pages: number[], degrees: number, deps = defaultEditDeps()) =>
  pagesOf(tabId, () => deps.engine.rotatePages(tabId, pages, degrees), deps);

export async function deletePages(tabId: string, pages: number[], deps = defaultEditDeps()): Promise<Selection> {
  const tab = getTab(deps.store.getState(), tabId);
  if (tab?.info && pages.length >= tab.info.pageCount) {
    deps.store.getState().showNotice("cantDeleteAllPages");
    return null;
  }
  await runEdit(tabId, () => deps.engine.deletePages(tabId, pages), deps);
  return [];
}

export const movePages = (tabId: string, pages: number[], before: number, deps = defaultEditDeps()) =>
  pagesOf(tabId, () => deps.engine.movePages(tabId, pages, before), deps);

export const insertBlankPage = (tabId: string, at: number, deps = defaultEditDeps()) =>
  pagesOf(tabId, () => deps.engine.insertBlankPage(tabId, at), deps);

/** Inserts the pages of picked PDFs at `at` (-1 = at the end, i.e. combining files), in the order picked. */
export async function insertFromFiles(tabId: string, at: number, deps = defaultEditDeps(), pick = pickPdfs): Promise<Selection> {
  const sources = await pick();
  let position = at;
  const added: number[] = [];
  for (const source of sources) {
    const bytes = await source.load();
    const pages = await pagesOf(tabId, () => deps.engine.insertPdf(tabId, position, bytes), deps);
    if (!pages) return added.length ? added : null;
    added.push(...pages);
    if (position >= 0) position += pages.length;
  }
  return added.length ? added : null;
}

export const cropPages = (tabId: string, pages: number[], marginsMm: Margins, deps = defaultEditDeps()) =>
  pagesOf(
    tabId,
    () => deps.engine.cropPages(tabId, pages, { top: marginsMm.top * MM, right: marginsMm.right * MM, bottom: marginsMm.bottom * MM, left: marginsMm.left * MM }),
    deps,
  );

const stem = (name: string) => name.replace(/\.pdf$/i, "");

/** "1-3, 5" for 0-based [0, 1, 2, 4]. */
export function pageRanges(pages: number[]): string {
  const sorted = [...pages].sort((a, b) => a - b).map((p) => p + 1);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`);
    i = j;
  }
  return parts.join(", ");
}

/** Saves the chosen pages as a new PDF (the open document is unchanged). */
export async function extractToFile(tabId: string, pages: number[], deps = defaultEditDeps()): Promise<void> {
  const s = deps.store.getState();
  const tab = getTab(s, tabId);
  if (!tab || !pages.length) return;
  const name = `${stem(tab.name)} (pages ${pageRanges(pages).replace(/, /g, ",")}).pdf`;
  try {
    const bytes = await deps.engine.extractPages(tabId, [...pages].sort((a, b) => a - b));
    if (deps.tauri) {
      const path = await deps.files.pickSavePath(name);
      if (!path) return;
      await deps.files.writePdf(path, bytes);
    } else deps.files.downloadPdf(name, bytes);
    s.showNotice("saved");
  } catch {
    s.showNotice("saveFailed", { name });
  }
}

/** Splits the document into files of `size` pages each, saved into a chosen folder. */
export async function splitToFiles(tabId: string, size: number, deps = defaultEditDeps(), folderPicker = pickFolder): Promise<void> {
  const s = deps.store.getState();
  const tab = getTab(s, tabId);
  if (!tab) return;
  try {
    const folder = deps.tauri ? await folderPicker() : null;
    if (deps.tauri && !folder) return;
    const parts = await deps.engine.splitEvery(tabId, size);
    for (let i = 0; i < parts.length; i++) {
      const name = `${stem(tab.name)} - part ${i + 1}.pdf`;
      if (folder) await deps.files.writePdf(joinPath(folder, name), parts[i]);
      else deps.files.downloadPdf(name, parts[i]);
    }
    s.showNotice("filesSaved", { count: parts.length });
  } catch {
    s.showNotice("saveFailed", { name: tab.name });
  }
}
