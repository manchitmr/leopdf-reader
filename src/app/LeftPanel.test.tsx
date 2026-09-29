// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { OutlineTree } from "./LeftPanel";

afterEach(cleanup);

test("outline tree shows nested titles and navigates on click", () => {
  const onSelect = vi.fn();
  render(
    <OutlineTree
      nodes={[
        { title: "Chapter One", page: 0, children: [{ title: "Section 1.1", page: 1, children: [] }] },
        { title: "No target", page: null, children: [] },
      ]}
      onSelect={onSelect}
    />,
  );
  fireEvent.click(screen.getByLabelText("Chapter One"));
  fireEvent.click(screen.getByText("Section 1.1"));
  expect(onSelect).toHaveBeenCalledWith(1);
  fireEvent.click(screen.getByText("No target"));
  expect(onSelect).toHaveBeenCalledTimes(1);
});

vi.mock("../engine/client", () => ({ getEngine: () => ({ render: () => new Promise(() => {}) }) }));

test("a thumbnail keeps a canvas only while it is on screen", async () => {
  const { act } = await import("@testing-library/react");
  const { Thumbnail } = await import("./LeftPanel");
  const { appStore, getTab } = await import("../state/store");
  let report!: (visible: boolean) => void;
  globalThis.IntersectionObserver = class {
    constructor(cb: IntersectionObserverCallback) {
      report = (visible) => cb([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    observe() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
  Element.prototype.scrollIntoView = () => {};
  appStore.setState({ tabs: [], activeId: null });
  const { id } = appStore.getState().addTab({ key: "t", name: "t.pdf", path: null });
  appStore.getState().setOpenResult(id, {
    status: "ok",
    info: { pageCount: 2, pages: Array(2).fill({ bounds: [0, 0, 600, 800], label: "1" }), outline: [], title: null, repaired: false, editable: true, signed: false, annotatable: true },
  });
  const { container } = render(<Thumbnail tab={getTab(appStore.getState(), id)!} page={1} />);
  expect(container.querySelector("canvas")).toBeNull();
  act(() => report(true));
  expect(container.querySelector("canvas")).not.toBeNull();
  act(() => report(false));
  expect(container.querySelector("canvas")).toBeNull();
});
