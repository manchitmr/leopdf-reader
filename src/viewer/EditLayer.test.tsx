// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { appStore, getTab } from "../state/store";
import { EditLayer } from "./EditLayer";
import { pageTransform } from "./geometry";

vi.mock("../engine/client", () => ({ getEngine: () => ({ listObjects: async () => [], listImages: async () => [], listLines: async () => [] }) }));
afterEach(cleanup);

test("Add text opens the editor on click (not pointerdown, whose focus change would close it at once)", () => {
  appStore.setState({ tabs: [], activeId: null, lang: "en", editMode: true, editTool: "text", inlineEditor: null });
  const { id } = appStore.getState().addTab({ key: "/a.pdf", name: "a.pdf", path: "/a.pdf" });
  const { container } = render(<EditLayer tab={getTab(appStore.getState(), id)!} page={0} transform={pageTransform([0, 0, 600, 800], 1, 0)} zoom={1} />);
  const layer = container.querySelector(".edit-layer")!;
  fireEvent.pointerDown(layer, { button: 0, clientX: 100, clientY: 200 });
  expect(appStore.getState().inlineEditor).toBeNull();
  fireEvent.click(layer, { clientX: 100, clientY: 200 });
  expect(appStore.getState().inlineEditor).toMatchObject({ tabId: id, page: 0, objectId: null, text: "" });
});
