// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { appStore } from "../state/store";
import { SignatureDialog } from "./SignatureDialog";

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never; // jsdom has no canvas
  appStore.setState({ lang: "en", dialog: { kind: "signature" }, signatures: [] });
});
afterEach(cleanup);

test("the dialog offers Draw, Type and Image; Save waits for content", () => {
  render(<SignatureDialog />);
  expect(screen.getByRole("tab", { name: "Draw" }).getAttribute("aria-selected")).toBe("true");
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("tab", { name: "Type" }));
  fireEvent.change(screen.getByLabelText("Type your name"), { target: { value: "ශ්‍රී ලංකා" } });
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("tab", { name: "Image" }));
  expect(screen.getByRole("button", { name: "Choose image…" })).toBeTruthy();
  expect((screen.getByLabelText("Remove paper background") as HTMLInputElement).checked).toBe(true);
});

test("Cancel closes the dialog without saving", () => {
  render(<SignatureDialog />);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(appStore.getState()).toMatchObject({ dialog: null, signatures: [] });
});
