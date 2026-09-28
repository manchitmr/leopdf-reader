// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { appStore, getTab } from "../state/store";
import { SearchBar } from "./SearchBar";

let id: string;
beforeEach(() => {
  appStore.setState({ tabs: [], activeId: null, lang: "en" });
  id = appStore.getState().addTab({ key: "/a.pdf", name: "a.pdf", path: "/a.pdf" }).id;
  appStore.getState().setOpenResult(id, {
    status: "ok",
    info: { pageCount: 3, pages: Array(3).fill({ bounds: [0, 0, 100, 100], label: "1" }), outline: [], title: null, repaired: false, editable: true, signed: false },
  });
});
afterEach(cleanup);

test("Enter searches, shows the count and steps through hits", async () => {
  const runSearch = vi.fn(async () => [
    { page: 0, rects: [] },
    { page: 2, rects: [] },
  ]);
  const view = render(<SearchBar tab={getTab(appStore.getState(), id)!} runSearch={runSearch} />);
  const input = screen.getByPlaceholderText("Find in document");
  fireEvent.change(input, { target: { value: "ශ්රී" } });
  await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
  expect(runSearch).toHaveBeenCalledWith(id, "ශ්රී");
  view.rerender(<SearchBar tab={getTab(appStore.getState(), id)!} runSearch={runSearch} />);
  expect(screen.getByText("1 of 2")).toBeTruthy();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(getTab(appStore.getState(), id)!.currentPage).toBe(2);
});

test("no hits shows 'No results'", async () => {
  const view = render(<SearchBar tab={getTab(appStore.getState(), id)!} runSearch={async () => []} />);
  const input = screen.getByPlaceholderText("Find in document");
  fireEvent.change(input, { target: { value: "zzz" } });
  await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
  view.rerender(<SearchBar tab={getTab(appStore.getState(), id)!} runSearch={async () => []} />);
  expect(screen.getByText("No results")).toBeTruthy();
});

test("a failed search stops 'Searching…' and shows no results", async () => {
  const failing = async () => Promise.reject(new Error("worker died"));
  const view = render(<SearchBar tab={getTab(appStore.getState(), id)!} runSearch={failing} />);
  const input = screen.getByPlaceholderText("Find in document");
  fireEvent.change(input, { target: { value: "x" } });
  await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
  view.rerender(<SearchBar tab={getTab(appStore.getState(), id)!} runSearch={failing} />);
  expect(getTab(appStore.getState(), id)!.search.running).toBe(false);
  expect(screen.getByText("No results")).toBeTruthy();
});

test("a cancelled search (null result) leaves the store untouched", async () => {
  const view = render(<SearchBar tab={getTab(appStore.getState(), id)!} runSearch={async () => null} />);
  const input = screen.getByPlaceholderText("Find in document");
  fireEvent.change(input, { target: { value: "x" } });
  appStore.getState().setSearchOpen(true);
  await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
  view.rerender(<SearchBar tab={getTab(appStore.getState(), id)!} runSearch={async () => null} />);
  expect(getTab(appStore.getState(), id)!.search).toMatchObject({ query: "x", running: true });
});
