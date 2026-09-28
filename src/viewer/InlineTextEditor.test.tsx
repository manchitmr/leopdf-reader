// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { pageTransform } from "./geometry";
import { InlineTextEditor } from "./InlineTextEditor";

afterEach(cleanup);
const state = { tabId: "d", page: 0, origin: [100, 200] as [number, number], objectId: null, text: "", style: { family: "sans" as const, bold: false, size: 12, color: [0, 0, 0] as [number, number, number] } };

test("typing updates text; Cmd/Ctrl+Enter commits; Escape cancels; Enter adds a line", () => {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  const onChange = vi.fn();
  render(<InlineTextEditor state={state} transform={pageTransform([0, 0, 600, 800], 2, 0)} zoom={2} onCommit={onCommit} onCancel={onCancel} onChange={onChange} />);
  const box = screen.getByRole("textbox");
  fireEvent.change(box, { target: { value: "යාපනය" } });
  expect(onChange).toHaveBeenCalledWith("යාපනය");
  fireEvent.keyDown(box, { key: "Enter" });
  expect(onCommit).not.toHaveBeenCalled();
  fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
  expect(onCommit).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(box, { key: "Escape" });
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test("editor is placed at the baseline in display coordinates, with matching font size", () => {
  render(<InlineTextEditor state={state} transform={pageTransform([0, 0, 600, 800], 2, 0)} zoom={2} onCommit={vi.fn()} onCancel={vi.fn()} onChange={vi.fn()} />);
  const box = screen.getByRole("textbox") as HTMLTextAreaElement;
  expect(box.style.left).toBe("200px");
  expect(box.style.fontSize).toBe("24px");
});
