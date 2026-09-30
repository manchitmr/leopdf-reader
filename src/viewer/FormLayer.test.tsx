// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { EditResult, FormField } from "../edit/types";
import { appStore, getTab } from "../state/store";
import { FormLayer } from "./FormLayer";
import { pageTransform } from "./geometry";

const history = { canUndo: true, canRedo: false, dirty: true };
const fields: FormField[] = [
  { id: 5, page: 0, kind: "text", name: "name", label: "Full name", rect: [80, 40, 380, 60], value: "", readOnly: false, multiline: false, maxLen: 0 },
  { id: 6, page: 0, kind: "checkbox", name: "agree", label: "", rect: [80, 80, 95, 95], value: "Off", readOnly: false, multiline: false, maxLen: 0, checked: false },
  { id: 7, page: 0, kind: "text", name: "locked", label: "", rect: [80, 100, 380, 120], value: "x", readOnly: true, multiline: false, maxLen: 0 },
];
const engine = {
  listFields: vi.fn(async () => fields),
  fillText: vi.fn(async (): Promise<EditResult> => ({ history })),
  setFieldChecked: vi.fn(async (): Promise<EditResult> => ({ history })),
};
vi.mock("../engine/client", () => ({ getEngine: () => engine }));
afterEach(cleanup);

test("typing into a field fills it on blur; a checkbox click ticks it; read-only fields get no control", async () => {
  appStore.setState({ tabs: [], activeId: null, tool: "select", lang: "en" });
  const { id } = appStore.getState().addTab({ key: "/f.pdf", name: "f.pdf", path: "/f.pdf" });
  appStore.getState().setOpenResult(id, {
    status: "ok",
    info: { pageCount: 1, pages: [{ bounds: [0, 0, 400, 300], label: "1" }], outline: [], title: null, repaired: false, editable: true, signed: false, annotatable: true, fillable: true },
  });
  render(<FormLayer tab={getTab(appStore.getState(), id)!} page={0} transform={pageTransform([0, 0, 400, 300], 1, 0)} />);
  const name = await screen.findByLabelText("Full name");
  fireEvent.change(name, { target: { value: "ශ්‍රී ලංකාව" } });
  fireEvent.blur(name);
  await waitFor(() => expect(engine.fillText).toHaveBeenCalledWith(id, 0, 5, "ශ්‍රී ලංකාව"));
  fireEvent.click(screen.getByRole("checkbox", { name: "agree" }));
  await waitFor(() => expect(engine.setFieldChecked).toHaveBeenCalledWith(id, 0, 6, true));
  expect(screen.queryByLabelText("locked")).toBeNull();
  expect(getTab(appStore.getState(), id)!.dirty).toBe(true);
});
