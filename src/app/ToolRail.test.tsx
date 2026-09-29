// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MARKUP_COLORS, toHex } from "../state/palette";
import { appStore } from "../state/store";
import { AuthorDialog } from "./AuthorDialog";
import { ToolOptionsBar } from "./ToolOptionsBar";
import { ToolRail } from "./ToolRail";

vi.mock("../engine/client", () => ({ getEngine: () => ({}) }));

beforeEach(() => {
  appStore.setState({
    tabs: [], activeId: null, lang: "en", editMode: false, editTool: "select", tool: "select", dialog: null, notice: null,
    author: "Leo", signatures: [], signatureId: null,
  });
  const { id } = appStore.getState().addTab({ key: "/a.pdf", name: "a.pdf", path: "/a.pdf" });
  appStore.getState().setOpenResult(id, {
    status: "ok",
    info: { pageCount: 1, pages: [{ bounds: [0, 0, 600, 800], label: "1" }], outline: [], title: null, repaired: false, editable: true, signed: false, annotatable: true },
  });
});
afterEach(cleanup);

test("the rail picks tools and shows which one is active", async () => {
  render(<ToolRail />);
  fireEvent.click(screen.getByRole("button", { name: "Highlight" }));
  await waitFor(() => expect(appStore.getState().tool).toBe("markup"));
  expect(screen.getByRole("button", { name: "Highlight" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Add text" }));
  await waitFor(() => expect(appStore.getState()).toMatchObject({ editMode: true, editTool: "text" }));
  expect(screen.getByRole("button", { name: "Highlight" }).getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  await waitFor(() => expect(appStore.getState()).toMatchObject({ editMode: false, tool: "select" }));
});

test("the options bar changes markup kind and colour, draw shape and thickness", () => {
  appStore.getState().setTool("markup");
  const { rerender } = render(<ToolOptionsBar />);
  fireEvent.click(screen.getByRole("button", { name: "Underline" }));
  fireEvent.click(screen.getByRole("button", { name: toHex(MARKUP_COLORS[1]) }));
  expect(appStore.getState().markupStyle).toMatchObject({ kind: "underline", colors: { underline: MARKUP_COLORS[1] } });
  appStore.getState().setTool("draw");
  rerender(<ToolOptionsBar />);
  fireEvent.click(screen.getByRole("button", { name: "Arrow" }));
  fireEvent.change(screen.getByLabelText("Thickness"), { target: { value: "4" } });
  expect(appStore.getState().drawStyle).toMatchObject({ shape: "arrow", width: 4 });
});

test("the Sign options list saved signatures and open the creator", () => {
  appStore.getState().addSignature({ id: "s1", png: "data:image/png;base64,AA==", width: 10, height: 4 });
  appStore.getState().setTool("sign");
  render(<ToolOptionsBar />);
  fireEvent.click(screen.getByRole("button", { name: "Add signature" }));
  expect(appStore.getState().dialog).toEqual({ kind: "signature" });
  fireEvent.click(screen.getByRole("button", { name: "Delete signature" }));
  expect(appStore.getState().signatures).toEqual([]);
});

test("the author dialog saves the name and continues to the tool", async () => {
  appStore.setState({ author: null, dialog: { kind: "author", then: "comment" } });
  render(<AuthorDialog />);
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "මනිත්" } });
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(appStore.getState()).toMatchObject({ author: "මනිත්", tool: "comment", dialog: null }));
});
