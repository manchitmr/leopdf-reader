import { expect, test, vi } from "vitest";
import type { EditResult, HistoryState } from "../edit/types";
import type { DocInfo } from "../engine/types";
import { createAppStore, getTab } from "../state/store";
import type { EditDeps } from "./edit-actions";
import { MM, cropPages, deletePages, extractToFile, insertFromFiles, pageRanges, splitToFiles } from "./organize-actions";

const dirty: HistoryState = { canUndo: true, canRedo: false, dirty: true };
const info = (pageCount: number): DocInfo => ({
  pageCount, pages: Array.from({ length: pageCount }, (_, i) => ({ bounds: [0, 0, 600, 800], label: String(i + 1) })), outline: [], title: null,
  repaired: false, editable: true, signed: false, annotatable: true, fillable: false,
});

function setup(pageCount = 4) {
  const store = createAppStore({ lang: "en", theme: "system", recent: [] });
  const { id } = store.getState().addTab({ key: "/docs/report.pdf", name: "report.pdf", path: "/docs/report.pdf" });
  store.getState().setOpenResult(id, { status: "ok", info: info(pageCount) });
  let pages = pageCount;
  const engine = {
    deletePages: vi.fn(async (_: string, p: number[]): Promise<EditResult> => ({ history: dirty, info: info((pages -= p.length)) })),
    insertPdf: vi.fn(async (_: string, at: number): Promise<EditResult> => {
      const start = at < 0 ? pages : at;
      pages += 2;
      return { history: dirty, info: info(pages), pages: [start, start + 1] };
    }),
    cropPages: vi.fn(async (_: string, p: number[]): Promise<EditResult> => ({ history: dirty, info: info(pages), pages: p })),
    extractPages: vi.fn(async () => new Uint8Array([1])),
    splitEvery: vi.fn(async () => [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])]),
  };
  const files = { writePdf: vi.fn(async (_path: string, _bytes: Uint8Array) => undefined), pickSavePath: vi.fn(async (name: string) => `/out/${name}`), downloadPdf: vi.fn(), pickImage: vi.fn() };
  const deps = { engine, store, files, tauri: true } as unknown as EditDeps;
  return { store, id, engine, files, deps, tab: () => getTab(store.getState(), id)! };
}

test("page ranges read like a person would write them", () => {
  expect(pageRanges([0, 1, 2, 4, 6, 7])).toBe("1-3, 5, 7-8");
  expect(pageRanges([3])).toBe("4");
});

test("deleting updates the page list; deleting every page is refused", async () => {
  const { id, engine, deps, tab, store } = setup(4);
  await deletePages(id, [1, 2], deps);
  expect(tab().info!.pageCount).toBe(2);
  expect(await deletePages(id, [0, 1], deps)).toBeNull();
  expect(engine.deletePages).toHaveBeenCalledTimes(1);
  expect(store.getState().notice?.key).toBe("cantDeleteAllPages");
});

test("inserting several picked PDFs keeps their order and position", async () => {
  const { id, engine, deps } = setup(4);
  const source = (n: number) => ({ key: `k${n}`, name: `${n}.pdf`, path: null, load: async () => new Uint8Array([n]) });
  const selected = await insertFromFiles(id, 1, deps, async () => [source(1), source(2)]);
  expect(engine.insertPdf.mock.calls.map((c) => c[1])).toEqual([1, 3]);
  expect(selected).toEqual([1, 2, 3, 4]);
  await insertFromFiles(id, -1, deps, async () => [source(3)]); // combine = append
  expect(engine.insertPdf.mock.calls[2][1]).toBe(-1);
});

test("crop converts millimetres to points", async () => {
  const { id, engine, deps } = setup(2);
  await cropPages(id, [0], { top: 10, right: 0, bottom: 0, left: 25.4 }, deps);
  expect(engine.cropPages).toHaveBeenCalledWith(id, [0], { top: 10 * MM, right: 0, bottom: 0, left: 72 });
});

test("extract saves 'name (pages …).pdf'; split writes numbered parts into the chosen folder", async () => {
  const { id, files, deps, store } = setup(6);
  await extractToFile(id, [4, 0, 1], deps);
  expect(files.pickSavePath).toHaveBeenCalledWith("report (pages 1-2,5).pdf");
  expect(files.writePdf).toHaveBeenCalledWith("/out/report (pages 1-2,5).pdf", expect.any(Uint8Array));
  files.writePdf.mockClear();
  await splitToFiles(id, 2, deps, async () => "C:\\Users\\me\\Out");
  expect(files.writePdf.mock.calls.map((c) => c[0])).toEqual([
    "C:\\Users\\me\\Out\\report - part 1.pdf",
    "C:\\Users\\me\\Out\\report - part 2.pdf",
    "C:\\Users\\me\\Out\\report - part 3.pdf",
  ]);
  expect(store.getState().notice).toMatchObject({ key: "filesSaved", vars: { count: 3 } });
});
