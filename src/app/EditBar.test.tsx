// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { appStore, getTab } from "../state/store";
import { ConfirmDialog } from "./ConfirmDialog";
import { EditBar } from "./EditBar";

let id: string;
beforeEach(() => {
  appStore.setState({ tabs: [], activeId: null, lang: "en", editMode: true, editTool: "select", dialog: null });
  id = appStore.getState().addTab({ key: "/a.pdf", name: "a.pdf", path: "/a.pdf" }).id;
  appStore.getState().setOpenResult(id, {
    status: "ok",
    info: { pageCount: 1, pages: [{ bounds: [0, 0, 600, 800], label: "1" }], outline: [], title: null, repaired: false, editable: true, signed: false },
  });
});
afterEach(cleanup);

test("edit bar switches tools and style", () => {
  render(<EditBar tab={getTab(appStore.getState(), id)!} />);
  fireEvent.click(screen.getByLabelText("Add text"));
  expect(appStore.getState().editTool).toBe("text");
  fireEvent.click(screen.getByLabelText("Bold"));
  expect(appStore.getState().textStyle.bold).toBe(true);
  fireEvent.change(screen.getByLabelText("Font size"), { target: { value: "20" } });
  expect(appStore.getState().textStyle.size).toBe(20);
  expect((screen.getByLabelText("Undo") as HTMLButtonElement).disabled).toBe(true);
});

test("unsaved dialog shows the file name and three choices", () => {
  appStore.getState().setDialog({ kind: "unsaved", tabIds: [id], action: "close" });
  render(<ConfirmDialog />);
  expect(screen.getByText("Save changes to “a.pdf” before closing?")).toBeTruthy();
  expect(screen.getByText("Save")).toBeTruthy();
  expect(screen.getByText("Don't save")).toBeTruthy();
  expect(screen.getByText("Cancel")).toBeTruthy();
});
