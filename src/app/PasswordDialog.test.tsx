// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { appStore, getTab } from "../state/store";
import { PasswordDialog } from "./PasswordDialog";

let id: string;
beforeEach(() => {
  appStore.setState({ tabs: [], activeId: null, lang: "en" });
  id = appStore.getState().addTab({ key: "/p.pdf", name: "p.pdf", path: "/p.pdf" }).id;
  appStore.getState().setOpenResult(id, { status: "wrong-password" });
});
afterEach(cleanup);

test("shows the file name, the wrong-password error and submits", () => {
  const onUnlock = vi.fn();
  render(<PasswordDialog tab={getTab(appStore.getState(), id)!} onUnlock={onUnlock} onCancel={vi.fn()} />);
  expect(screen.getByText(/“p.pdf” is protected/)).toBeTruthy();
  expect(screen.getByText("Incorrect password. Try again.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Password required"), { target: { value: "secret" } });
  fireEvent.click(screen.getByText("Open"));
  expect(onUnlock).toHaveBeenCalledWith(id, "secret");
});

test("cancel closes", () => {
  const onCancel = vi.fn();
  render(<PasswordDialog tab={getTab(appStore.getState(), id)!} onUnlock={vi.fn()} onCancel={onCancel} />);
  fireEvent.click(screen.getByText("Cancel"));
  expect(onCancel).toHaveBeenCalledWith(id);
});
