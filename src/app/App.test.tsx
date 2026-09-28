// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { appStore } from "../state/store";
import { App } from "./App";

beforeEach(() => appStore.setState({ tabs: [], activeId: null, lang: "en", recent: [] }));
afterEach(cleanup);

test("shows the welcome screen with recent files", () => {
  appStore.getState().pushRecent("/docs/report.pdf");
  render(<App />);
  expect(screen.getByText("Welcome to LeoPDF Reader")).toBeTruthy();
  expect(screen.getByText("report.pdf")).toBeTruthy();
});

test("switches UI language to Sinhala", () => {
  appStore.setState({ lang: "si" });
  render(<App />);
  expect(screen.getByText("LeoPDF Reader වෙත සාදරයෙන් පිළිගනිමු")).toBeTruthy();
});

test("shows an error message for a corrupt tab", () => {
  const { id } = appStore.getState().addTab({ key: "/bad.pdf", name: "bad.pdf", path: "/bad.pdf" });
  appStore.getState().setOpenResult(id, { status: "error", reason: "corrupt" });
  render(<App />);
  expect(screen.getByRole("alert").textContent).toContain("“bad.pdf” could not be opened");
});
