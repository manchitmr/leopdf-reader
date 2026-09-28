// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { TabErrorBoundary } from "./TabErrorBoundary";

afterEach(cleanup);

function Boom(): never {
  throw new Error("page geometry exploded");
}

test("a crash inside one tab shows that tab's fallback and leaves siblings rendered", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <div>
      <p>toolbar still here</p>
      <TabErrorBoundary fallback={<p role="alert">tab failed</p>}>
        <Boom />
      </TabErrorBoundary>
    </div>,
  );
  expect(screen.getByRole("alert").textContent).toBe("tab failed");
  expect(screen.getByText("toolbar still here")).toBeTruthy();
});
